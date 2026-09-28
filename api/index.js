// Vercel Function: the whole EntryLink API. vercel.json rewrites every /api/* request here, and
// Express routes it by the original path. Initialisation (DB, migrations, subscribers, optional
// demo seed) runs once per function instance and is reused by later requests.
import { createApp } from '../apps/api/src/app.js';
import { bootstrap } from '../apps/api/src/bootstrap.js';

const app = createApp();

export default async function handler(req, res) {
  try {
    await bootstrap();
  } catch (err) {
    console.error('[api] startup failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'unavailable', message: 'EntryLink is starting up or misconfigured. Please try again shortly.' } }));
    return;
  }
  // Vercel's optional request helpers expose a lazy, read-only `req.body`, which clashes with
  // Express's body parsers. The setup guide turns them off (NODEJS_HELPERS=0); this is a fallback.
  try {
    Object.defineProperty(req, 'body', { value: undefined, writable: true, configurable: true, enumerable: true });
  } catch { /* helpers already disabled */ }
  return app(req, res);
}
