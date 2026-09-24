import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db/index.js';
import { publish } from '../lib/bus.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const router = Router();

export const passwordSchema = z.string().min(8, 'must be at least 8 characters').max(128);
const publicUser = ({ password_hash, ...u }) => u;

const signupSchema = z.object({
  email: z.email('must be a valid email address').transform((s) => s.toLowerCase()),
  password: passwordSchema,
  full_name: z.string().trim().min(2, 'is required').max(120),
  phone: z.string().trim().max(30).optional(),
});

// Public sign-up always creates an attendee. Staff accounts are created by an admin (FR-011).
router.post('/signup', validate(signupSchema), async (req, res) => {
  const { email, password, full_name, phone } = req.valid.body;
  const hash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await one(
      `INSERT INTO users (email, password_hash, full_name, phone, role) VALUES ($1, $2, $3, $4, 'attendee')
       RETURNING id, email, full_name, phone, role, is_active, created_at`,
      [email, hash, full_name, phone ?? null],
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email already exists.');
    throw err;
  }
  await publish('user.signed_up', { actorId: user.id, entityType: 'user', entityId: user.id, data: { role: user.role } });
  res.status(201).json({ token: signToken(user), user });
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
  // Same message for unknown email and wrong password so accounts can't be enumerated.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) throw unauthorized('Incorrect email or password.');
  if (!user.is_active) throw unauthorized('This account has been deactivated. Contact your administrator.');
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authenticate(), (req, res) => res.json({ user: req.user }));

const changePasswordSchema = z.object({ current_password: z.string(), new_password: passwordSchema });

router.post('/change-password', authenticate(), validate(changePasswordSchema), async (req, res) => {
  const { current_password, new_password } = req.valid.body;
  const { password_hash } = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current_password, password_hash))) throw badRequest('current_password: incorrect password.');
  await one('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await bcrypt.hash(new_password, 12)]);
  await publish('user.password_changed', { actorId: req.user.id, entityType: 'user', entityId: req.user.id });
  res.status(204).end();
});
