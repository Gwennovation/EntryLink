// One-time startup shared by the local server (server.js) and the Vercel Function (/api/index.js):
// connect + migrate the database, wire bus subscribers, and optionally seed demo data.
import { config } from './config.js';
import { seedDemo } from './db/demo.js';
import { initDb, query } from './db/index.js';
import { registerSubscribers } from './services/subscribers.js';

let ready = null;

async function seedDemoOnce() {
  // Exactly one instance claims the job, even if several cold-start at the same moment.
  const { rowCount } = await query(`INSERT INTO app_flags (name) VALUES ('demo_seeded') ON CONFLICT DO NOTHING`);
  if (!rowCount) return;
  try {
    const summary = await seedDemo();
    console.log(summary ? `[bootstrap] seeded demo data: ${JSON.stringify(summary)}` : '[bootstrap] users already exist; demo seed skipped');
  } catch (err) {
    await query(`DELETE FROM app_flags WHERE name = 'demo_seeded'`).catch(() => {});
    throw err;
  }
}

/** Idempotent; concurrent callers share one initialisation. Retries on the next call if it failed. */
export function bootstrap() {
  ready ??= (async () => {
    const dbName = await initDb(config);
    registerSubscribers();
    if (config.seedDemo) await seedDemoOnce();
    return dbName;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
