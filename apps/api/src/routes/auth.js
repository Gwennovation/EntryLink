import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one } from '../db/index.js';
import { publish } from '../lib/bus.js';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors.js';
import { clearSessionCookie, sendSession } from '../lib/session.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const router = Router();

export const passwordSchema = z.string().min(15, 'must be at least 15 characters').max(128);
const publicUser = ({ password_hash, failed_login_count, locked_until, token_version, ...u }) => u;
// 'cookie' = web dashboard (httpOnly cookie, no token in the body); omitted = mobile (Bearer token).
const sessionField = z.enum(['cookie']).optional();

// Compared against when the email doesn't exist, so a wrong email takes as long as a wrong
// password and response timing doesn't reveal which accounts exist.
const DUMMY_HASH = bcrypt.hashSync('entrylink-timing-equalizer', 12);

const signupSchema = z.object({
  email: z.email('must be a valid email address').transform((s) => s.toLowerCase()),
  password: passwordSchema,
  full_name: z.string().trim().min(2, 'is required').max(120),
  phone: z.string().trim().max(30).optional(),
  session: sessionField,
});

// Public sign-up always creates an attendee. Staff accounts are created by an admin (FR-011).
router.post('/signup', validate(signupSchema), async (req, res) => {
  const { email, password, full_name, phone } = req.valid.body;
  const hash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await one(
      `INSERT INTO users (email, password_hash, full_name, phone, role) VALUES ($1, $2, $3, $4, 'attendee')
       RETURNING id, email, full_name, phone, role, is_active, token_version, created_at`,
      [email, hash, full_name, phone ?? null],
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email already exists.');
    throw err;
  }
  await publish('user.signed_up', { actorId: user.id, entityType: 'user', entityId: user.id, data: { role: user.role } });
  sendSession(res, user, { cookie: req.valid.body.session === 'cookie', status: 201 });
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().max(128), session: sessionField });

const minutesUntil = (d) => Math.max(1, Math.ceil((new Date(d) - Date.now()) / 60_000));

router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password, session } = req.valid.body;
  const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
  // Same message for unknown email and wrong password so accounts can't be enumerated.
  const WRONG = 'Incorrect email or password.';
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized(WRONG);
  }
  // While locked, don't even check the password — guessing can't continue.
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new HttpError(429, 'account_locked',
      `Too many failed sign-in attempts. Try again in ${minutesUntil(user.locked_until)} minutes, or ask an admin to reset your password.`);
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    // Lock after the Nth consecutive failure; the counter restarts so the next window gets N tries again.
    const after = await one(
      `UPDATE users SET
         locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END,
         failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END
       WHERE id = $1 RETURNING failed_login_count, locked_until`,
      [user.id, config.maxFailedLogins, config.lockoutMinutes],
    );
    if (after.failed_login_count === 0) {
      await publish('user.locked', {
        actorId: null, entityType: 'user', entityId: user.id,
        data: { reason: 'failed_logins', attempts: config.maxFailedLogins, minutes: config.lockoutMinutes, ip: req.ip },
      });
    }
    throw unauthorized(WRONG);
  }
  if (!user.is_active) throw unauthorized('This account has been deactivated. Contact your administrator.');
  if (user.failed_login_count || user.locked_until) {
    await one('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]);
  }
  sendSession(res, publicUser(user), { cookie: session === 'cookie' });
});

// Clears the web session cookie. Harmless without a session, so no auth required.
router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get('/me', authenticate(), (req, res) => res.json({ user: req.user }));

const changePasswordSchema = z.object({ current_password: z.string(), new_password: passwordSchema });

router.post('/change-password', authenticate(), validate(changePasswordSchema), async (req, res) => {
  const { current_password, new_password } = req.valid.body;
  const { password_hash } = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(current_password, password_hash))) throw badRequest('current_password: incorrect password.');
  // Bumping token_version signs out every other device; this one gets a fresh session below.
  const updated = await one(
    `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now()
      WHERE id = $1 RETURNING id, role, token_version`,
    [req.user.id, await bcrypt.hash(new_password, 12)],
  );
  await publish('user.password_changed', { actorId: req.user.id, entityType: 'user', entityId: req.user.id });
  sendSession(res, { ...req.user, token_version: updated.token_version }, { cookie: req.auth.via === 'cookie' });
});
