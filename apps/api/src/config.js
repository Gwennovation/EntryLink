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
};
