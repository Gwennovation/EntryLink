import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { CSRF_HEADER, CSRF_VALUE, readSessionCookie } from '../lib/session.js';

export const ROLES = ['admin', 'organizer', 'coordinator', 'gate_staff', 'attendee'];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Bearer header (mobile app, API clients) takes precedence over the session cookie (web app). */
function credentialsFrom(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return { token: header.slice(7), via: 'bearer' };
  const cookie = readSessionCookie(req);
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

/**
 * Verifies the session and reloads the user, so deactivations, role changes and password resets
 * take effect immediately rather than when the token expires.
 */
export function authenticate() {
  return async (req, _res, next) => {
    const creds = credentialsFrom(req);
    if (!creds) throw unauthorized();
    // Cookies are sent automatically by the browser, so writes must also carry our custom header.
    if (creds.via === 'cookie' && !SAFE_METHODS.has(req.method) && req.get(CSRF_HEADER) !== CSRF_VALUE) {
      throw forbidden('Request blocked: missing security header. Reload the page and try again.');
    }
    let claims;
    try {
      claims = jwt.verify(creds.token, config.jwtSecret);
    } catch {
      throw unauthorized('Your session has expired. Please sign in again.');
    }
    const user = await one(
      'SELECT id, email, full_name, phone, role, is_active, token_version FROM users WHERE id = $1',
      [claims.sub],
    );
    if (!user || !user.is_active) throw unauthorized('This account is inactive.');
    if ((claims.ver ?? 0) !== user.token_version) throw unauthorized('Your session has ended. Please sign in again.');
    const { token_version, ...publicUser } = user;
    req.user = publicUser;
    req.auth = { via: creds.via, tokenVersion: token_version };
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
