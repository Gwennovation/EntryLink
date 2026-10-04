// Organizer backup copies of attendee QR tickets (for when delivery to the attendee fails).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createLiveEvent, request, setup, teardown } from './helpers.js';

let ctx, event, ticketId, walletPayload;

before(async () => {
  ctx = await setup();
  event = await createLiveEvent(ctx.as);
  const free = event.ticket_types.find((t) => t.price_cents === 0);
  const reg = await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
  const approved = await ctx.as('coordinator').post(`/api/registrations/${reg.body.registration.id}/approve`).send({});
  ticketId = approved.body.ticket.id;
  walletPayload = (await ctx.as('attendee').get('/api/tickets/mine')).body.tickets[0].qr_payload;
});
after(teardown);

describe('organizer ticket roster & backup QR codes', () => {
  it('lists the event’s tickets without exposing QR secrets', async () => {
    const res = await ctx.as('organizer').get(`/api/events/${event.id}/tickets`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.tickets.length, 1);
    const [t] = res.body.tickets;
    assert.equal(t.attendee_email, 'attendee@test.local');
    assert.equal(t.secret, undefined);
    assert.equal(t.qr_payload, undefined, 'roster is a list, not credentials');
    assert.equal(res.body.truncated, false);
  });

  it('filters by name, email or code', async () => {
    const hit = await ctx.as('organizer').get(`/api/events/${event.id}/tickets?q=attendee@test`);
    assert.equal(hit.body.tickets.length, 1);
    const miss = await ctx.as('organizer').get(`/api/events/${event.id}/tickets?q=nobody`);
    assert.equal(miss.body.tickets.length, 0);
  });

  it('returns the same QR the attendee has in their wallet', async () => {
    const res = await ctx.as('organizer').get(`/api/events/${event.id}/tickets/${ticketId}/qr`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ticket.qr_payload, walletPayload);
    assert.ok(res.body.ticket.qr_image.startsWith('data:image/png;base64,'));
    assert.equal(res.body.ticket.secret, undefined);
  });

  it('prints a sheet of issued tickets with QR images', async () => {
    const res = await ctx.as('organizer').get(`/api/events/${event.id}/tickets/qr-sheet?status=issued`);
    assert.equal(res.status, 200);
    assert.equal(res.body.tickets.length, 1);
    assert.ok(res.body.tickets[0].qr_image.startsWith('data:image/png;base64,'));
  });

  it('an organizer-provided QR is accepted at the gate, exactly once', async () => {
    const { body } = await ctx.as('organizer').get(`/api/events/${event.id}/tickets/${ticketId}/qr`);
    const first = await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: event.id, payload: body.ticket.qr_payload });
    assert.equal(first.body.result, 'accepted');
    // Attendee also shows up with their own copy — still one entry.
    const second = await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: event.id, payload: walletPayload });
    assert.equal(second.body.result, 'duplicate');

    const sheet = await ctx.as('organizer').get(`/api/events/${event.id}/tickets/qr-sheet?status=issued`);
    assert.equal(sheet.body.tickets.length, 0, 'checked-in tickets drop off the issued sheet');
  });

  it('audits every QR view and export', async () => {
    const res = await ctx.as('admin').get('/api/audit?limit=200');
    const viewed = res.body.entries.filter((e) => e.action === 'ticket.qr_viewed');
    const exported = res.body.entries.filter((e) => e.action === 'ticket.qr_exported');
    assert.ok(viewed.length >= 2);
    assert.ok(viewed.every((e) => e.actor_id === ctx.users.organizer.id && e.entity_id === ticketId));
    assert.ok(exported.length >= 2);
    assert.deepEqual(exported.at(-1).data.short_codes.length, 1);
    assert.equal((await ctx.as('admin').get('/api/audit/verify')).body.valid, true);
  });

  for (const role of ['coordinator', 'gate_staff', 'attendee', 'admin']) {
    it(`${role} cannot pull attendee QR codes`, async () => {
      for (const url of [`/api/events/${event.id}/tickets`, `/api/events/${event.id}/tickets/${ticketId}/qr`, `/api/events/${event.id}/tickets/qr-sheet`]) {
        const res = await ctx.as(role).get(url);
        assert.equal(res.status, 403, `${role} ${url}`);
      }
    });
  }

  it('another organizer cannot pull this event’s QR codes', async () => {
    await ctx.as('admin').post('/api/users').send({ email: 'org2@test.local', full_name: 'Other Org', role: 'organizer', password: 'Password123456!' });
    const login = await request(ctx.app).post('/api/auth/login').send({ email: 'org2@test.local', password: 'Password123456!' });
    const res = await request(ctx.app).get(`/api/events/${event.id}/tickets/${ticketId}/qr`).set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(res.status, 403);
    const reviewQr = await request(ctx.app).get(`/api/registrations/${(await ctx.as('attendee').get('/api/tickets/mine')).body.tickets[0].registration_id}/ticket-qr`)
      .set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(reviewQr.status, 403);
  });

  it('a ticket id from a different event is not found', async () => {
    const other = await createLiveEvent(ctx.as, { title: 'Other Event' });
    const res = await ctx.as('organizer').get(`/api/events/${other.id}/tickets/${ticketId}/qr`);
    assert.equal(res.status, 404);
  });
});
