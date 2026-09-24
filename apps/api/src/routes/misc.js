// Smaller resources: tickets (attendee wallet), notifications, audit log.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listAudit, verifyAuditChain } from '../services/audit.js';
import { ticketForAttendee, ticketsForAttendee } from '../services/tickets.js';

// ---- Tickets ---------------------------------------------------------------------------------------
export const ticketsRouter = Router();
ticketsRouter.use(authenticate(), requireRole('attendee'));

ticketsRouter.get('/mine', async (req, res) => {
  res.json({ tickets: await ticketsForAttendee(req.user.id) });
});

ticketsRouter.get('/:id', async (req, res) => {
  const ticket = await ticketForAttendee(req.params.id, req.user.id);
  if (!ticket) throw notFound('Ticket');
  res.json({ ticket });
});

// ---- Notifications -------------------------------------------------------------------------------
export const notificationsRouter = Router();
notificationsRouter.use(authenticate());

notificationsRouter.get('/mine', async (req, res) => {
  const { rows } = await query(
    'SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [req.user.id],
  );
  const unread = rows.filter((n) => !n.read_at).length;
  res.json({ notifications: rows, unread });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.status(204).end();
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE notifications SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id],
  );
  if (!rowCount) throw notFound('Notification');
  res.status(204).end();
});

// Admin view of the full notification log (spec §2.1 "Notification Log").
notificationsRouter.get('/', requireRole('admin'), async (_req, res) => {
  const { rows } = await query(
    `SELECT n.id, n.type, n.title, n.channel, n.read_at, n.created_at, u.full_name AS recipient_name, u.email AS recipient_email
       FROM notifications n JOIN users u ON u.id = n.user_id ORDER BY n.created_at DESC LIMIT 200`,
  );
  res.json({ notifications: rows });
});

// ---- Audit log (admin) -----------------------------------------------------------------------------
export const auditRouter = Router();
auditRouter.use(authenticate(), requireRole('admin'));

const auditQuery = z.object({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  action: z.string().optional(),
  actor_id: z.uuid().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get('/', validate(auditQuery, 'query'), async (req, res) => {
  const f = req.valid.query;
  const entries = await listAudit({
    entityType: f.entity_type, entityId: f.entity_id, action: f.action, actorId: f.actor_id, before: f.before, limit: f.limit,
  });
  res.json({ entries, next_before: entries.length === f.limit ? Number(entries.at(-1).id) : null });
});

auditRouter.get('/verify', async (_req, res) => {
  res.json(await verifyAuditChain());
});
