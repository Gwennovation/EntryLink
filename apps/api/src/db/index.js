// Thin database layer with one interface over two drivers:
//   - node-postgres (pg) when DATABASE_URL is set — used in production
//   - PGlite (PostgreSQL compiled to WASM) otherwise — zero-install local dev and tests
// Both speak real PostgreSQL SQL, so queries and migrations are identical.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let driver = null;

const normalize = (r) => ({ rows: r.rows, rowCount: r.rowCount ?? r.affectedRows ?? 0 });

async function createPgDriver(url) {
  const { default: pg } = await import('pg');
  // Serverless instances each hold their own pool, so keep it small (use Neon's pooled URL).
  const pool = new pg.Pool({ connectionString: url, max: process.env.VERCEL ? 3 : 10, idleTimeoutMillis: 10_000 });
  return {
    name: 'postgres',
    query: async (sql, params) => normalize(await pool.query(sql, params)),
    exec: async (sql) => { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async (s, p) => normalize(await client.query(s, p)),
          exec: async (s) => { await client.query(s); },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPgliteDriver(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir !== 'memory://') fs.mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  await pglite.waitReady;
  return {
    name: dataDir === 'memory://' ? 'pglite (in-memory)' : `pglite (${dataDir})`,
    query: async (sql, params) => normalize(await pglite.query(sql, params)),
    exec: async (sql) => { await pglite.exec(sql); },
    tx: (fn) => pglite.transaction((t) => fn({ query: async (s, p) => normalize(await t.query(s, p)), exec: (s) => t.exec(s) })),
    close: () => pglite.close(),
  };
}

export async function initDb({ databaseUrl, pgliteDir }) {
  driver = databaseUrl ? await createPgDriver(databaseUrl) : await createPgliteDriver(pgliteDir);
  await migrate();
  return driver.name;
}

export async function closeDb() {
  if (driver) await driver.close();
  driver = null;
}

function current() {
  if (!driver) throw new Error('Database not initialised — call initDb() first');
  return driver;
}

/** Run a single query. Returns { rows, rowCount }. */
export const query = (sql, params = []) => current().query(sql, params);

/** Run fn(q) inside a transaction; q has the same shape as `query`. */
export const tx = (fn) => current().tx(fn);

export async function one(sql, params) {
  const { rows } = await query(sql, params);
  return rows[0] ?? null;
}

const MIGRATION_LOCK = 4_212_002;

/**
 * Apply pending migrations in one transaction under an advisory lock, so several instances
 * starting at once (serverless cold starts) can't apply the same migration twice.
 */
async function migrate() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  await tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await q.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await q.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(file)) continue;
      await q.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    }
  });
}
