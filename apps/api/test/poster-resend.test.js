// Event poster QR (public registration link) and organizer "Resend ticket".
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createLiveEvent, request, setup, teardown } from './helpers.js';

let ctx, event, ticketId;

before(async () => {
  ctx = await setup();
  event = await createLiveEvent(ctx.as);
  const free = event.ticket_types.find((t) => t.price_cents === 0);
  const reg = await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
  ticketId = (await ctx.as('coordinator').post(`/api/registrations/${reg.body.registration.id}/approve`).send({})).body.ticket.id;
});
after(teardown);

describe('public event page API', () => {
  it('shows a published event without signing in', async () => {
    const res = await request(ctx.app).get(`/api/public/events/${event.id}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.event.title, 'Test Conference');
    assert.equal(res.body.event.registration_open, true);
    assert.equal(res.body.event.ticket_types.length, 2);
    assert.equal(res.body.event.organizer_id, undefined, 'no internal ids');
  });

  it('hides draft events', async () => {
    const draft = await ctx.as('organizer').post('/api/events').send({
      title: 'Secret Draft', venue: 'Hall', capacity: 5,
      starts_at: new Date(Date.now() + 86400_000).toISOString(), ends_at: new Date(Date.now() + 90000_000).toISOString(),
      ticket_types: [{ name: 'Free', price_cents: 0 }],
    });
    assert.equal((await request(ctx.app).get(`/api/public/events/${draft.body.event.id}`)).status, 404);
  });

  it('returns 404 for nonsense ids', async () => {
    assert.equal((await request(ctx.app).get('/api/public/events/not-a-uuid')).status, 404);
  });
});

describe('event poster QR', () => {
  it('gives the organizer a QR linking to the public event page', async () => {
    const res = await ctx.as('organizer').get(`/api/events/${event.id}/poster`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.url, `http://localhost:5173/e/${event.id}`);
    assert.ok(res.body.qr_image.startsWith('data:image/png;base64,'));
    assert.equal(res.body.link_is_local, true, 'warns that phones cannot open localhost');
  });

  it('refuses drafts (the link would not work yet)', async () => {
    const draft = await ctx.as('organizer').post('/api/events').send({
      title: 'Draft Two', venue: 'Hall', capacity: 5,
      starts_at: new Date(Date.now() + 86400_000).toISOString(), ends_at: new Date(Date.now() + 90000_000).toISOString(),
      ticket_types: [{ name: 'Free', price_cents: 0 }],
    });
    const res = await ctx.as('organizer').get(`/api/events/${draft.body.event.id}/poster`);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /Publish/);
  });

  it('refuses events that have already ended', async () => {
    const past = await createLiveEvent(ctx.as, {
      title: 'Last Week', starts_at: new Date(Date.now() - 8 * 86400_000).toISOString(), ends_at: new Date(Date.now() - 7 * 86400_000).toISOString(),
    });
    const res = await ctx.as('organizer').get(`/api/events/${past.id}/poster`);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /ended/);
    const pub = await request(ctx.app).get(`/api/public/events/${past.id}`);
    assert.equal(pub.body.event.registration_open, false);
  });

  for (const role of ['coordinator', 'gate_staff', 'attendee']) {
    it(`${role} cannot generate the poster`, async () => {
      assert.equal((await ctx.as(role).get(`/api/events/${event.id}/poster`)).status, 403);
    });
  }
});

describe('resend ticket', () => {
  it('records a (not yet configured) email when the ticket is first issued', async () => {
    const log = await ctx.as('admin').get('/api/notifications');
    const email = log.body.notifications.find((n) => n.channel === 'email');
    assert.ok(email, 'email attempt is in the notification log');
    assert.equal(email.delivery_status, 'not_configured');
  });

  it('re-sends to the attendee’s inbox and through the email hook', async () => {
    const res = await ctx.as('organizer').post(`/api/events/${event.id}/tickets/${ticketId}/resend`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.channels, { in_app: 'delivered', email: 'not_configured' });

    const inbox = await ctx.as('attendee').get('/api/notifications/mine');
    const resent = inbox.body.notifications.find((n) => n.type === 'ticket.resent');
    assert.ok(resent);
    assert.equal(resent.data.ticket_id, ticketId);
    assert.ok(inbox.body.notifications.every((n) => n.type !== 'email.ticket'), 'email records stay out of the inbox');

    const log = await ctx.as('admin').get('/api/notifications');
    assert.equal(log.body.notifications.filter((n) => n.channel === 'email').length, 2);

    const audit = await ctx.as('admin').get('/api/audit?action=ticket.resent');
    assert.equal(audit.body.entries[0].actor_id, ctx.users.organizer.id);
  });

  it('refuses to resend a ticket that was already used', async () => {
    const { body } = await ctx.as('organizer').get(`/api/events/${event.id}/tickets/${ticketId}/qr`);
    await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: event.id, payload: body.ticket.qr_payload });
    const res = await ctx.as('organizer').post(`/api/events/${event.id}/tickets/${ticketId}/resend`);
    assert.equal(res.status, 409);
  });

  it('only the owning organizer can resend', async () => {
    for (const role of ['coordinator', 'gate_staff', 'attendee', 'admin']) {
      assert.equal((await ctx.as(role).post(`/api/events/${event.id}/tickets/${ticketId}/resend`)).status, 403, role);
    }
  });
});
