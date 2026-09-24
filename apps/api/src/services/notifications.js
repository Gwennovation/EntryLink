// Notification Service — reacts to domain events and writes to the notification log.
// Delivery is simulated as in-app notifications (spec §1.5). To add real email/SMS later,
// register another subscriber (e.g. SendGrid/Twilio) for the same events; nothing else changes.
import { one, query } from '../db/index.js';

export async function notify(userId, type, title, body, data = {}) {
  await query(
    'INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)',
    [userId, type, title, body, data],
  );
}

async function registrationContext(registrationId) {
  return one(
    `SELECT r.id, r.attendee_id, r.review_note, e.id AS event_id, e.title AS event_title
       FROM registrations r JOIN events e ON e.id = r.event_id WHERE r.id = $1`,
    [registrationId],
  );
}

/** event name → handler. Each handler receives the bus envelope. */
export const notificationHandlers = {
  async 'registration.submitted'({ entityId }) {
    const r = await registrationContext(entityId);
    await notify(r.attendee_id, 'registration.submitted', 'Registration received',
      `We received your registration for ${r.event_title}. A coordinator will review your payment shortly.`,
      { registration_id: r.id, event_id: r.event_id });
  },

  async 'registration.resubmitted'({ entityId }) {
    const r = await registrationContext(entityId);
    await notify(r.attendee_id, 'registration.resubmitted', 'Revision received',
      `Thanks — your updated registration for ${r.event_title} is back in the review queue.`,
      { registration_id: r.id, event_id: r.event_id });
  },

  async 'registration.revision_requested'({ entityId }) {
    const r = await registrationContext(entityId);
    await notify(r.attendee_id, 'registration.revision_requested', 'Action needed on your registration',
      `A coordinator asked for changes to your registration for ${r.event_title}: ${r.review_note}`,
      { registration_id: r.id, event_id: r.event_id });
  },

  async 'registration.rejected'({ entityId }) {
    const r = await registrationContext(entityId);
    await notify(r.attendee_id, 'registration.rejected', 'Registration not approved',
      `Your registration for ${r.event_title} was not approved. Reason: ${r.review_note}`,
      { registration_id: r.id, event_id: r.event_id });
  },

  async 'ticket.issued'({ entityId, data }) {
    const r = await registrationContext(data.registration_id);
    await notify(r.attendee_id, 'ticket.issued', 'Your ticket is ready',
      `You're in! Your QR ticket for ${r.event_title} is now in your ticket wallet (code ${data.short_code}).`,
      { ticket_id: entityId, registration_id: r.id, event_id: r.event_id });
  },

  async 'ticket.checked_in'({ entityId, data }) {
    const r = await registrationContext(data.registration_id);
    await notify(r.attendee_id, 'ticket.checked_in', 'Checked in',
      `Welcome to ${r.event_title}! Your entry was recorded.`,
      { ticket_id: entityId, event_id: r.event_id });
  },

  async 'comment.created'({ actorId, data }) {
    const r = await registrationContext(data.registration_id);
    // Attendee comments go to whoever reviewed the registration (if anyone yet); staff comments go to the attendee.
    if (actorId === r.attendee_id) {
      const reviewer = await one('SELECT reviewed_by FROM registrations WHERE id = $1', [r.id]);
      if (!reviewer?.reviewed_by) return;
      await notify(reviewer.reviewed_by, 'comment.created', 'New comment from attendee',
        `New comment on a registration for ${r.event_title}.`, { registration_id: r.id, event_id: r.event_id });
    } else {
      await notify(r.attendee_id, 'comment.created', 'New message from the event team',
        `A coordinator left a comment on your registration for ${r.event_title}.`,
        { registration_id: r.id, event_id: r.event_id });
    }
  },
};
