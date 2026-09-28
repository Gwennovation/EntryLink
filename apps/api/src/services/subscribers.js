// Wires independent subscribers onto the domain event bus (spec §2.4).
import { subscribe } from '../lib/bus.js';
import { recordAudit } from './audit.js';
import { emailHandlers } from './email.js';
import { liveHandler } from './live.js';
import { notificationHandlers } from './notifications.js';

let registered = false;

export function registerSubscribers() {
  if (registered) return;
  registered = true;
  subscribe('*', recordAudit);
  subscribe('*', liveHandler);
  for (const [name, handler] of Object.entries(notificationHandlers)) subscribe(name, handler);
  for (const [name, handler] of Object.entries(emailHandlers)) subscribe(name, handler);
}
