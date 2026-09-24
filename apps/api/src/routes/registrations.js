// Registration, proof-of-payment, review workflow and comments (FR-001..003, FR-012).
import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db/index.js';
import { publish } from '../lib/bus.js';
import { forbidden, notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { discardUpload, proofFilePath, proofUpload } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import {
  approveRegistration, cancelRegistration, getRegistrationFor, rejectRegistration,
  requestRevision, resubmitRegistration, submitRegistration,
} from '../services/registrations.js';

export const router = Router();
router.use(authenticate());

const STATUSES = ['pending', 'revision_requested', 'approved', 'rejected', 'cancelled'];
const LIST_SQL = `
  SELECT r.id, r.event_id, r.ticket_type_id, r.attendee_id, r.status, r.amount_cents, r.payment_reference,
         r.proof_path IS NOT NULL AS has_proof, r.proof_mime, r.review_note, r.reviewed_at, r.version,
         r.created_at, r.updated_at,
         e.title AS event_title, e.starts_at, e.venue, tt.name AS ticket_type,
         u.full_name AS attendee_name, u.email AS attendee_email,
         t.id AS ticket_id, t.status AS ticket_status
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN ticket_types tt ON tt.id = r.ticket_type_id
    JOIN users u ON u.id = r.attendee_id
    LEFT JOIN tickets t ON t.registration_id = r.id`;

const present = ({ proof_path, ...r }) => ({ ...r, has_proof: r.has_proof ?? Boolean(proof_path) });

/** Runs a handler and deletes the uploaded file if the handler throws (validation, conflicts…). */
const withUploadCleanup = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    discardUpload(req.file);
    throw err;
  }
};

// ---- Attendee ----------------------------------------------------------------------------------

const submitSchema = z.object({
  event_id: z.uuid('must be a valid event id'),
  ticket_type_id: z.uuid('must be a valid ticket type id'),
  payment_reference: z.string().trim().max(100).optional().transform((v) => v || undefined),
});

router.post('/', requireRole('attendee'), proofUpload, withUploadCleanup(async (req, res) => {
  const body = submitSchema.parse(req.body);
  const reg = await submitRegistration({
    attendeeId: req.user.id, eventId: body.event_id, ticketTypeId: body.ticket_type_id,
    paymentReference: body.payment_reference, proof: req.file,
  });
  res.status(201).json({ registration: present(reg) });
}));

router.get('/mine', requireRole('attendee'), async (req, res) => {
  const { rows } = await query(`${LIST_SQL} WHERE r.attendee_id = $1 ORDER BY r.created_at DESC`, [req.user.id]);
  res.json({ registrations: rows.map(present) });
});

router.put('/:id/resubmit', requireRole('attendee'), proofUpload, withUploadCleanup(async (req, res) => {
  const body = z.object({ payment_reference: submitSchema.shape.payment_reference }).parse(req.body ?? {});
  const reg = await resubmitRegistration({
    attendeeId: req.user.id, registrationId: req.params.id, paymentReference: body.payment_reference, proof: req.file,
  });
  res.json({ registration: present(reg) });
}));

router.post('/:id/cancel', requireRole('attendee'), async (req, res) => {
  const reg = await cancelRegistration({ attendeeId: req.user.id, registrationId: req.params.id });
  res.json({ registration: present(reg) });
});

// ---- Coordinator / organizer review queue --------------------------------------------------------

const listSchema = z.object({
  event_id: z.uuid().optional(),
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});

router.get('/', requireRole('coordinator', 'organizer'), validate(listSchema, 'query'), async (req, res) => {
  const { event_id, status, q } = req.valid.query;
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.user.role === 'organizer') add('e.organizer_id = ?', req.user.id);
  if (event_id) add('r.event_id = ?', event_id);
  if (status) add('r.status = ?', status);
  if (q) add('(u.full_name ILIKE ? OR u.email ILIKE ? OR r.payment_reference ILIKE ?)', `%${q}%`);
  const { rows } = await query(
    // Oldest pending first so the queue is worked in order of arrival.
    `${LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at ASC LIMIT 500`,
    params,
  );
  res.json({ registrations: rows.map(present) });
});

router.get('/:id', async (req, res) => {
  const reg = await getRegistrationFor(req.user, req.params.id);
  const { rows: history } = await query(
    `SELECT h.version, h.from_status, h.to_status, h.note, h.created_at, u.full_name AS actor_name, u.role AS actor_role
       FROM registration_history h LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.registration_id = $1 ORDER BY h.id`,
    [reg.id],
  );
  const ticket = await one('SELECT id, short_code, status, issued_at, checked_in_at FROM tickets WHERE registration_id = $1', [reg.id]);
  res.json({ registration: present(reg), history, ticket });
});

router.get('/:id/proof', async (req, res) => {
  const reg = await getRegistrationFor(req.user, req.params.id);
  if (!reg.proof_path) throw notFound('Proof of payment');
  const file = proofFilePath(reg.proof_path);
  if (!fs.existsSync(file)) throw notFound('Proof of payment file');
  res.set('Content-Type', reg.proof_mime);
  res.set('Content-Disposition', `inline; filename="proof-${reg.id}"`);
  res.set('Cache-Control', 'private, no-store');
  // Uploads live under .data/, and send() refuses dot-directories unless told otherwise.
  res.sendFile(file, { dotfiles: 'allow' });
});

const noteSchema = (required) => z.object({
  note: required
    ? z.string({ error: 'is required — tell the attendee why' }).trim().min(3, 'is required — tell the attendee why').max(1000)
    : z.string().trim().max(1000).optional(),
});

router.post('/:id/approve', requireRole('coordinator'), validate(noteSchema(false)), async (req, res) => {
  const { registration, ticket } = await approveRegistration(req.user.id, req.params.id, req.valid.body.note);
  res.json({ registration: present(registration), ticket: { id: ticket.id, short_code: ticket.short_code, status: ticket.status } });
});

router.post('/:id/reject', requireRole('coordinator'), validate(noteSchema(true)), async (req, res) => {
  const { registration } = await rejectRegistration(req.user.id, req.params.id, req.valid.body.note);
  res.json({ registration: present(registration) });
});

router.post('/:id/request-revision', requireRole('coordinator'), validate(noteSchema(true)), async (req, res) => {
  const { registration } = await requestRevision(req.user.id, req.params.id, req.valid.body.note);
  res.json({ registration: present(registration) });
});

// ---- Comments (FR-012) ---------------------------------------------------------------------------

router.get('/:id/comments', async (req, res) => {
  const reg = await getRegistrationFor(req.user, req.params.id);
  const { rows } = await query(
    `SELECT c.id, c.body, c.created_at, c.author_id, u.full_name AS author_name, u.role AS author_role
       FROM comments c JOIN users u ON u.id = c.author_id WHERE c.registration_id = $1 ORDER BY c.created_at`,
    [reg.id],
  );
  res.json({ comments: rows });
});

router.post('/:id/comments', validate(z.object({ body: z.string().trim().min(1, 'cannot be empty').max(2000) })), async (req, res) => {
  const reg = await getRegistrationFor(req.user, req.params.id);
  // Organizers can read the thread; the conversation itself is between attendee and coordinator.
  if (!['attendee', 'coordinator'].includes(req.user.role)) throw forbidden('Only the attendee and coordinators can comment.');
  const comment = await one(
    'INSERT INTO comments (registration_id, author_id, body) VALUES ($1, $2, $3) RETURNING *',
    [reg.id, req.user.id, req.valid.body.body],
  );
  await publish('comment.created', {
    actorId: req.user.id, entityType: 'comment', entityId: comment.id, data: { registration_id: reg.id },
  });
  res.status(201).json({ comment: { ...comment, author_name: req.user.full_name, author_role: req.user.role } });
});
