import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { createRateLimits } from './middleware/rateLimits.js';
import { router as authRouter } from './routes/auth.js';
import { router as checkinRouter } from './routes/checkin.js';
import { router as eventsRouter } from './routes/events.js';
import { router as publicRouter } from './routes/public.js';
import { auditRouter, notificationsRouter, ticketsRouter } from './routes/misc.js';
import { router as registrationsRouter } from './routes/registrations.js';
import { router as usersRouter } from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const limits = createRateLimits();
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', limits.api);
  app.use('/api/auth/login', limits.login);
  app.use('/api/auth/signup', limits.signup);

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/registrations', registrationsRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/checkin', checkinRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/audit', auditRouter);

  app.use((req, _res, next) => next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      err = new HttpError(400, 'bad_request', `${details[0].field}: ${details[0].message}`, details);
    } else if (err?.code === '22P02') {
      // invalid_text_representation — e.g. a malformed UUID in the URL
      err = new HttpError(404, 'not_found', 'Resource not found.');
    } else if (err?.type === 'entity.parse.failed') {
      err = new HttpError(400, 'bad_request', 'Request body is not valid JSON.');
    }
    if (!(err instanceof HttpError)) {
      console.error(`[api] ${req.method} ${req.originalUrl}`, err);
      err = new HttpError(500, 'internal_error', 'Something went wrong on our side. Please try again.');
    }
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    res.status(err.status).json(body);
  });

  return app;
}
