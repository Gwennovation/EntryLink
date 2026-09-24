// In-process domain event bus — the backbone of the integration component (spec §2.4).
//
// Core services (registration, ticketing, check-in) only *publish* facts such as `ticket.issued`.
// Notification, audit and live-dashboard services *subscribe* and react independently, so a new
// subscriber (e.g. a real SMS provider) can be added without touching the publishing code.
//
// Events are published after the originating transaction commits, so subscribers never see
// state that was rolled back. publish() awaits all subscribers; one failing subscriber is logged
// and does not affect the others or the caller.
//
// Swap for a durable broker (Redis Streams, RabbitMQ) if the API ever runs as multiple processes.

const handlers = new Map();

/** Subscribe to an event name, or '*' for every event. Returns an unsubscribe function. */
export function subscribe(name, handler) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(handler);
  return () => handlers.get(name).delete(handler);
}

/**
 * @param {string} name   e.g. 'registration.approved'
 * @param {object} event  { actorId, entityType, entityId, eventId?, data? }
 */
export async function publish(name, event) {
  const envelope = { name, occurredAt: new Date(), data: {}, ...event };
  const targets = [...(handlers.get(name) ?? []), ...(handlers.get('*') ?? [])];
  const results = await Promise.allSettled(targets.map((h) => h(envelope)));
  for (const r of results) {
    if (r.status === 'rejected') console.error(`[bus] subscriber failed for ${name}:`, r.reason);
  }
}

export function clearSubscribers() {
  handlers.clear();
}
