// Role-based access control and separation of duties (FR-014, NFR-002, spec §2.6).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createLiveEvent, request, setup, teardown } from './helpers.js';

let ctx, event, registrationId;

before(async () => {
  ctx = await setup();
  event = await createLiveEvent(ctx.as);
  const free = event.ticket_types.find((t) => t.price_cents === 0);
  const r = await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
  registrationId = r.body.registration.id;
});
after(teardown);

describe('RBAC', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(ctx.app).get('/api/events');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'unauthorized');
  });

  it('public signup always creates an attendee, never staff', async () => {
    const res = await request(ctx.app).post('/api/auth/signup')
      .send({ email: 'sneaky@test.local', password: 'Password123!', full_name: 'Sneaky', role: 'admin' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'attendee');
  });

  const denied = [
    ['admin cannot approve registrations', 'admin', 'post', () => `/api/registrations/${registrationId}/approve`],
    ['admin cannot scan tickets', 'admin', 'post', () => '/api/checkin/scan'],
    ['coordinator cannot scan tickets', 'coordinator', 'post', () => '/api/checkin/scan'],
    ['gate staff cannot approve registrations', 'gate_staff', 'post', () => `/api/registrations/${registrationId}/approve`],
    ['attendee cannot approve their own registration', 'attendee', 'post', () => `/api/registrations/${registrationId}/approve`],
    ['organizer cannot approve registrations', 'organizer', 'post', () => `/api/registrations/${registrationId}/approve`],
    ['attendee cannot list users', 'attendee', 'get', () => '/api/users'],
    ['organizer cannot read the audit log', 'organizer', 'get', () => '/api/audit'],
    ['coordinator cannot create events', 'coordinator', 'post', () => '/api/events'],
    ['gate staff cannot view reports', 'gate_staff', 'get', () => `/api/events/${event.id}/report`],
  ];
  for (const [name, role, method, url] of denied) {
    it(name, async () => {
      const res = await ctx.as(role)[method](url()).send({});
      assert.equal(res.status, 403, JSON.stringify(res.body));
    });
  }

  it('attendees cannot see other attendees’ registrations', async () => {
    const other = await request(ctx.app).post('/api/auth/signup')
      .send({ email: 'other@test.local', password: 'Password123!', full_name: 'Other' });
    const res = await request(ctx.app).get(`/api/registrations/${registrationId}`).set('Authorization', `Bearer ${other.body.token}`);
    assert.equal(res.status, 404);
  });

  it('organizers can only manage their own events', async () => {
    const created = await ctx.as('admin').post('/api/users').send({
      email: 'org2@test.local', full_name: 'Second Organizer', role: 'organizer', password: 'Password123!',
    });
    assert.equal(created.status, 201);
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'org2@test.local', password: 'Password123!' });
    const res = await request(ctx.app).patch(`/api/events/${event.id}`)
      .set('Authorization', `Bearer ${login.body.token}`).send({ title: 'Hijacked' });
    assert.equal(res.status, 403);
  });

  it('deactivating a user revokes access immediately', async () => {
    const created = await ctx.as('admin').post('/api/users').send({
      email: 'temp@test.local', full_name: 'Temp Gate', role: 'gate_staff', password: 'Password123!',
    });
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'temp@test.local', password: 'Password123!' });
    await ctx.as('admin').patch(`/api/users/${created.body.user.id}`).send({ is_active: false });
    const res = await request(ctx.app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(res.status, 401);
  });

  it('admin cannot demote or deactivate themselves', async () => {
    const res = await ctx.as('admin').patch(`/api/users/${ctx.users.admin.id}`).send({ is_active: false });
    assert.equal(res.status, 400);
  });

  it('returns clear validation messages (NFR-007)', async () => {
    const res = await ctx.as('organizer').post('/api/events').send({ title: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
    assert.ok(Array.isArray(res.body.error.details));
  });

  it('malformed ids return 404, not 500', async () => {
    const res = await ctx.as('coordinator').get('/api/registrations/not-a-uuid');
    assert.equal(res.status, 404);
  });
});
