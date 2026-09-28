// Unauthenticated endpoints, used by the public event page that poster QR codes link to.
// Only published, not-yet-ended events are visible; everything else is a 404.
import { Router } from 'express';
import { one, query } from '../db/index.js';
import { notFound } from '../lib/errors.js';

export const router = Router();

router.get('/events/:id', async (req, res) => {
  const event = await one(
    `SELECT e.id, e.title, e.description, e.venue, e.starts_at, e.ends_at, e.capacity, e.status,
            (SELECT count(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'approved')::int AS approved_count
       FROM events e WHERE e.id = $1 AND e.status IN ('published', 'closed')`,
    [req.params.id],
  );
  if (!event) throw notFound('Event');
  const { rows: ticketTypes } = await query(
    `SELECT tt.name, tt.description, tt.price_cents, tt.quantity,
            (SELECT count(*) FROM registrations r WHERE r.ticket_type_id = tt.id AND r.status = 'approved')::int AS sold
       FROM ticket_types tt WHERE tt.event_id = $1 ORDER BY tt.price_cents, tt.name`,
    [event.id],
  );
  const { approved_count: approved, capacity, ...rest } = event;
  res.json({
    event: {
      ...rest,
      registration_open: event.status === 'published' && new Date(event.ends_at) > new Date() && approved < capacity,
      sold_out: approved >= capacity,
      ticket_types: ticketTypes.map(({ quantity, sold, ...t }) => ({ ...t, sold_out: quantity != null && sold >= quantity })),
    },
  });
});
