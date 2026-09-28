// User & role management — System Admin only (FR-011).
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db/index.js';
import { publish } from '../lib/bus.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { authenticate, requireRole, ROLES } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { passwordSchema } from './auth.js';

export const router = Router();
router.use(authenticate(), requireRole('admin'));

const USER_COLUMNS = 'id, email, full_name, phone, role, is_active, created_at, updated_at';

const listSchema = z.object({ role: z.enum(ROLES).optional(), q: z.string().trim().optional() });

router.get('/', validate(listSchema, 'query'), async (req, res) => {
  const { role, q } = req.valid.query;
  const params = [];
  const where = [];
  if (role) { params.push(role); where.push(`role = $${params.length}`); }
  if (q) { params.push(`%${q}%`); where.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length})`); }
  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY role, full_name`,
    params,
  );
  res.json({ users: rows });
});

const createSchema = z.object({
  email: z.email('must be a valid email address').transform((s) => s.toLowerCase()),
  full_name: z.string().trim().min(2, 'is required').max(120),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(ROLES),
  password: passwordSchema,
});

router.post('/', validate(createSchema), async (req, res) => {
  const { email, full_name, phone, role, password } = req.valid.body;
  let user;
  try {
    user = await one(
      `INSERT INTO users (email, full_name, phone, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
      [email, full_name, phone ?? null, role, await bcrypt.hash(password, 12)],
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email already exists.');
    throw err;
  }
  await publish('user.created', { actorId: req.user.id, entityType: 'user', entityId: user.id, data: { role, email } });
  res.status(201).json({ user });
});

const updateSchema = z.object({
  full_name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');

router.patch('/:id', validate(updateSchema), async (req, res) => {
  const changes = req.valid.body;
  if (req.params.id === req.user.id && (changes.role !== undefined || changes.is_active === false)) {
    throw badRequest('You cannot change your own role or deactivate your own account.');
  }
  const before = await one(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.params.id]);
  if (!before) throw notFound('User');
  const fields = Object.keys(changes);
  const user = await one(
    `UPDATE users SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now()
      WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.params.id, ...fields.map((f) => changes[f])],
  );
  const diff = Object.fromEntries(fields.map((f) => [f, { from: before[f], to: user[f] }]));
  await publish('user.updated', { actorId: req.user.id, entityType: 'user', entityId: user.id, data: { changes: diff } });
  res.json({ user });
});

router.post('/:id/reset-password', validate(z.object({ password: passwordSchema })), async (req, res) => {
  // Also unlocks the account and signs the user out everywhere (old tokens stop working).
  const user = await one(
    `UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL,
            token_version = token_version + 1, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [req.params.id, await bcrypt.hash(req.valid.body.password, 12)]);
  if (!user) throw notFound('User');
  await publish('user.password_reset', { actorId: req.user.id, entityType: 'user', entityId: user.id });
  res.status(204).end();
});
