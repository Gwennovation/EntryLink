import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate uploads per test run; must be set before config.js is imported.
// The dot-directory mirrors the real apps/api/.data/uploads layout.
process.env.UPLOAD_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'entrylink-test-')), '.data', 'uploads');

const { default: request } = await import('supertest');
const bcrypt = (await import('bcryptjs')).default;
const { createApp } = await import('../src/app.js');
const db = await import('../src/db/index.js');
const { registerSubscribers } = await import('../src/services/subscribers.js');

export { db, request };
export const PASSWORD = 'Password123!';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64',
);

/** Fresh in-memory database + app, with one user per role. */
export async function setup() {
  await db.initDb({ pgliteDir: 'memory://' });
  registerSubscribers();
  const app = createApp();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const users = {};
  for (const role of ['admin', 'organizer', 'coordinator', 'gate_staff', 'attendee']) {
    users[role] = await db.one(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING *`,
      [`${role}@test.local`, `Test ${role}`, role, hash],
    );
  }
  const tokens = {};
  for (const role of Object.keys(users)) {
    const res = await request(app).post('/api/auth/login').send({ email: `${role}@test.local`, password: PASSWORD });
    tokens[role] = res.body.token;
  }
  const as = (role) => {
    const agent = {};
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      agent[m] = (url) => request(app)[m](url).set('Authorization', `Bearer ${tokens[role]}`);
    }
    return agent;
  };
  return { app, users, tokens, as };
}

export async function teardown() {
  await db.closeDb();
}

/** Organizer creates + publishes an event that is currently running. */
export async function createLiveEvent(as, overrides = {}) {
  const now = Date.now();
  const res = await as('organizer').post('/api/events').send({
    title: 'Test Conference',
    venue: 'Test Hall',
    starts_at: new Date(now - 3600_000).toISOString(),
    ends_at: new Date(now + 3 * 3600_000).toISOString(),
    capacity: 2,
    ticket_types: [{ name: 'Regular', price_cents: 50000 }, { name: 'Free', price_cents: 0 }],
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createLiveEvent failed: ${JSON.stringify(res.body)}`);
  await as('organizer').post(`/api/events/${res.body.event.id}/publish`);
  return res.body.event;
}
