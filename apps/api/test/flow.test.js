import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createLiveEvent, db, PNG, request, setup, teardown } from './helpers.js';

let ctx;
before(async () => { ctx = await setup(); });
after(teardown);

describe('registration → approval → ticket → gate (spec §2.4)', () => {
  let event, regular, registration, ticket;

  before(async () => {
    event = await createLiveEvent(ctx.as);
    regular = event.ticket_types.find((t) => t.name === 'Regular');
  });

  it('requires proof of payment for paid tickets', async () => {
    const res = await ctx.as('attendee').post('/api/registrations')
      .field('event_id', event.id).field('ticket_type_id', regular.id).field('payment_reference', 'REF-1');
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /proof/);
  });

  it('rejects disallowed file types', async () => {
    const res = await ctx.as('attendee').post('/api/registrations')
      .field('event_id', event.id).field('ticket_type_id', regular.id).field('payment_reference', 'REF-1')
      .attach('proof', Buffer.from('#!/bin/sh'), { filename: 'x.sh', contentType: 'application/x-sh' });
    assert.equal(res.status, 400);
  });

  it('lets an attendee register with proof of payment (FR-001, FR-002)', async () => {
    const res = await ctx.as('attendee').post('/api/registrations')
      .field('event_id', event.id).field('ticket_type_id', regular.id).field('payment_reference', 'BDO-123')
      .attach('proof', PNG, { filename: 'receipt.png', contentType: 'image/png' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    registration = res.body.registration;
    assert.equal(registration.status, 'pending');
    assert.equal(registration.amount_cents, 50000);
    assert.equal(registration.has_proof, true);
    assert.equal(registration.proof_path, undefined, 'storage path must not leak');
  });

  it('blocks a second active registration for the same event', async () => {
    const res = await ctx.as('attendee').post('/api/registrations')
      .field('event_id', event.id).field('ticket_type_id', event.ticket_types.find((t) => t.price_cents === 0).id);
    assert.equal(res.status, 409);
  });

  it('lets the coordinator view the proof file', async () => {
    const res = await ctx.as('coordinator').get(`/api/registrations/${registration.id}/proof`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
  });

  it('has no ticket QR before approval', async () => {
    const res = await ctx.as('coordinator').get(`/api/registrations/${registration.id}/ticket-qr`);
    assert.equal(res.status, 404);
  });

  it('supports request-revision → resubmit (FR-003, version tracking)', async () => {
    const noNote = await ctx.as('coordinator').post(`/api/registrations/${registration.id}/request-revision`).send({});
    assert.equal(noNote.status, 400, 'a note is required');

    const rr = await ctx.as('coordinator').post(`/api/registrations/${registration.id}/request-revision`)
      .send({ note: 'Receipt is blurry' });
    assert.equal(rr.body.registration.status, 'revision_requested');

    const resub = await ctx.as('attendee').put(`/api/registrations/${registration.id}/resubmit`)
      .attach('proof', PNG, { filename: 'receipt2.png', contentType: 'image/png' });
    assert.equal(resub.status, 200, JSON.stringify(resub.body));
    assert.equal(resub.body.registration.status, 'pending');
    assert.equal(resub.body.registration.version, 2);

    const detail = await ctx.as('attendee').get(`/api/registrations/${registration.id}`);
    assert.deepEqual(detail.body.history.map((h) => h.to_status), ['pending', 'revision_requested', 'pending']);
  });

  it('auto-issues a QR ticket on approval and notifies the attendee (FR-004)', async () => {
    const res = await ctx.as('coordinator').post(`/api/registrations/${registration.id}/approve`).send({});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.registration.status, 'approved');
    assert.match(res.body.ticket.short_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const again = await ctx.as('coordinator').post(`/api/registrations/${registration.id}/approve`).send({});
    assert.equal(again.status, 409, 'cannot approve twice');

    const wallet = await ctx.as('attendee').get('/api/tickets/mine');
    assert.equal(wallet.body.tickets.length, 1);
    ticket = wallet.body.tickets[0];
    assert.ok(ticket.qr_payload.startsWith('EL1.'));
    assert.ok(ticket.qr_image.startsWith('data:image/png;base64,'));
    assert.equal(ticket.secret, undefined, 'raw secret must not leak');

    const notes = await ctx.as('attendee').get('/api/notifications/mine');
    assert.ok(notes.body.notifications.some((n) => n.type === 'ticket.issued'));
  });

  it('shows the same issued QR on the coordinator registration screen', async () => {
    const url = `/api/registrations/${registration.id}/ticket-qr`;
    for (const role of ['coordinator', 'organizer']) {
      const res = await ctx.as(role).get(url);
      assert.equal(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ticket.qr_payload, ticket.qr_payload);
      assert.ok(res.body.ticket.qr_image.startsWith('data:image/png;base64,'));
      assert.equal(res.body.ticket.secret, undefined);
      assert.match(res.headers['cache-control'], /no-store/);
    }
    for (const role of ['admin', 'gate_staff', 'attendee']) {
      assert.equal((await ctx.as(role).get(url)).status, 403, role);
    }
    const audit = await ctx.as('admin').get('/api/audit?action=ticket.qr_viewed');
    assert.ok(audit.body.entries.some((entry) => entry.actor_id === ctx.users.coordinator.id && entry.entity_id === ticket.id));
  });

  it('accepts a valid scan, then rejects the duplicate (FR-005, FR-006)', async () => {
    const t0 = Date.now();
    const first = await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: event.id, payload: ticket.qr_payload });
    assert.ok(Date.now() - t0 < 2000, 'NFR-005: scan under 2s');
    assert.equal(first.body.valid, true, JSON.stringify(first.body));
    assert.equal(first.body.result, 'accepted');

    const dup = await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: event.id, payload: ticket.qr_payload });
    assert.equal(dup.body.valid, false);
    assert.equal(dup.body.result, 'duplicate');
    assert.match(dup.body.message, /Already checked in/);
  });

  it('rejects forged and tampered QR payloads', async () => {
    const tampered = ticket.qr_payload.slice(0, -2) + (ticket.qr_payload.endsWith('A') ? 'BB' : 'AA');
    for (const payload of ['hello', tampered, `EL1.${ticket.id}.guess.sig`]) {
      const res = await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: event.id, payload });
      assert.equal(res.body.result, 'invalid', payload);
    }
  });

  it('rejects a ticket scanned at the wrong event', async () => {
    const other = await createLiveEvent(ctx.as, { title: 'Other Event' });
    const res = await ctx.as('gate_staff').post('/api/checkin/scan').send({ event_id: other.id, payload: ticket.qr_payload });
    assert.equal(res.body.result, 'wrong_event');
  });

  it('shows correct live stats and a report (FR-008, FR-013)', async () => {
    const stats = await ctx.as('organizer').get(`/api/events/${event.id}/stats`);
    assert.equal(stats.body.stats.checked_in, 1);
    assert.equal(stats.body.stats.tickets_issued, 1);
    assert.equal(stats.body.stats.revenue_cents, 50000);
    assert.ok(stats.body.stats.rejected_scans >= 4);

    const report = await ctx.as('organizer').get(`/api/events/${event.id}/report`);
    assert.equal(report.body.report.attendees.length, 1);
    assert.equal(report.body.report.summary.attendance_rate, 1);

    const csv = await ctx.as('organizer').get(`/api/events/${event.id}/report?format=csv`);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /Test attendee/);
  });

  it('records every step in a verifiable, append-only audit trail (FR-007, FR-010, NFR-003)', async () => {
    const res = await ctx.as('admin').get('/api/audit?limit=200');
    const actions = res.body.entries.map((e) => e.action);
    for (const a of ['registration.submitted', 'registration.revision_requested', 'registration.resubmitted',
      'registration.approved', 'ticket.issued', 'ticket.checked_in', 'ticket.scan_rejected']) {
      assert.ok(actions.includes(a), `missing ${a}`);
    }
    const verify = await ctx.as('admin').get('/api/audit/verify');
    assert.equal(verify.body.valid, true);

    await assert.rejects(db.query(`UPDATE audit_logs SET action = 'x'`), /append-only/);
    await assert.rejects(db.query(`DELETE FROM audit_logs`), /append-only/);
  });
});

describe('capacity', () => {
  it('will not approve beyond event capacity', async () => {
    const event = await createLiveEvent(ctx.as, { title: 'Tiny', capacity: 1 });
    const free = event.ticket_types.find((t) => t.price_cents === 0);
    const regs = [];
    for (const n of [1, 2]) {
      const signup = await request(ctx.app).post('/api/auth/signup')
        .send({ email: `cap${n}@test.local`, password: 'Password123456!', full_name: `Cap ${n}` });
      const r = await request(ctx.app).post('/api/registrations').set('Authorization', `Bearer ${signup.body.token}`)
        .field('event_id', event.id).field('ticket_type_id', free.id);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      regs.push(r.body.registration);
    }
    assert.equal((await ctx.as('coordinator').post(`/api/registrations/${regs[0].id}/approve`).send({})).status, 200);
    const second = await ctx.as('coordinator').post(`/api/registrations/${regs[1].id}/approve`).send({});
    assert.equal(second.status, 409);
    assert.match(second.body.error.message, /sold out/);
  });
});
