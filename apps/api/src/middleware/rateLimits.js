// Per-IP limits use the shared database for authentication routes, so cold starts and multiple
// instances cannot reset them. TRUST_PROXY must be configured correctly (see config.js).
import { createHmac } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { one, query } from '../db/index.js';

const limiter = (windowMinutes, limit, message) => rateLimit({
  windowMs: windowMinutes * 60_000,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message } }),
});

const authLimiter = (action, windowMinutes, limit, message) => async (req, res, next) => {
  try {
    const ipHash = createHmac('sha256', config.jwtSecret).update(req.ip || req.socket.remoteAddress || 'unknown').digest('hex');
    const windowMs = windowMinutes * 60_000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const row = await one(
      `INSERT INTO auth_rate_limits (action, ip_hash, window_start, attempts)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (action, ip_hash, window_start)
       DO UPDATE SET attempts = auth_rate_limits.attempts + 1
       RETURNING attempts`,
      [action, ipHash, windowStart],
    );
    // Keep the shared table bounded without adding a cleanup query to every request.
    if (row.attempts === 1 && Math.random() < 0.01) {
      await query("DELETE FROM auth_rate_limits WHERE window_start < now() - interval '2 hours'");
    }
    if (row.attempts > limit) return res.status(429).json({ error: { code: 'rate_limited', message } });
    next();
  } catch (err) { next(err); }
};

/** General API traffic is per instance; authentication limits are shared through the database. */
export function createRateLimits() {
  return {
    // Generous: a busy gate phone scans roughly one ticket every couple of seconds.
    api: limiter(1, 600, 'Too many requests. Please slow down and try again in a minute.'),
    // Per IP, on top of the per-account lockout. Allows for a classroom or venue sharing one IP.
    login: authLimiter('login', 15, 30, 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.'),
    signup: authLimiter('signup', 60, 20, 'Too many account creation attempts from this network. Please try again later.'),
  };
}
