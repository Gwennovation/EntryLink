// Audit Logging Service — subscribes to every domain event and appends a hash-chained record
// (FR-007, FR-010, NFR-003). The table itself rejects UPDATE/DELETE/TRUNCATE via trigger.
import crypto from 'node:crypto';
import { query, tx } from '../db/index.js';

const GENESIS = '0'.repeat(64);
const AUDIT_LOCK_KEY = 4_212_001; // serialises appends so the chain never forks

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function computeHash(row, prevHash) {
  const content = stableStringify({
    occurred_at: new Date(row.occurred_at).toISOString(),
    actor_id: row.actor_id ?? null,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id ?? null,
    data: row.data ?? {},
  });
  return crypto.createHash('sha256').update(prevHash).update(content).digest('hex');
}

export async function recordAudit({ name, actorId, entityType, entityId, eventId, data, occurredAt }) {
  // Round-trip through JSON so what we hash is exactly what jsonb stores (dates → strings, etc.).
  const payload = JSON.parse(JSON.stringify({ ...(eventId ? { event_id: eventId } : {}), ...data }));
  const row = {
    occurred_at: occurredAt,
    actor_id: actorId ?? null,
    action: name,
    entity_type: entityType,
    entity_id: entityId != null ? String(entityId) : null,
    data: payload,
  };
  await tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
    const last = await q.query('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    const prevHash = last.rows[0]?.hash ?? GENESIS;
    await q.query(
      `INSERT INTO audit_logs (occurred_at, actor_id, action, entity_type, entity_id, data, prev_hash, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.occurred_at, row.actor_id, row.action, row.entity_type, row.entity_id, row.data, prevHash, computeHash(row, prevHash)],
    );
  });
}

export async function listAudit({ entityType, entityId, action, actorId, before, limit = 50 }) {
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (entityType) add('a.entity_type = ?', entityType);
  if (entityId) add('a.entity_id = ?', entityId);
  if (action) add('a.action = ?', action);
  if (actorId) add('a.actor_id = ?', actorId);
  if (before) add('a.id < ?', before);
  params.push(limit);
  const { rows } = await query(
    `SELECT a.*, u.full_name AS actor_name, u.role AS actor_role
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Walks the whole chain and reports the first row whose hash or link doesn't match. */
export async function verifyAuditChain() {
  const { rows } = await query('SELECT * FROM audit_logs ORDER BY id ASC');
  let prev = GENESIS;
  for (const row of rows) {
    if (row.prev_hash !== prev || computeHash(row, prev) !== row.hash) {
      return { valid: false, checked: rows.length, brokenAtId: Number(row.id) };
    }
    prev = row.hash;
  }
  return { valid: true, checked: rows.length, headHash: prev };
}
