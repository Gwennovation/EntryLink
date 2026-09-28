// Event & ticket-type management (FR-009), dashboards (FR-008) and reports (FR-013).
import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/index.js';
import { config } from '../config.js';
import { publish } from '../lib/bus.js';
import { toDataUrl } from '../lib/qr.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { openLiveStream } from '../services/live.js';
import { eventReport, eventStats, recentEntries, reportToCsv } from '../services/stats.js';
import { eventTicketRoster, eventTicketsWithQr, eventTicketWithQr } from '../services/tickets.js';

export const router = Router();

const STAFF_ROLES = ['admin', 'organizer', 'coordinator', 'gate_staff'];

async function loadEvent(id) {
  const event = await one(
    `SELECT e.*, u.full_name AS organizer_name FROM events e JOIN users u ON u.id = e.organizer_id WHERE e.id = $1`,
    [id],
  );
  if (!event) throw notFound('Event');
  return event;
}

/** Organizers can only manage events they own. */
async function loadOwnedEvent(req) {
  const event = await loadEvent(req.params.id);
  if (event.organizer_id !== req.user.id) throw forbidden('You can only manage events you organize.');
  return event;
}

/** Dashboards/reports: the owning organizer, or any coordinator. */
async function loadEventForDashboard(req) {
  const event = await loadEvent(req.params.id);
  const ok = req.user.role === 'coordinator' || (req.user.role === 'organizer' && event.organizer_id === req.user.id);
  if (!ok) throw forbidden('Only the event organizer or a registration coordinator can view this dashboard.');
  return event;
}

async function ticketTypesFor(eventIds) {
  if (!eventIds.length) return {};
  const { rows } = await query(
    `SELECT tt.*,
            (SELECT count(*) FROM registrations r WHERE r.ticket_type_id = tt.id AND r.status = 'approved')::int AS sold
       FROM ticket_types tt WHERE tt.event_id = ANY($1) ORDER BY tt.price_cents, tt.name`,
    [eventIds],
  );
  return rows.reduce((acc, t) => ((acc[t.event_id] ??= []).push(t), acc), {});
}

// ---- Listing & detail ------------------------------------------------------------------------

router.get('/', authenticate(), async (req, res) => {
  const { role, id } = req.user;
  let sql = `SELECT e.*, u.full_name AS organizer_name,
                    (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'approved')::int AS approved_count
               FROM events e JOIN users u ON u.id = e.organizer_id`;
  const params = [];
  if (role === 'attendee') sql += ` WHERE e.status = 'published' AND e.ends_at > now() ORDER BY e.starts_at`;
  else if (role === 'organizer') { params.push(id); sql += ` WHERE e.organizer_id = $1 ORDER BY e.starts_at DESC`; }
  else if (role === 'admin') sql += ` ORDER BY e.starts_at DESC`;
  else sql += ` WHERE e.status <> 'draft' ORDER BY e.starts_at DESC`; // coordinators & gate staff
  const { rows } = await query(sql, params);
  const types = await ticketTypesFor(rows.map((e) => e.id));
  res.json({ events: rows.map((e) => ({ ...e, ticket_types: types[e.id] ?? [] })) });
});

router.get('/:id', authenticate(), async (req, res) => {
  const event = await loadEvent(req.params.id);
  const hidden = event.status === 'draft' && !(req.user.role === 'organizer' && event.organizer_id === req.user.id) && req.user.role !== 'admin';
  if (hidden) throw notFound('Event');
  const types = await ticketTypesFor([event.id]);
  res.json({ event: { ...event, ticket_types: types[event.id] ?? [] } });
});

// ---- Organizer: create / edit / lifecycle ------------------------------------------------------

const eventFields = {
  title: z.string().trim().min(3, 'must be at least 3 characters').max(160),
  description: z.string().trim().max(5000),
  venue: z.string().trim().min(2, 'is required').max(200),
  starts_at: z.coerce.date({ error: 'must be a valid date/time' }),
  ends_at: z.coerce.date({ error: 'must be a valid date/time' }),
  capacity: z.coerce.number().int().positive('must be greater than zero').max(100_000),
};
const endsAfterStart = (v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at;

const ticketTypeSchema = z.object({
  name: z.string().trim().min(1, 'is required').max(80),
  description: z.string().trim().max(500).default(''),
  price_cents: z.coerce.number().int().min(0, 'cannot be negative'),
  quantity: z.coerce.number().int().positive().nullable().default(null),
});

const createEventSchema = z.object({
  ...eventFields,
  description: eventFields.description.default(''),
  ticket_types: z.array(ticketTypeSchema).min(1, 'add at least one ticket type').max(20),
}).refine(endsAfterStart, { message: 'must be after the start time', path: ['ends_at'] });

router.post('/', authenticate(), requireRole('organizer'), validate(createEventSchema), async (req, res) => {
  const b = req.valid.body;
  const names = b.ticket_types.map((t) => t.name.toLowerCase());
  if (new Set(names).size !== names.length) throw badRequest('ticket_types: each ticket type needs a unique name.');
  const event = await tx(async (q) => {
    const { rows: [e] } = await q.query(
      `INSERT INTO events (title, description, venue, starts_at, ends_at, capacity, organizer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [b.title, b.description, b.venue, b.starts_at, b.ends_at, b.capacity, req.user.id],
    );
    for (const t of b.ticket_types) {
      await q.query(
        'INSERT INTO ticket_types (event_id, name, description, price_cents, quantity) VALUES ($1, $2, $3, $4, $5)',
        [e.id, t.name, t.description, t.price_cents, t.quantity],
      );
    }
    return e;
  });
  await publish('event.created', { actorId: req.user.id, entityType: 'event', entityId: event.id, eventId: event.id, data: { title: event.title } });
  const types = await ticketTypesFor([event.id]);
  res.status(201).json({ event: { ...event, ticket_types: types[event.id] } });
});

const updateEventSchema = z.object(eventFields).partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');

router.patch('/:id', authenticate(), requireRole('organizer'), validate(updateEventSchema), async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status === 'closed') throw conflict('Closed events can no longer be edited.');
  const changes = req.valid.body;
  const merged = { ...event, ...changes };
  if (!(new Date(merged.ends_at) > new Date(merged.starts_at))) throw badRequest('ends_at: must be after the start time');
  if (changes.capacity !== undefined) {
    const { approved } = await one(`SELECT count(*)::int AS approved FROM registrations WHERE event_id = $1 AND status = 'approved'`, [event.id]);
    if (changes.capacity < approved) throw conflict(`Capacity can't be lower than the ${approved} tickets already issued.`);
  }
  const fields = Object.keys(changes);
  const updated = await one(
    `UPDATE events SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [event.id, ...fields.map((f) => changes[f])],
  );
  await publish('event.updated', { actorId: req.user.id, entityType: 'event', entityId: event.id, eventId: event.id, data: { fields } });
  res.json({ event: updated });
});

router.post('/:id/publish', authenticate(), requireRole('organizer'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status !== 'draft') throw conflict(`This event is already ${event.status}.`);
  const updated = await one(`UPDATE events SET status = 'published', updated_at = now() WHERE id = $1 RETURNING *`, [event.id]);
  await publish('event.published', { actorId: req.user.id, entityType: 'event', entityId: event.id, eventId: event.id });
  res.json({ event: updated });
});

// Closing an event stops registrations and gate entry; unused tickets become expired (no-shows).
router.post('/:id/close', authenticate(), requireRole('organizer'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status === 'closed') throw conflict('This event is already closed.');
  const expired = await tx(async (q) => {
    await q.query(`UPDATE events SET status = 'closed', updated_at = now() WHERE id = $1`, [event.id]);
    const r = await q.query(`UPDATE tickets SET status = 'expired', updated_at = now() WHERE event_id = $1 AND status = 'issued'`, [event.id]);
    return r.rowCount;
  });
  await publish('event.closed', { actorId: req.user.id, entityType: 'event', entityId: event.id, eventId: event.id, data: { tickets_expired: expired } });
  res.json({ event: await loadEvent(event.id), tickets_expired: expired });
});

// ---- Ticket types ------------------------------------------------------------------------------

router.post('/:id/ticket-types', authenticate(), requireRole('organizer'), validate(ticketTypeSchema), async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status === 'closed') throw conflict('Closed events can no longer be edited.');
  const t = req.valid.body;
  let type;
  try {
    type = await one(
      'INSERT INTO ticket_types (event_id, name, description, price_cents, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [event.id, t.name, t.description, t.price_cents, t.quantity],
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('A ticket type with this name already exists for this event.');
    throw err;
  }
  await publish('ticket_type.created', { actorId: req.user.id, entityType: 'ticket_type', entityId: type.id, eventId: event.id, data: t });
  res.status(201).json({ ticket_type: type });
});

router.delete('/:id/ticket-types/:typeId', authenticate(), requireRole('organizer'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  const used = await one('SELECT 1 FROM registrations WHERE ticket_type_id = $1 LIMIT 1', [req.params.typeId]);
  if (used) throw conflict('This ticket type already has registrations and cannot be deleted.');
  const { rowCount } = await query('DELETE FROM ticket_types WHERE id = $1 AND event_id = $2', [req.params.typeId, event.id]);
  if (!rowCount) throw notFound('Ticket type');
  await publish('ticket_type.deleted', { actorId: req.user.id, entityType: 'ticket_type', entityId: req.params.typeId, eventId: event.id });
  res.status(204).end();
});

// ---- Ticket roster & backup QR codes (owning organizer) ----------------------------------------
// Fallback for when an attendee didn't receive their ticket: the organizer can view, download or
// print the same QR. A QR is a bearer credential, so every view and export is audited.

const rosterSchema = z.object({
  status: z.enum(['issued', 'checked_in', 'cancelled', 'expired']).optional(),
  q: z.string().trim().max(100).optional().transform((v) => v || undefined),
});

router.get('/:id/tickets', authenticate(), requireRole('organizer'), validate(rosterSchema, 'query'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  res.json(await eventTicketRoster(event.id, req.valid.query));
});

router.get('/:id/tickets/qr-sheet', authenticate(), requireRole('organizer'), validate(rosterSchema, 'query'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  const result = await eventTicketsWithQr(event.id, req.valid.query);
  await publish('ticket.qr_exported', {
    actorId: req.user.id, entityType: 'event', entityId: event.id, eventId: event.id,
    data: { count: result.tickets.length, filters: req.valid.query, short_codes: result.tickets.map((t) => t.short_code) },
  });
  res.json(result);
});

// Re-sends the ticket through the normal delivery channels (in-app now; email once a provider is set).
router.post('/:id/tickets/:ticketId/resend', authenticate(), requireRole('organizer'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  const ticket = await one(
    'SELECT id, registration_id, short_code, status FROM tickets WHERE id = $1 AND event_id = $2', [req.params.ticketId, event.id],
  );
  if (!ticket) throw notFound('Ticket');
  if (ticket.status !== 'issued') throw conflict(`This ticket is ${ticket.status.replace('_', ' ')} — there's nothing to resend.`);
  await publish('ticket.resent', {
    actorId: req.user.id, entityType: 'ticket', entityId: ticket.id, eventId: event.id,
    data: { registration_id: ticket.registration_id, short_code: ticket.short_code },
  });
  res.json({ resent: true, channels: { in_app: 'delivered', email: config.emailProvider ? 'sent' : 'not_configured' } });
});

router.get('/:id/tickets/:ticketId/qr', authenticate(), requireRole('organizer'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  const ticket = await eventTicketWithQr(event.id, req.params.ticketId);
  if (!ticket) throw notFound('Ticket');
  await publish('ticket.qr_viewed', {
    actorId: req.user.id, entityType: 'ticket', entityId: ticket.id, eventId: event.id,
    data: { short_code: ticket.short_code, attendee_id: ticket.attendee_id },
  });
  res.json({ ticket });
});

// ---- Event poster QR ----------------------------------------------------------------------------
// One QR for posters and flyers. It links to the public event page, which opens the event in the
// mobile app. It's a public link (not a ticket), so it isn't audited.

const publicEventUrl = (eventId) => `${config.publicWebUrl}/e/${eventId}`;

router.get('/:id/poster', authenticate(), requireRole('organizer'), async (req, res) => {
  const event = await loadOwnedEvent(req);
  if (event.status === 'draft') throw conflict('Publish the event first — the poster link only works for published events.');
  if (event.status === 'closed' || new Date(event.ends_at) < new Date()) {
    throw conflict('This event has ended, so registration is no longer open.');
  }
  const url = publicEventUrl(event.id);
  res.json({ url, qr_image: await toDataUrl(url), link_is_local: /\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) });
});

// ---- Dashboards & reports ----------------------------------------------------------------------

router.get('/:id/stats', authenticate(), requireRole(...STAFF_ROLES), async (req, res) => {
  // Gate staff get the headcount too (fire-code compliance at the door).
  if (req.user.role === 'gate_staff') await loadEvent(req.params.id);
  else await loadEventForDashboard(req);
  res.json({ stats: await eventStats(req.params.id), recent_entries: await recentEntries(req.params.id) });
});

// The web dashboard's EventSource sends the session cookie, so no token ever appears in the URL.
router.get('/:id/live', authenticate(), requireRole('organizer', 'coordinator'), async (req, res) => {
  await loadEventForDashboard(req);
  await openLiveStream(req, res, req.params.id);
});

router.get('/:id/report', authenticate(), requireRole('organizer', 'coordinator'), async (req, res) => {
  const event = await loadEventForDashboard(req);
  const report = await eventReport(event.id);
  await publish('report.generated', { actorId: req.user.id, entityType: 'event', entityId: event.id, data: { format: req.query.format ?? 'json' } });
  if (req.query.format === 'csv') {
    const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="entrylink-report-${slug}.csv"`);
    return res.send(reportToCsv(report));
  }
  res.json({ report });
});
