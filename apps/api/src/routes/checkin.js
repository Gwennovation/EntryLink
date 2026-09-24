// Gate / Entry Staff endpoints (FR-005, FR-006).
import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { lookupTickets, manualCheckIn, scanTicket } from '../services/checkin.js';
import { recentEntries } from '../services/stats.js';

export const router = Router();
router.use(authenticate(), requireRole('gate_staff'));

async function assertGateOpen(eventId) {
  const event = await one('SELECT status FROM events WHERE id = $1', [eventId]);
  if (!event || event.status === 'draft') throw notFound('Event');
  if (event.status === 'closed') throw conflict('This event is closed — the gate is no longer accepting entries.');
}

const scanSchema = z.object({
  event_id: z.uuid('select the event you are scanning for'),
  payload: z.string().min(1, 'is empty — scan the QR code again').max(500),
});

router.post('/scan', validate(scanSchema), async (req, res) => {
  const { event_id, payload } = req.valid.body;
  await assertGateOpen(event_id);
  res.json(await scanTicket({ eventId: event_id, payload, staffId: req.user.id }));
});

const manualSchema = z.object({
  event_id: z.uuid(),
  ticket_id: z.uuid(),
  reason: z.string({ error: 'is required for manual check-in' }).trim().min(3, 'is required for manual check-in').max(500),
});

router.post('/manual', validate(manualSchema), async (req, res) => {
  const { event_id, ticket_id, reason } = req.valid.body;
  await assertGateOpen(event_id);
  res.json(await manualCheckIn({ eventId: event_id, ticketId: ticket_id, staffId: req.user.id, reason }));
});

router.get('/lookup', validate(z.object({ event_id: z.uuid(), q: z.string().trim().min(2, 'type at least 2 characters') }), 'query'), async (req, res) => {
  const { event_id, q } = req.valid.query;
  res.json({ tickets: await lookupTickets({ eventId: event_id, q }) });
});

router.get('/recent', validate(z.object({ event_id: z.uuid() }), 'query'), async (req, res) => {
  res.json({ entries: await recentEntries(req.valid.query.event_id, 30) });
});
