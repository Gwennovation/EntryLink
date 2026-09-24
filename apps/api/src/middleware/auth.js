import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const ROLES = ['admin', 'organizer', 'coordinator', 'gate_staff', 'attendee'];

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function tokenFrom(req, allowQuery) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  // EventSource (SSE) cannot send headers, so the live feed accepts ?access_token=
  if (allowQuery && typeof req.query.access_token === 'string') return req.query.access_token;
  return null;
}

/**
 * Verifies the JWT and reloads the user so deactivations and role changes take effect immediately,
 * rather than waiting for the token to expire.
 */
export function authenticate({ allowQueryToken = false } = {}) {
  return async (req, _res, next) => {
    const token = tokenFrom(req, allowQueryToken);
    if (!token) throw unauthorized();
    let claims;
    try {
      claims = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }
    const user = await one(
      'SELECT id, email, full_name, phone, role, is_active FROM users WHERE id = $1',
      [claims.sub],
    );
    if (!user || !user.is_active) throw unauthorized('This account is inactive.');
    req.user = user;
    next();
  };
}

/** RBAC gate (FR-014, NFR-002). */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user?.role)) throw forbidden();
    next();
  };
}
