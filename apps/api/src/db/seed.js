// Demo data for local development: one account per role, two events, and registrations in
// several states. Goes through the real services so the audit trail and notifications are populated.
// Usage: npm run seed   (refuses to run if users already exist)
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { closeDb, initDb, one, query } from './index.js';
import { publish } from '../lib/bus.js';
import { registerSubscribers } from '../services/subscribers.js';
import {
  approveRegistration, requestRevision, submitRegistration,
} from '../services/registrations.js';

if (config.env === 'production') throw new Error('Refusing to seed a production database.');

export const DEMO_PASSWORD = 'EntryLink123!';
// Demo only: fictional account numbers.
const PAYMENT_INSTRUCTIONS = [
  'GCash: 0917 555 0123 (Cityscape Events Mgmt)',
  'BPI: 1234-5678-90 (Cityscape Events Management Inc.)',
  'Put your full name in the message/reference so we can match your payment.',
].join('\n');

const PEOPLE = [
  ['admin@entrylink.test', 'Ada Admin', 'admin'],
  ['organizer@entrylink.test', 'Olivia Organizer', 'organizer'],
  ['coordinator@entrylink.test', 'Carlo Coordinator', 'coordinator'],
  ['gate@entrylink.test', 'Gio Gate', 'gate_staff'],
  ['attendee@entrylink.test', 'Andrea Attendee', 'attendee'],
  ['juan@entrylink.test', 'Juan dela Cruz', 'attendee'],
  ['maria@entrylink.test', 'Maria Santos', 'attendee'],
];

// 1x1 PNG so seeded "proof of payment" files actually open in the review screen.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64',
);

function fakeProof(name) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const filename = `seed-${name}.png`;
  fs.writeFileSync(path.join(config.uploadDir, filename), PLACEHOLDER_PNG);
  return { filename, mimetype: 'image/png', originalname: `${name}-receipt.png` };
}

async function main() {
  const dbName = await initDb(config);
  registerSubscribers();
  const existing = await one('SELECT count(*)::int AS n FROM users');
  if (existing.n > 0) {
    console.log(`Database (${dbName}) already has ${existing.n} users — skipping seed. Delete apps/api/.data to start fresh.`);
    return;
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const users = {};
  for (const [email, name, role] of PEOPLE) {
    users[email.split('@')[0]] = await one(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING *`,
      [email, name, role, hash],
    );
  }
  const admin = users.admin;
  for (const u of Object.values(users)) {
    await publish('user.created', { actorId: admin.id, entityType: 'user', entityId: u.id, data: { role: u.role, email: u.email, seed: true } });
  }

  const hour = 3600_000;
  const now = Date.now();
  async function createEvent(fields, types) {
    const e = await one(
      `INSERT INTO events (title, description, payment_instructions, venue, starts_at, ends_at, capacity, organizer_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published') RETURNING *`,
      [fields.title, fields.description, PAYMENT_INSTRUCTIONS, fields.venue, fields.starts_at, fields.ends_at, fields.capacity, users.organizer.id],
    );
    const tt = [];
    for (const [name, price, qty] of types) {
      tt.push(await one(
        'INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES ($1, $2, $3, $4) RETURNING *',
        [e.id, name, price, qty],
      ));
    }
    await publish('event.created', { actorId: users.organizer.id, entityType: 'event', entityId: e.id, eventId: e.id, data: { title: e.title, seed: true } });
    return { event: e, types: tt };
  }

  // Happening now — so the gate scanner and live dashboard have something to do.
  const fair = await createEvent({
    title: 'Metro Manila Career Fair 2026',
    description: 'Meet 60+ employers across tech, finance and BPO. Bring copies of your résumé.',
    venue: 'SMX Convention Center, Pasay City',
    starts_at: new Date(now - hour), ends_at: new Date(now + 7 * hour), capacity: 300,
  }, [['General Admission', 15000, null], ['Student', 5000, 100]]);

  const conf = await createEvent({
    title: 'Philippine Tech Summit',
    description: 'Two tracks of talks on cloud, AI and product engineering, plus a startup expo.',
    venue: 'PICC, Pasay City',
    starts_at: new Date(now + 21 * 24 * hour), ends_at: new Date(now + 21 * 24 * hour + 9 * hour), capacity: 3000,
  }, [['Regular', 250000, null], ['Early Bird', 180000, 500], ['Community Pass', 0, 200]]);

  const register = (who, ev, typeIdx, ref) => submitRegistration({
    attendeeId: users[who].id, eventId: ev.event.id, ticketTypeId: ev.types[typeIdx].id,
    paymentReference: ref, proof: ev.types[typeIdx].price_cents ? fakeProof(`${who}-${ev.types[typeIdx].name}`) : undefined,
  });

  const r1 = await register('attendee', fair, 0, 'BDO-TRX-448120');
  await approveRegistration(users.coordinator.id, r1.id, 'Payment matched bank statement.');
  const r2 = await register('juan', fair, 1, 'GCASH-9912-3301');
  await approveRegistration(users.coordinator.id, r2.id);
  await register('maria', fair, 0, 'BPI-55-01931');                     // pending
  const r4 = await register('attendee', conf, 1, 'GCASH-7781-0045');
  await requestRevision(users.coordinator.id, r4.id, 'The receipt image is cropped — please upload the full screenshot showing the reference number.');
  await register('juan', conf, 2);                                         // free pass, pending

  const count = async (t) => (await one(`SELECT count(*)::int AS n FROM ${t}`)).n;
  console.log(`Seeded ${dbName}:`);
  console.log(`  ${await count('users')} users, ${await count('events')} events, ${await count('registrations')} registrations, ${await count('tickets')} tickets, ${await count('audit_logs')} audit entries`);
  console.log(`\nDemo accounts (password for all: ${DEMO_PASSWORD})`);
  for (const [email, , role] of PEOPLE) console.log(`  ${role.padEnd(12)} ${email}`);
}

try {
  await main();
} finally {
  await closeDb();
}
