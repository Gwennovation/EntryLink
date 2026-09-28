// Registration & Review Workflow (FR-001..FR-004).
//
// State machine:
//   pending ──approve──▶ approved (ticket issued)
//      │  └──reject───▶ rejected
//      └──request-revision──▶ revision_requested ──resubmit──▶ pending
//   pending | revision_requested | approved(not yet checked in) ──cancel──▶ cancelled
import { one, tx } from '../db/index.js';
import { publish } from '../lib/bus.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { issueTicket } from './tickets.js';

const STATUS_LABEL = {
  pending: 'pending review',
  revision_requested: 'awaiting revision',
  approved: 'already approved',
  rejected: 'already rejected',
  cancelled: 'cancelled',
};

async function addHistory(q, reg, fromStatus, actorId, note) {
  await q.query(
    `INSERT INTO registration_history (registration_id, version, from_status, to_status, actor_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [reg.id, reg.version, fromStatus, reg.status, actorId, note ?? null],
  );
}

async function lockRegistration(q, id) {
  const { rows } = await q.query('SELECT * FROM registrations WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFound('Registration');
  return rows[0];
}

function assertStatus(reg, allowed, verb) {
  if (!allowed.includes(reg.status)) {
    throw conflict(`Cannot ${verb} a registration that is ${STATUS_LABEL[reg.status]}.`, { status: reg.status });
  }
}

/** Throws if approving one more registration would exceed event or ticket-type capacity. */
async function assertCapacity(q, eventId, ticketTypeId) {
  const { rows } = await q.query(
    `SELECT e.capacity, tt.quantity,
            (SELECT count(*) FROM registrations WHERE event_id = e.id AND status = 'approved') AS event_approved,
            (SELECT count(*) FROM registrations WHERE ticket_type_id = tt.id AND status = 'approved') AS type_approved
       FROM events e JOIN ticket_types tt ON tt.event_id = e.id
      WHERE e.id = $1 AND tt.id = $2`,
    [eventId, ticketTypeId],
  );
  const c = rows[0];
  if (Number(c.event_approved) >= c.capacity) throw conflict('This event is sold out.');
  if (c.quantity != null && Number(c.type_approved) >= c.quantity) throw conflict('This ticket type is sold out.');
}

export async function submitRegistration({ attendeeId, eventId, ticketTypeId, paymentReference, proof }) {
  const reg = await tx(async (q) => {
    const { rows: [event] } = await q.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (!event || event.status === 'draft') throw notFound('Event');
    if (event.status !== 'published' || new Date(event.ends_at) < new Date()) {
      throw conflict('Registration for this event is closed.');
    }
    const { rows: [type] } = await q.query('SELECT * FROM ticket_types WHERE id = $1 AND event_id = $2', [ticketTypeId, eventId]);
    if (!type) throw badRequest('ticket_type_id: that ticket type does not belong to this event.');
    const { rows: [active] } = await q.query(
      `SELECT 1 FROM registrations WHERE event_id = $1 AND attendee_id = $2 AND status NOT IN ('rejected', 'cancelled')`,
      [eventId, attendeeId],
    );
    if (active) throw conflict('You already have an active registration for this event.');
    if (type.price_cents > 0 && !proof) throw badRequest('proof: a proof-of-payment file is required for paid tickets.');
    if (type.price_cents > 0 && !paymentReference) {
      throw badRequest('payment_reference: enter the reference number from your bank or e-wallet receipt.');
    }
    await assertCapacity(q, eventId, ticketTypeId);

    let inserted;
    try {
      ({ rows: [inserted] } = await q.query(
        `INSERT INTO registrations
           (event_id, ticket_type_id, attendee_id, amount_cents, payment_reference, proof_path, proof_mime, proof_original_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [eventId, ticketTypeId, attendeeId, type.price_cents, paymentReference ?? null,
          proof?.filename ?? null, proof?.mimetype ?? null, proof?.originalname ?? null],
      ));
    } catch (err) {
      if (err.code === '23505') throw conflict('You already have an active registration for this event.');
      throw err;
    }
    await addHistory(q, inserted, null, attendeeId);
    return inserted;
  });
  await publish('registration.submitted', {
    actorId: attendeeId, entityType: 'registration', entityId: reg.id, eventId: reg.event_id,
    data: { ticket_type_id: reg.ticket_type_id, amount_cents: reg.amount_cents },
  });
  return reg;
}

export async function resubmitRegistration({ attendeeId, registrationId, paymentReference, proof }) {
  const reg = await tx(async (q) => {
    const current = await lockRegistration(q, registrationId);
    if (current.attendee_id !== attendeeId) throw notFound('Registration');
    assertStatus(current, ['revision_requested'], 'resubmit');
    const { rows: [updated] } = await q.query(
      `UPDATE registrations
          SET status = 'pending', version = version + 1, updated_at = now(),
              payment_reference = coalesce($2, payment_reference),
              proof_path = coalesce($3, proof_path),
              proof_mime = coalesce($4, proof_mime),
              proof_original_name = coalesce($5, proof_original_name)
        WHERE id = $1 RETURNING *`,
      [registrationId, paymentReference ?? null, proof?.filename ?? null, proof?.mimetype ?? null, proof?.originalname ?? null],
    );
    await addHistory(q, updated, current.status, attendeeId);
    return updated;
  });
  await publish('registration.resubmitted', {
    actorId: attendeeId, entityType: 'registration', entityId: reg.id, eventId: reg.event_id,
    data: { version: reg.version, new_proof: Boolean(proof) },
  });
  return reg;
}

async function review(reviewerId, registrationId, toStatus, note, verb) {
  const result = await tx(async (q) => {
    const current = await lockRegistration(q, registrationId);
    assertStatus(current, ['pending'], verb);
    let ticket = null;
    if (toStatus === 'approved') {
      // Lock the event row so two coordinators approving at once can't oversell capacity.
      const { rows: [event] } = await q.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [current.event_id]);
      if (event.status === 'closed') throw conflict('This event is closed.');
      await assertCapacity(q, current.event_id, current.ticket_type_id);
    }
    const { rows: [updated] } = await q.query(
      `UPDATE registrations
          SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [registrationId, toStatus, note ?? null, reviewerId],
    );
    await addHistory(q, updated, current.status, reviewerId, note);
    if (toStatus === 'approved') ticket = await issueTicket(q, updated);
    return { registration: updated, ticket };
  });

  const { registration: reg, ticket } = result;
  await publish(`registration.${toStatus}`, {
    actorId: reviewerId, entityType: 'registration', entityId: reg.id, eventId: reg.event_id,
    data: { note: note ?? null, version: reg.version },
  });
  if (ticket) {
    await publish('ticket.issued', {
      actorId: reviewerId, entityType: 'ticket', entityId: ticket.id, eventId: ticket.event_id,
      data: { registration_id: reg.id, short_code: ticket.short_code },
    });
  }
  return result;
}

export const approveRegistration = (reviewerId, id, note) => review(reviewerId, id, 'approved', note, 'approve');
export const rejectRegistration = (reviewerId, id, note) => review(reviewerId, id, 'rejected', note, 'reject');
export const requestRevision = (reviewerId, id, note) => review(reviewerId, id, 'revision_requested', note, 'request a revision on');

export async function cancelRegistration({ attendeeId, registrationId }) {
  const result = await tx(async (q) => {
    const current = await lockRegistration(q, registrationId);
    if (current.attendee_id !== attendeeId) throw notFound('Registration');
    assertStatus(current, ['pending', 'revision_requested', 'approved'], 'cancel');
    let ticket = null;
    if (current.status === 'approved') {
      const { rows } = await q.query(
        `UPDATE tickets SET status = 'cancelled', updated_at = now()
          WHERE registration_id = $1 AND status = 'issued' RETURNING *`,
        [registrationId],
      );
      if (!rows[0]) throw conflict('This ticket has already been used and can no longer be cancelled.');
      ticket = rows[0];
    }
    const { rows: [updated] } = await q.query(
      `UPDATE registrations SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
      [registrationId],
    );
    await addHistory(q, updated, current.status, attendeeId);
    return { registration: updated, ticket };
  });
  const { registration: reg, ticket } = result;
  await publish('registration.cancelled', {
    actorId: attendeeId, entityType: 'registration', entityId: reg.id, eventId: reg.event_id,
  });
  if (ticket) {
    await publish('ticket.cancelled', {
      actorId: attendeeId, entityType: 'ticket', entityId: ticket.id, eventId: ticket.event_id,
      data: { registration_id: reg.id },
    });
  }
  return reg;
}

/**
 * Who may see a registration: its attendee, any coordinator, and the organizer who owns the event.
 * Returns the registration joined with event/ticket-type/attendee details.
 */
export async function getRegistrationFor(user, id) {
  const reg = await one(
    `SELECT r.*, e.title AS event_title, e.organizer_id, e.starts_at, e.venue, e.payment_instructions,
            tt.name AS ticket_type, u.full_name AS attendee_name, u.email AS attendee_email, u.phone AS attendee_phone,
            rv.full_name AS reviewer_name
       FROM registrations r
       JOIN events e ON e.id = r.event_id
       JOIN ticket_types tt ON tt.id = r.ticket_type_id
       JOIN users u ON u.id = r.attendee_id
       LEFT JOIN users rv ON rv.id = r.reviewed_by
      WHERE r.id = $1`,
    [id],
  );
  if (!reg) throw notFound('Registration');
  const allowed =
    (user.role === 'attendee' && reg.attendee_id === user.id) ||
    user.role === 'coordinator' ||
    (user.role === 'organizer' && reg.organizer_id === user.id);
  if (!allowed) {
    // Attendees shouldn't learn other people's registration IDs exist.
    if (user.role === 'attendee') throw notFound('Registration');
    throw forbidden();
  }
  return reg;
}
