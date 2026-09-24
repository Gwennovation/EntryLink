// Dashboard & reporting queries (FR-008, FR-013).
import { one, query } from '../db/index.js';

export async function eventStats(eventId) {
  const counts = await one(
    `SELECT
       e.capacity,
       count(r.id)                                                      AS registrations_total,
       count(r.id) FILTER (WHERE r.status = 'pending')                  AS pending,
       count(r.id) FILTER (WHERE r.status = 'revision_requested')       AS revision_requested,
       count(r.id) FILTER (WHERE r.status = 'approved')                 AS approved,
       count(r.id) FILTER (WHERE r.status = 'rejected')                 AS rejected,
       count(r.id) FILTER (WHERE r.status = 'cancelled')                AS cancelled,
       coalesce(sum(r.amount_cents) FILTER (WHERE r.status = 'approved'), 0) AS revenue_cents
     FROM events e LEFT JOIN registrations r ON r.event_id = e.id
     WHERE e.id = $1 GROUP BY e.id`,
    [eventId],
  );
  const tickets = await one(
    `SELECT count(*) FILTER (WHERE status IN ('issued', 'checked_in', 'expired')) AS issued,
            count(*) FILTER (WHERE status = 'checked_in')                        AS checked_in
       FROM tickets WHERE event_id = $1`,
    [eventId],
  );
  const scans = await one(
    `SELECT count(*) FILTER (WHERE result <> 'accepted') AS rejected_scans FROM entry_logs WHERE event_id = $1`,
    [eventId],
  );
  const int = (v) => Number(v ?? 0);
  return {
    event_id: eventId,
    capacity: int(counts?.capacity),
    registrations: {
      total: int(counts?.registrations_total),
      pending: int(counts?.pending),
      revision_requested: int(counts?.revision_requested),
      approved: int(counts?.approved),
      rejected: int(counts?.rejected),
      cancelled: int(counts?.cancelled),
    },
    tickets_issued: int(tickets?.issued),
    checked_in: int(tickets?.checked_in),
    rejected_scans: int(scans?.rejected_scans),
    revenue_cents: int(counts?.revenue_cents),
    generated_at: new Date().toISOString(),
  };
}

export async function recentEntries(eventId, limit = 20) {
  const { rows } = await query(
    `SELECT l.id, l.result, l.method, l.note, l.created_at, t.short_code,
            a.full_name AS attendee_name, s.full_name AS staff_name
       FROM entry_logs l
       LEFT JOIN tickets t ON t.id = l.ticket_id
       LEFT JOIN users a ON a.id = t.attendee_id
       JOIN users s ON s.id = l.scanned_by
      WHERE l.event_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT $2`,
    [eventId, limit],
  );
  return rows;
}

export async function eventReport(eventId) {
  const event = await one('SELECT id, title, venue, starts_at, ends_at, capacity, status FROM events WHERE id = $1', [eventId]);
  const summary = await eventStats(eventId);
  const { rows: byTicketType } = await query(
    `SELECT tt.name, tt.price_cents,
            count(r.id) FILTER (WHERE r.status = 'approved') AS approved,
            count(t.id) FILTER (WHERE t.status = 'checked_in') AS checked_in,
            coalesce(sum(r.amount_cents) FILTER (WHERE r.status = 'approved'), 0) AS revenue_cents
       FROM ticket_types tt
       LEFT JOIN registrations r ON r.ticket_type_id = tt.id
       LEFT JOIN tickets t ON t.registration_id = r.id
      WHERE tt.event_id = $1 GROUP BY tt.id ORDER BY tt.price_cents DESC, tt.name`,
    [eventId],
  );
  const { rows: checkinsByHour } = await query(
    `SELECT date_trunc('hour', checked_in_at) AS hour, count(*) AS checked_in
       FROM tickets WHERE event_id = $1 AND checked_in_at IS NOT NULL GROUP BY 1 ORDER BY 1`,
    [eventId],
  );
  const { rows: attendees } = await query(
    `SELECT u.full_name, u.email, tt.name AS ticket_type, r.amount_cents, r.status AS registration_status,
            t.short_code, t.status AS ticket_status, t.checked_in_at
       FROM registrations r
       JOIN users u ON u.id = r.attendee_id
       JOIN ticket_types tt ON tt.id = r.ticket_type_id
       LEFT JOIN tickets t ON t.registration_id = r.id
      WHERE r.event_id = $1 AND r.status = 'approved'
      ORDER BY u.full_name`,
    [eventId],
  );
  const int = (v) => Number(v ?? 0);
  return {
    event,
    summary: {
      ...summary,
      attendance_rate: summary.tickets_issued ? summary.checked_in / summary.tickets_issued : 0,
      no_shows: summary.tickets_issued - summary.checked_in,
    },
    by_ticket_type: byTicketType.map((r) => ({
      ...r, approved: int(r.approved), checked_in: int(r.checked_in), revenue_cents: int(r.revenue_cents),
    })),
    checkins_by_hour: checkinsByHour.map((r) => ({ hour: r.hour, checked_in: int(r.checked_in) })),
    attendees,
  };
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote when needed; prefix formula-like values so spreadsheets don't execute them.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function reportToCsv(report) {
  const lines = [
    ['Event', report.event.title], ['Venue', report.event.venue],
    ['Starts', report.event.starts_at], ['Ends', report.event.ends_at],
    ['Capacity', report.event.capacity], ['Approved registrations', report.summary.registrations.approved],
    ['Checked in', report.summary.checked_in], ['No-shows', report.summary.no_shows],
    ['Revenue (PHP)', (report.summary.revenue_cents / 100).toFixed(2)],
    [],
    ['Name', 'Email', 'Ticket type', 'Amount (PHP)', 'Ticket code', 'Ticket status', 'Checked in at'],
    ...report.attendees.map((a) => [
      a.full_name, a.email, a.ticket_type, (a.amount_cents / 100).toFixed(2), a.short_code, a.ticket_status, a.checked_in_at,
    ]),
  ];
  return lines.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}
