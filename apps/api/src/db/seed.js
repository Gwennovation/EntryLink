// Seed demo data locally: npm run seed   (skips if the database already has users)
import { config } from '../config.js';
import { registerSubscribers } from '../services/subscribers.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from './demo.js';
import { closeDb, initDb } from './index.js';

if (config.env === 'production') throw new Error('Refusing to seed a production database. Use SEED_DEMO=true on the server instead.');

try {
  const dbName = await initDb(config);
  registerSubscribers();
  const summary = await seedDemo();
  if (!summary) {
    console.log(`Database (${dbName}) already has users — skipping seed. Delete apps/api/.data to start fresh.`);
  } else {
    console.log(`Seeded ${dbName}:`);
    console.log(`  ${summary.users} users, ${summary.events} events, ${summary.registrations} registrations, ${summary.tickets} tickets, ${summary.audit} audit entries`);
    console.log(`\nDemo accounts (password for all: ${DEMO_PASSWORD})`);
    for (const { email, role } of DEMO_ACCOUNTS) console.log(`  ${role.padEnd(12)} ${email}`);
  }
} finally {
  await closeDb();
}
