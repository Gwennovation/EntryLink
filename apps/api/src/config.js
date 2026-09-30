import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env.NODE_ENV || 'development';
// Vercel sets VERCEL=1 plus the deployment's domains (without https://).
const onVercel = Boolean(process.env.VERCEL);
const vercelOrigins = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL']
  .map((k) => process.env[k]).filter(Boolean).map((host) => `https://${host}`);

/** TRUST_PROXY: unset = don't trust X-Forwarded-For (so clients can't spoof their IP to dodge rate
 *  limits). Behind one reverse proxy (Render, Railway, Nginx) set it to 1. */
function trustProxy(value) {
  if ((value === undefined || value === '') && onVercel) return 1; // Vercel's edge is the one proxy in front
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function corsOrigins(value) {
  // On Vercel the web app and API share one origin; allow the deployment's own domains by default.
  const fallback = onVercel && vercelOrigins.length ? vercelOrigins.join(',') : '*';
  const origins = (value || fallback).split(',').map((s) => s.trim()).filter(Boolean);
  if (env === 'production' && origins.includes('*')) {
    throw new Error('CORS_ORIGINS must list your web app origin(s) in production (e.g. https://entrylink.example.com)');
  }
  return origins;
}

function databaseUrl() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
  // PGlite writes to local disk, which doesn't persist on Vercel.
  if (!url && onVercel) {
    throw new Error('No database connected. In Vercel: Storage → create/connect a Neon Postgres database to this project, then redeploy.');
  }
  return url;
}

function blobStorage() {
  const connected = Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
  // Without Blob, receipts would go to local disk, which is read-only on Vercel. Fail at startup,
  // before the demo seed runs, rather than half-seeding and then failing on every upload.
  if (!connected && onVercel) {
    throw new Error('No file storage connected. In Vercel: Storage → create a private Blob store, connect it to this project, then redeploy.');
  }
  return connected;
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
  onVercel,
  // Real PostgreSQL when set (Neon on Vercel provides DATABASE_URL / POSTGRES_URL); otherwise embedded PGlite.
  databaseUrl: databaseUrl(),
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
  // 4 MB: Vercel Functions reject request bodies over 4.5 MB, and multipart adds overhead.
  maxUploadBytes: 4 * 1024 * 1024,
  // Private Vercel Blob store for receipts when one is connected; local disk otherwise.
  blobStorage: blobStorage(),
  // Seed the demo accounts/events on first boot if the database is empty (for demos and grading).
  seedDemo: process.env.SEED_DEMO === 'true',
  // Live dashboard: how often each open stream checks the database, and when it hands off to a
  // fresh connection (Vercel ends function invocations at 300 s; the browser reconnects itself).
  livePollMs: Number(process.env.LIVE_POLL_MS || 3000),
  liveMaxSeconds: Number(process.env.LIVE_MAX_SECONDS || 270),
  // Public base URL of the web app, encoded in event poster QR codes. Phones can't open
  // "localhost", so for on-device testing set this to http://<your-LAN-IP>:5173.
  publicWebUrl: (process.env.PUBLIC_WEB_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173')
  ).replace(/\/$/, ''),
  // Unset = no email provider yet: email attempts are recorded in the notification log as not sent.
  emailProvider: process.env.EMAIL_PROVIDER || null,
};
