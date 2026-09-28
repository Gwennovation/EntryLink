// Ticket email subscriber. Sends the QR ticket by email on `ticket.issued` and `ticket.resent`.
//
// No email provider is wired up yet (spec §1.5 simulates notifications), so the default "log"
// transport sends nothing and records the attempt in the notification log (channel 'email',
// status 'not_configured'). To go live, implement a transport below (e.g. SendGrid, SES, SMTP)
// and set EMAIL_PROVIDER. Nothing else in the codebase changes: the Resend button and the
// approval flow already publish the events this subscriber listens to.
import { config } from '../config.js';
import { query } from '../db/index.js';
import { eventTicketWithQr } from './tickets.js';

const transports = {
  /** Default: no provider configured. Nothing leaves the server. */
  log: {
    status: 'not_configured',
    async send() {},
  },
  // sendgrid: {
  //   status: 'sent',
  //   async send({ to, subject, text, attachments }) { /* call the provider's API; throw on failure */ },
  // },
};

function pickTransport() {
  if (!config.emailProvider) return transports.log;
  const transport = transports[config.emailProvider];
  if (!transport) throw new Error(`EMAIL_PROVIDER "${config.emailProvider}" is not implemented — add a transport in src/services/email.js`);
  return transport;
}

// Fail at startup, not on the first approval, if EMAIL_PROVIDER names a transport that doesn't exist.
const transport = pickTransport();

async function record(ticket, message, status, error) {
  await query(
    `INSERT INTO notifications (user_id, type, title, body, channel, data) VALUES ($1, $2, $3, $4, 'email', $5)`,
    [ticket.attendee_id, 'email.ticket', message.subject, message.text,
      { ticket_id: ticket.id, event_id: ticket.event_id, to: message.to, status, ...(error ? { error } : {}) }],
  );
}

async function emailTicket({ entityId, eventId }) {
  const ticket = await eventTicketWithQr(eventId, entityId);
  if (!ticket) return;
  const message = {
    to: ticket.attendee_email,
    subject: `Your ticket for ${ticket.event_title}`,
    text: [
      `Hi ${ticket.attendee_name},`,
      '',
      `Your ticket for ${ticket.event_title} is attached. Show the QR code at the gate.`,
      `Ticket code: ${ticket.short_code} (${ticket.ticket_type})`,
      `Venue: ${ticket.venue}`,
      '',
      'You can also open it any time from the Tickets tab in the EntryLink app.',
    ].join('\n'),
    attachments: [{
      filename: `ticket-${ticket.short_code}.png`,
      contentType: 'image/png',
      content: Buffer.from(ticket.qr_image.split(',')[1], 'base64'),
    }],
  };
  try {
    await transport.send(message);
    await record(ticket, message, transport.status);
  } catch (err) {
    // A failed send is visible in the notification log; the organizer can resend or use the backup QR.
    await record(ticket, message, 'failed', err.message);
  }
}

export const emailHandlers = {
  'ticket.issued': emailTicket,
  'ticket.resent': emailTicket,
};
