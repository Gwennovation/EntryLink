// Ticketing Service — issues QR tickets and renders them for the attendee's wallet (FR-004).
import { query } from '../db/index.js';
import { buildPayload, newShortCode, newTicketSecret, toDataUrl } from '../lib/qr.js';

/** Insert a ticket for an approved registration. Must run inside the approval transaction. */
export async function issueTicket(q, registration) {
  const { rows } = await q.query(
    `INSERT INTO tickets (registration_id, event_id, attendee_id, secret, short_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [registration.id, registration.event_id, registration.attendee_id, newTicketSecret(), newShortCode()],
  );
  return rows[0];
}

const TICKET_VIEW_SQL = `
  SELECT t.id, t.registration_id, t.event_id, t.attendee_id, t.secret, t.short_code, t.status,
         t.issued_at, t.checked_in_at,
         e.title AS event_title, e.venue, e.starts_at, e.ends_at,
         tt.name AS ticket_type, u.full_name AS attendee_name, u.email AS attendee_email
    FROM tickets t
    JOIN events e ON e.id = t.event_id
    JOIN registrations r ON r.id = t.registration_id
    JOIN ticket_types tt ON tt.id = r.ticket_type_id
    JOIN users u ON u.id = t.attendee_id`;

/** Ticket without its secret — for lists that don't need the QR. */
const withoutSecret = ({ secret, ...rest }) => rest;

/** Ticket with its QR. The secret is only ever exposed inside the signed QR payload. */
async function present(row) {
  const qrPayload = buildPayload(row.id, row.secret);
  return { ...withoutSecret(row), qr_payload: qrPayload, qr_image: await toDataUrl(qrPayload) };
}

export async function ticketsForAttendee(attendeeId) {
  const { rows } = await query(`${TICKET_VIEW_SQL} WHERE t.attendee_id = $1 ORDER BY e.starts_at`, [attendeeId]);
  return Promise.all(rows.map(present));
}

export async function ticketForAttendee(ticketId, attendeeId) {
  const { rows } = await query(`${TICKET_VIEW_SQL} WHERE t.id = $1 AND t.attendee_id = $2`, [ticketId, attendeeId]);
  return rows[0] ? present(rows[0]) : null;
}

// ---- Organizer backup copies --------------------------------------------------------------------
// If an attendee never received their ticket (failed delivery, lost phone, no app), the event's
// organizer can view, download or print the same QR. Callers must audit every access.

export const ROSTER_LIMIT = 500;

function rosterWhere(eventId, { status, q }) {
  const params = [eventId];
  const where = ['t.event_id = $1'];
  if (status) { params.push(status); where.push(`t.status = $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    const n = params.length;
    where.push(`(u.full_name ILIKE $${n} OR u.email ILIKE $${n} OR t.short_code ILIKE $${n})`);
  }
  return { sql: where.join(' AND '), params };
}

async function roster(eventId, filters, shape) {
  const { sql, params } = rosterWhere(eventId, filters);
  // Fetch one extra row so callers can tell the user the list was cut off.
  const { rows } = await query(`${TICKET_VIEW_SQL} WHERE ${sql} ORDER BY u.full_name LIMIT ${ROSTER_LIMIT + 1}`, params);
  return { tickets: await Promise.all(rows.slice(0, ROSTER_LIMIT).map(shape)), truncated: rows.length > ROSTER_LIMIT };
}

export const eventTicketRoster = (eventId, filters) => roster(eventId, filters, withoutSecret);
export const eventTicketsWithQr = (eventId, filters) => roster(eventId, filters, present);

export async function eventTicketWithQr(eventId, ticketId) {
  const { rows } = await query(`${TICKET_VIEW_SQL} WHERE t.id = $1 AND t.event_id = $2`, [ticketId, eventId]);
  return rows[0] ? present(rows[0]) : null;
}

export { TICKET_VIEW_SQL };
