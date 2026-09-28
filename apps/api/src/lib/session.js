// Session tokens. The mobile app stores the JWT in SecureStore and sends it as a Bearer header.
// The web app never sees the JWT: it lives in an httpOnly cookie that page scripts can't read,
// so an XSS bug can't steal it.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const SESSION_COOKIE = 'el_session';
// Required on every cookie-authenticated write. Browsers won't let another site add custom
// headers without a CORS preflight, which our CORS policy refuses — so this blocks CSRF.
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'EntryLink';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, ver: user.token_version ?? 0 }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
  });
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/api',
});

export function setSessionCookie(res, user) {
  res.cookie(SESSION_COOKIE, signToken(user), { ...cookieOptions(), maxAge: config.sessionHours * 3600_000 });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readSessionCookie(req) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Respond with a new session. Web clients (session: 'cookie') get the cookie and no token in the
 * body; mobile clients get the token to store in SecureStore.
 */
export function sendSession(res, user, { cookie, status = 200 }) {
  const { token_version, ...publicUser } = user;
  if (cookie) {
    setSessionCookie(res, user);
    return res.status(status).json({ user: publicUser });
  }
  return res.status(status).json({ token: signToken(user), user: publicUser });
}
