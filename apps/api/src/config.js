import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env.NODE_ENV || 'development';

/** TRUST_PROXY: unset = don't trust X-Forwarded-For (so clients can't spoof their IP to dodge rate
 *  limits). Behind one reverse proxy (Render, Railway, Nginx) set it to 1. */
function trustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function corsOrigins(value) {
  const origins = (value || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (env === 'production' && origins.includes('*')) {
    throw new Error('CORS_ORIGINS must list your web app origin(s) in production (e.g. https://entrylink.example.com)');
  }
  return origins;
}

function secret(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (env === 'production') throw new Error(`${name} must be set in production`);
  return devFallback;
}

export const config = {
  env,
  port: Number(process.env.PORT || 4000),
  // Real PostgreSQL when set; otherwise embedded PGlite (see src/db/index.js).
  databaseUrl: process.env.DATABASE_URL || null,
  pgliteDir: process.env.PGLITE_DIR || path.join(root, '.data', 'pglite'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, '.data', 'uploads'),
  jwtSecret: secret('JWT_SECRET', 'dev-only-jwt-secret-change-me'),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  // Web sessions use an httpOnly cookie; Secure (HTTPS-only) in production or when forced.
  cookieSecure: env === 'production' || process.env.COOKIE_SECURE === 'true',
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  maxFailedLogins: 5,
  lockoutMinutes: 15,
  qrSecret: secret('QR_SECRET', 'dev-only-qr-secret-change-me'),
  corsOrigins: corsOrigins(process.env.CORS_ORIGINS),
  maxUploadBytes: 5 * 1024 * 1024,
  // Public base URL of the web app, encoded in event poster QR codes. Phones can't open
  // "localhost", so for on-device testing set this to http://<your-LAN-IP>:5173.
  publicWebUrl: (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Unset = no email provider yet: email attempts are recorded in the notification log as not sent.
  emailProvider: process.env.EMAIL_PROVIDER || null,
};
