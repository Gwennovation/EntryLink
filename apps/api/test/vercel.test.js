// The Vercel Function wrapper (/api/index.js) and first-boot demo seeding, run in-process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = 'memory://';
process.env.UPLOAD_DIR = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'entrylink-vercel-')), '.data', 'uploads');
process.env.SEED_DEMO = 'true';

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

const { default: request } = await import('supertest');
const { default: handler } = await import('../../../api/index.js');
const { bootstrap } = await import('../src/bootstrap.js');
const db = await import('../src/db/index.js');

let server;
before(() => { server = http.createServer(handler); });
after(async () => { await db.closeDb(); });

describe('Vercel function', () => {
  it('routes /api/* by the original path', async () => {
    const res = await request(server).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('seeds the demo data exactly once on first boot', async () => {
    await Promise.all([bootstrap(), bootstrap(), bootstrap()]); // concurrent cold starts share one init
    const { n } = await db.one('SELECT count(*)::int AS n FROM users');
    assert.equal(n, 7);
    const login = await request(server).post('/api/auth/login').send({ email: 'organizer@entrylink.test', password: 'EntryLink123!' });
    assert.equal(login.status, 200);
  });

  it('handles multipart uploads and serves the stored proof', async () => {
    const coord = (await request(server).post('/api/auth/login').send({ email: 'coordinator@entrylink.test', password: 'EntryLink123!' })).body.token;
    const queue = await request(server).get('/api/registrations?status=pending').set('Authorization', `Bearer ${coord}`);
    const withProof = queue.body.registrations.find((r) => r.has_proof);
    const proof = await request(server).get(`/api/registrations/${withProof.id}/proof`).set('Authorization', `Bearer ${coord}`);
    assert.equal(proof.status, 200);
    assert.equal(proof.headers['content-type'], 'image/png');
    assert.ok(proof.body.length > 0);
  });

  it('rejects uploads over 4 MB with a clear message', async () => {
    const signup = await request(server).post('/api/auth/signup').send({ email: 'big@test.local', password: 'Password123!', full_name: 'Big File' });
    const events = await request(server).get('/api/events').set('Authorization', `Bearer ${signup.body.token}`);
    const e = events.body.events[0];
    const paid = e.ticket_types.find((t) => t.price_cents > 0);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4 * 1024 * 1024)]);
    const res = await request(server).post('/api/registrations').set('Authorization', `Bearer ${signup.body.token}`)
      .field('event_id', e.id).field('ticket_type_id', paid.id).field('payment_reference', 'R1')
      .attach('proof', big, { filename: 'big.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /4 MB or smaller/);
  });
});
