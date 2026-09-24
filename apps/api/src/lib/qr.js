// QR ticket payloads are HMAC-signed so forged or hand-edited codes are rejected before any DB lookup.
// Format: EL1.<ticketId>.<secret>.<signature>
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';

const PREFIX = 'EL1';
// Crockford-style alphabet without look-alikes (0/O, 1/I/L) — easy to read aloud at the gate.
const SHORT_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const sign = (value) => crypto.createHmac('sha256', config.qrSecret).update(value).digest('base64url');

export const newTicketSecret = () => crypto.randomBytes(16).toString('base64url');

export function newShortCode() {
  const bytes = crypto.randomBytes(8);
  const chars = [...bytes].map((b) => SHORT_ALPHABET[b % SHORT_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function buildPayload(ticketId, secret) {
  const body = `${PREFIX}.${ticketId}.${secret}`;
  return `${body}.${sign(body)}`;
}

/** Returns { ticketId, secret } for a genuine payload, or null if malformed / forged. */
export function parsePayload(payload) {
  if (typeof payload !== 'string') return null;
  const parts = payload.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  const body = parts.slice(0, 3).join('.');
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(parts[3]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return { ticketId: parts[1], secret: parts[2] };
}

export const toDataUrl = (payload) => QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 360 });
