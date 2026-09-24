// Live dashboard feed over Server-Sent Events (FR-008, NFR-006).
// Subscribes to domain events and pushes fresh stats to every dashboard watching that event.
import { eventStats } from './stats.js';

const clients = new Map(); // eventId -> Set<res>

export async function openLiveStream(req, res, eventId) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (!clients.has(eventId)) clients.set(eventId, new Set());
  clients.get(eventId).add(res);

  send(res, 'stats', await eventStats(eventId));
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.get(eventId)?.delete(res);
  });
}

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Bus subscriber: on any event tied to an event_id, broadcast the activity and new stats. */
export async function liveHandler(envelope) {
  const eventId = envelope.eventId;
  const watchers = eventId && clients.get(eventId);
  if (!watchers?.size) return;
  const stats = await eventStats(eventId);
  const activity = { name: envelope.name, occurred_at: envelope.occurredAt, data: envelope.data };
  for (const res of watchers) {
    send(res, 'activity', activity);
    send(res, 'stats', stats);
  }
}
