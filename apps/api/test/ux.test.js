// API support for the design/UX pass: payment instructions, "already registered", queue counts.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createLiveEvent, setup, teardown } from './helpers.js';

let ctx;
before(async () => { ctx = await setup(); });
after(teardown);

const draft = (overrides = {}) => ctx.as('organizer').post('/api/events').send({
  title: 'Paid Draft', venue: 'Hall', capacity: 10,
  starts_at: new Date(Date.now() + 86400_000).toISOString(), ends_at: new Date(Date.now() + 90000_000).toISOString(),
  ticket_types: [{ name: 'Regular', price_cents: 10000 }],
  ...overrides,
});

describe('payment instructions', () => {
  it('a paid event cannot be published without them', async () => {
    const { body } = await draft();
    const res = await ctx.as('organizer').post(`/api/events/${body.event.id}/publish`);
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /payment instructions/);
  });

  it('a free event can be published without them', async () => {
    const { body } = await draft({ ticket_types: [{ name: 'Free', price_cents: 0 }] });
    assert.equal((await ctx.as('organizer').post(`/api/events/${body.event.id}/publish`)).status, 200);
  });

  it('once set, publishing works and attendees see them', async () => {
    const { body } = await draft({ payment_instructions: 'GCash 0917 111 2222 (Org)' });
    assert.equal((await ctx.as('organizer').post(`/api/events/${body.event.id}/publish`)).status, 200);
    const seen = await ctx.as('attendee').get(`/api/events/${body.event.id}`);
    assert.equal(seen.body.event.payment_instructions, 'GCash 0917 111 2222 (Org)');
  });

  it('cannot be cleared on a published paid event, and a paid type cannot be added to a free one without them', async () => {
    const event = await createLiveEvent(ctx.as, { title: 'Clear Test' });
    const clear = await ctx.as('organizer').patch(`/api/events/${event.id}`).send({ payment_instructions: '  ' });
    assert.equal(clear.status, 409);

    const { body } = await draft({ title: 'Free Then Paid', ticket_types: [{ name: 'Free', price_cents: 0 }] });
    await ctx.as('organizer').post(`/api/events/${body.event.id}/publish`);
    const add = await ctx.as('organizer').post(`/api/events/${body.event.id}/ticket-types`).send({ name: 'VIP', price_cents: 5000 });
    assert.equal(add.status, 409);
  });

  it('are included on the registration so the revision screen can show them', async () => {
    const event = await createLiveEvent(ctx.as, { title: 'Reg Detail' });
    const free = event.ticket_types.find((t) => t.price_cents === 0);
    const reg = await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
    const detail = await ctx.as('attendee').get(`/api/registrations/${reg.body.registration.id}`);
    assert.equal(detail.body.registration.payment_instructions, 'GCash 0917 000 0000 (Test Events)');
  });
});

describe('"already registered" state', () => {
  it('attendees see their own booking on the event, others see none', async () => {
    const event = await createLiveEvent(ctx.as, { title: 'Mine Test', capacity: 5 });
    const free = event.ticket_types.find((t) => t.price_cents === 0);
    const before = await ctx.as('attendee').get(`/api/events/${event.id}`);
    assert.equal(before.body.event.my_registration, null);

    const reg = await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
    await ctx.as('coordinator').post(`/api/registrations/${reg.body.registration.id}/approve`).send({});

    const detail = await ctx.as('attendee').get(`/api/events/${event.id}`);
    assert.equal(detail.body.event.my_registration.status, 'approved');
    assert.ok(detail.body.event.my_registration.ticket_id);
    const list = await ctx.as('attendee').get('/api/events');
    assert.equal(list.body.events.find((e) => e.id === event.id).my_registration.id, reg.body.registration.id);
    const staff = await ctx.as('organizer').get(`/api/events/${event.id}`);
    assert.equal(staff.body.event.my_registration, null);
  });

  it('a cancelled booking no longer counts as registered', async () => {
    const event = await createLiveEvent(ctx.as, { title: 'Cancel Test', capacity: 5 });
    const free = event.ticket_types.find((t) => t.price_cents === 0);
    const reg = await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
    await ctx.as('attendee').post(`/api/registrations/${reg.body.registration.id}/cancel`);
    assert.equal((await ctx.as('attendee').get(`/api/events/${event.id}`)).body.event.my_registration, null);
  });
});

describe('review queue counts', () => {
  it('counts every status for the current filters, whatever tab is selected', async () => {
    const event = await createLiveEvent(ctx.as, { title: 'Count Test', capacity: 5 });
    const free = event.ticket_types.find((t) => t.price_cents === 0);
    await ctx.as('attendee').post('/api/registrations').field('event_id', event.id).field('ticket_type_id', free.id);
    const res = await ctx.as('coordinator').get(`/api/registrations?event_id=${event.id}&status=approved`);
    assert.equal(res.body.registrations.length, 0, 'list honours the status tab');
    assert.equal(res.body.counts.pending, 1, 'counts ignore the status tab');
    assert.equal(res.body.counts.all, 1);
  });
});
