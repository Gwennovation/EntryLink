// Hardening: brute-force protection, upload content checks, cookie sessions + CSRF, token
// revocation, live-feed auth, and production config guards.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createLiveEvent, PASSWORD, PNG, request, setup, teardown } from './helpers.js';

const { createApp } = await import('../src/app.js');

let ctx;
before(async () => { ctx = await setup(); });
after(teardown);

const login = (app, email, password, extra = {}) => request(app).post('/api/auth/login').send({ email, password, ...extra });

describe('brute-force protection', () => {
  it('locks an account after 5 wrong passwords, even for the right password', async () => {
    const email = 'gate_staff@test.local';
    for (let i = 0; i < 5; i++) assert.equal((await login(ctx.app, email, 'wrong-password')).status, 401);
    const locked = await login(ctx.app, email, PASSWORD);
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'account_locked');
    assert.match(locked.body.error.message, /Try again in \d+ minutes/);

    const audit = await ctx.as('admin').get('/api/audit?action=user.locked');
    assert.equal(audit.body.entries[0].entity_id, ctx.users.gate_staff.id);
  });

  it('an admin password reset unlocks the account', async () => {
    const res = await ctx.as('admin').post(`/api/users/${ctx.users.gate_staff.id}/reset-password`).send({ password: 'NewPassword456!' });
    assert.equal(res.status, 204);
    assert.equal((await login(ctx.app, 'gate_staff@test.local', 'NewPassword456!')).status, 200);
  });

  it('a successful sign-in resets the failure count', async () => {
    const email = 'coordinator@test.local';
    for (let i = 0; i < 4; i++) await login(ctx.app, email, 'nope-nope');
    assert.equal((await login(ctx.app, email, PASSWORD)).status, 200);
    for (let i = 0; i < 4; i++) await login(ctx.app, email, 'nope-nope');
    assert.equal((await login(ctx.app, email, PASSWORD)).status, 200, 'not locked: counter restarted after success');
  });

  it('rate-limits sign-in attempts per IP, and spoofed X-Forwarded-For does not help', async () => {
    const app = createApp(); // fresh counters
    let last;
    for (let i = 0; i < 31; i++) {
      last = await request(app).post('/api/auth/login').set('X-Forwarded-For', `10.0.0.${i}`)
        .send({ email: `nobody${i}@test.local`, password: 'whatever1' });
    }
    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'rate_limited');
  });
});

describe('upload content checks', () => {
  let event, paid;
  before(async () => {
    event = await createLiveEvent(ctx.as, { title: 'Upload Test', capacity: 50 });
    paid = event.ticket_types.find((t) => t.price_cents > 0);
  });

  const upload = (as, buffer, filename, contentType) => ctx.as(as).post('/api/registrations')
    .field('event_id', event.id).field('ticket_type_id', paid.id).field('payment_reference', 'REF-9')
    .attach('proof', buffer, { filename, contentType });

  it('rejects a script disguised as a PNG', async () => {
    const res = await upload('attendee', Buffer.from('<script>alert(1)</script>'), 'receipt.png', 'image/png');
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /isn't a valid/);
  });

  it('stores the detected type, not the claimed one, and serves images sandboxed', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
    const res = await upload('attendee', jpeg, 'receipt.png', 'image/png');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const proof = await ctx.as('coordinator').get(`/api/registrations/${res.body.registration.id}/proof`);
    assert.equal(proof.headers['content-type'], 'image/jpeg');
    assert.match(proof.headers['content-security-policy'], /sandbox/);
    assert.equal(proof.headers['x-content-type-options'], 'nosniff');
  });

  it('PDF proofs download instead of opening in the browser', async () => {
    const signup = await request(ctx.app).post('/api/auth/signup').send({ email: 'pdf@test.local', password: 'Password123!', full_name: 'Pdf Person' });
    const res = await request(ctx.app).post('/api/registrations').set('Authorization', `Bearer ${signup.body.token}`)
      .field('event_id', event.id).field('ticket_type_id', paid.id).field('payment_reference', 'REF-10')
      .attach('proof', Buffer.from('%PDF-1.7\n%fake but valid header\n'), { filename: 'r.pdf', contentType: 'application/pdf' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const proof = await ctx.as('coordinator').get(`/api/registrations/${res.body.registration.id}/proof`);
    assert.match(proof.headers['content-disposition'], /^attachment/);
  });

  it('accepts a real PNG', async () => {
    const signup = await request(ctx.app).post('/api/auth/signup').send({ email: 'png@test.local', password: 'Password123!', full_name: 'Png Person' });
    const res = await request(ctx.app).post('/api/registrations').set('Authorization', `Bearer ${signup.body.token}`)
      .field('event_id', event.id).field('ticket_type_id', paid.id).field('payment_reference', 'REF-11')
      .attach('proof', PNG, { filename: 'r.png', contentType: 'image/png' });
    assert.equal(res.status, 201);
  });
});

describe('web cookie sessions', () => {
  it('sets an httpOnly, SameSite=Strict cookie and never returns the token to the page', async () => {
    const res = await login(ctx.app, 'organizer@test.local', PASSWORD, { session: 'cookie' });
    assert.equal(res.status, 200);
    assert.equal(res.body.token, undefined);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('el_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api/);
  });

  it('reads work with the cookie; writes need the CSRF header', async () => {
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').send({ email: 'organizer@test.local', password: PASSWORD, session: 'cookie' });
    assert.equal((await agent.get('/api/auth/me')).body.user.email, 'organizer@test.local');

    const blocked = await agent.post('/api/notifications/read-all');
    assert.equal(blocked.status, 403, 'a forged cross-site POST has no custom header');
    const allowed = await agent.post('/api/notifications/read-all').set('X-Requested-With', 'EntryLink');
    assert.equal(allowed.status, 204);

    await agent.post('/api/auth/logout');
    assert.equal((await agent.get('/api/auth/me')).status, 401);
  });

  it('Bearer clients (mobile) do not need the CSRF header', async () => {
    assert.equal((await ctx.as('attendee').post('/api/notifications/read-all')).status, 204);
  });
});

describe('session revocation', () => {
  it('changing your password signs out other sessions but keeps this one', async () => {
    const other = (await login(ctx.app, 'attendee@test.local', PASSWORD)).body.token;
    const res = await request(ctx.app).post('/api/auth/change-password').set('Authorization', `Bearer ${other}`)
      .send({ current_password: PASSWORD, new_password: 'Changed789!' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.token, 'caller gets a fresh token');

    const stale = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${ctx.tokens.attendee}`);
    assert.equal(stale.status, 401);
    assert.match(stale.body.error.message, /session has ended/);
    const fresh = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    assert.equal(fresh.status, 200);
  });

  it('login responses never include password or lockout internals', async () => {
    const res = await login(ctx.app, 'admin@test.local', PASSWORD);
    for (const k of ['password_hash', 'failed_login_count', 'locked_until', 'token_version']) assert.equal(res.body.user[k], undefined, k);
  });
});

describe('live feed auth', () => {
  let event;
  before(async () => { event = await createLiveEvent(ctx.as, { title: 'Live Auth' }); });

  it('no longer accepts a token in the URL', async () => {
    const res = await request(ctx.app).get(`/api/events/${event.id}/live?access_token=${ctx.tokens.organizer}`);
    assert.equal(res.status, 401);
  });

  it('streams with the session cookie', async () => {
    const cookie = (await login(ctx.app, 'organizer@test.local', PASSWORD, { session: 'cookie' })).headers['set-cookie'][0].split(';')[0];
    const server = ctx.app.listen(0);
    try {
      const { statusCode, contentType } = await new Promise((resolve, reject) => {
        const req = http.get({ port: server.address().port, path: `/api/events/${event.id}/live`, headers: { cookie } }, (res) => {
          resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] });
          req.destroy();
        });
        req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
      });
      assert.equal(statusCode, 200);
      assert.match(contentType, /text\/event-stream/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

describe('production config guards', () => {
  const boot = (env) => spawnSync(process.execPath, ['-e', "import('./src/config.js').then(() => console.log('booted'))"], {
    cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), QR_SECRET: 'y'.repeat(40), ...env },
  });

  it('refuses to start in production with CORS open to every site', () => {
    const r = boot({});
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /CORS_ORIGINS must list/);
  });

  it('starts with an explicit origin list', () => {
    const r = boot({ CORS_ORIGINS: 'https://entrylink.example.com' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /booted/);
  });

  it('refuses to start in production without real secrets', () => {
    const r = boot({ CORS_ORIGINS: 'https://entrylink.example.com', JWT_SECRET: '' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /JWT_SECRET must be set/);
  });
});

