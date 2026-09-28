// Per-IP request limits. Counters live in memory, which is fine for one API process; with several
// instances, give express-rate-limit a shared store (e.g. Redis) so limits apply across all of them.
// Limits key on req.ip, so TRUST_PROXY must be configured correctly (see config.js).
import rateLimit from 'express-rate-limit';

const limiter = (windowMinutes, limit, message) => rateLimit({
  windowMs: windowMinutes * 60_000,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message } }),
});

/** Fresh counters per app instance (so each test's app starts clean). */
export function createRateLimits() {
  return {
    // Generous: a busy gate phone scans roughly one ticket every couple of seconds.
    api: limiter(1, 600, 'Too many requests. Please slow down and try again in a minute.'),
    // Per IP, on top of the per-account lockout. Allows for a classroom or venue sharing one IP.
    login: limiter(15, 30, 'Too many sign-in attempts from this network. Please wait 15 minutes and try again.'),
    signup: limiter(60, 20, 'Too many accounts created from this network. Please try again later.'),
  };
}
