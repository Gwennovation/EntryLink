import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env.NODE_ENV || 'development';

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
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  qrSecret: secret('QR_SECRET', 'dev-only-qr-secret-change-me'),
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
  maxUploadBytes: 5 * 1024 * 1024,
  // Public base URL of the web app, encoded in event poster QR codes. Phones can't open
  // "localhost", so for on-device testing set this to http://<your-LAN-IP>:5173.
  publicWebUrl: (process.env.PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, ''),
  // Unset = no email provider yet: email attempts are recorded in the notification log as not sent.
  emailProvider: process.env.EMAIL_PROVIDER || null,
};
