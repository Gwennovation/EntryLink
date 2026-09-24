// Gate-scan validation pipeline (FR-005, FR-006).
// Every attempt — accepted or not — is written to entry_logs and published on the bus.
import { one, query, tx } from '../db/index.js';
import { publish } from '../lib/bus.js';
import { notFound } from '../lib/errors.js';
import { parsePayload } from '../lib/qr.js';
import { TICKET_VIEW_SQL } from './tickets.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timeOf = (d) => new Date(d).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' });

async function logEntry(q, { eventId, ticketId, staffId, method, result, note }) {
  await q.query(
    `INSERT INTO entry_logs (event_id, ticket_id, scanned_by, method, result, note) VALUES ($1, $2, $3, $4, $5, $6)`,
    [eventId, ticketId ?? null, staffId, method, result, note ?? null],
  );
}

function ticketSummary(t) {
  return t && { id: t.id, short_code: t.short_code, attendee_name: t.attendee_name, ticket_type: t.ticket_type, status: t.status, checked_in_at: t.checked_in_at };
}

/**
 * Core admission logic shared by QR scans and manual overrides.
 * @returns {{ valid: boolean, result: string, message: string, ticket?: object }}
 */
async function admit({ ticket, eventId, staffId, method, note }) {
  const outcome = await tx(async (q) => {
    const reject = async (result, message, t = ticket) => {
      await logEntry(q, { eventId, ticketId: t?.id, staffId, method, result, note });
      return { valid: false, result, message, ticket: ticketSummary(t) };
    };

    if (!ticket) return reject('invalid', 'Not a valid EntryLink ticket.', null);

    if (ticket.event_id !== eventId) {
      return reject('wrong_event', `This ticket is for a different event: ${ticket.event_title}.`);
    }
    if (ticket.status === 'cancelled') return reject('not_active', 'This ticket was cancelled.');
    if (ticket.status === 'expired' || new Date(ticket.ends_at) < new Date()) {
      await q.query(`UPDATE tickets SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'issued'`, [ticket.id]);
      return reject('expired', 'This ticket has expired — the event has ended.');
    }

    // Atomic flip: only one concurrent scan can move a ticket out of 'issued'. Everyone else sees a duplicate.
    const { rows: [admitted] } = await q.query(
      `UPDATE tickets SET status = 'checked_in', checked_in_at = now(), checked_in_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'issued' RETURNING checked_in_at`,
      [ticket.id, staffId],
    );
    if (!admitted) {
      const { rows: [prior] } = await q.query(
        `SELECT t.status, t.checked_in_at, u.full_name AS staff_name
           FROM tickets t LEFT JOIN users u ON u.id = t.checked_in_by WHERE t.id = $1`,
        [ticket.id],
      );
      // Lost a race with a cancellation rather than another scan.
      if (prior.status !== 'checked_in') return reject('not_active', `This ticket is ${prior.status}.`);
      const current = { ...ticket, status: 'checked_in', checked_in_at: prior.checked_in_at };
      return reject('duplicate',
        `Already checked in at ${timeOf(prior.checked_in_at)}${prior.staff_name ? ` by ${prior.staff_name}` : ''}.`, current);
    }

    await logEntry(q, { eventId, ticketId: ticket.id, staffId, method, result: 'accepted', note });
    return {
      valid: true,
      result: 'accepted',
      message: `Welcome, ${ticket.attendee_name}!`,
      ticket: ticketSummary({ ...ticket, status: 'checked_in', checked_in_at: admitted.checked_in_at }),
    };
  });

  if (outcome.valid) {
    await publish('ticket.checked_in', {
      actorId: staffId, entityType: 'ticket', entityId: ticket.id, eventId,
      data: { registration_id: ticket.registration_id, short_code: ticket.short_code, attendee_name: ticket.attendee_name, method, note: note ?? null },
    });
  } else {
    await publish('ticket.scan_rejected', {
      actorId: staffId, entityType: 'ticket', entityId: outcome.ticket?.id ?? null, eventId,
      data: { result: outcome.result, method, short_code: outcome.ticket?.short_code ?? null },
    });
  }
  return outcome;
}

export async function scanTicket({ eventId, payload, staffId }) {
  const parsed = parsePayload(payload);
  let ticket = null;
  if (parsed && UUID.test(parsed.ticketId)) {
    ticket = await one(`${TICKET_VIEW_SQL} WHERE t.id = $1 AND t.secret = $2`, [parsed.ticketId, parsed.secret]);
  }
  return admit({ ticket, eventId, staffId, method: 'scan' });
}

/** Manual override for edge cases (damaged phone screen, no battery…) — reason is mandatory and logged. */
export async function manualCheckIn({ eventId, ticketId, staffId, reason }) {
  const ticket = await one(`${TICKET_VIEW_SQL} WHERE t.id = $1`, [ticketId]);
  if (!ticket) throw notFound('Ticket');
  return admit({ ticket, eventId, staffId, method: 'manual', note: reason });
}

/** Search an event's tickets by short code, attendee name or email for manual override. */
export async function lookupTickets({ eventId, q }) {
  const term = `%${q.trim()}%`;
  const { rows } = await query(
    `${TICKET_VIEW_SQL}
      WHERE t.event_id = $1 AND (t.short_code ILIKE $2 OR u.full_name ILIKE $2 OR u.email ILIKE $2)
      ORDER BY u.full_name LIMIT 20`,
    [eventId, term],
  );
  return rows.map(ticketSummary);
}
