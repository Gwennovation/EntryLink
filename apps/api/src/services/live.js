// Live dashboard feed over Server-Sent Events (FR-008, NFR-006).
//
// Each open stream re-reads the database every LIVE_POLL_MS for new gate activity (entry_logs) and
// changed stats, so it works when the API runs as several instances (e.g. Vercel Functions) and a
// scan is handled by a different instance than the one holding the stream. Bus events on the same
// instance trigger an immediate check, so updates there feel instant.
//
// Streams end themselves after LIVE_MAX_SECONDS (before Vercel's 300 s function limit); the
// browser's EventSource reconnects automatically and picks up where it left off.
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import { eventStats } from './stats.js';

const streams = new Map(); // eventId -> Set<stream>

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function check(stream) {
  if (stream.busy || stream.closed) return;
  stream.busy = true;
  try {
    const { rows } = await query(
      `SELECT l.id, l.result, l.method, l.created_at, t.short_code, a.full_name AS attendee_name
         FROM entry_logs l
         LEFT JOIN tickets t ON t.id = l.ticket_id
         LEFT JOIN users a ON a.id = t.attendee_id
        WHERE l.event_id = $1 AND l.id > $2 ORDER BY l.id`,
      [stream.eventId, stream.lastLogId],
    );
    for (const r of rows) {
      send(stream.res, 'activity', {
        id: String(r.id),
        name: r.result === 'accepted' ? 'ticket.checked_in' : 'ticket.scan_rejected',
        occurred_at: r.created_at,
        data: { result: r.result, method: r.method, short_code: r.short_code, attendee_name: r.attendee_name },
      });
      stream.lastLogId = r.id;
    }
    const stats = await eventStats(stream.eventId);
    const { generated_at, ...comparable } = stats;
    const key = JSON.stringify(comparable);
    if (key !== stream.lastStats) {
      stream.lastStats = key;
      send(stream.res, 'stats', stats);
    }
  } catch (err) {
    console.error('[live] check failed:', err.message);
  } finally {
    stream.busy = false;
  }
}

export async function openLiveStream(req, res, eventId) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 2000\n\n'); // reconnect quickly when the stream is handed off

  // Only activity after connecting is pushed; the dashboard loads history via /stats.
  const { max } = await one('SELECT coalesce(max(id), 0) AS max FROM entry_logs WHERE event_id = $1', [eventId]);
  const stream = { res, eventId, lastLogId: max, lastStats: null, busy: false, closed: false };
  if (!streams.has(eventId)) streams.set(eventId, new Set());
  streams.get(eventId).add(stream);
  await check(stream);

  const poll = setInterval(() => check(stream), config.livePollMs);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  const lifetime = setTimeout(() => res.end(), config.liveMaxSeconds * 1000);
  const cleanup = () => {
    stream.closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    streams.get(eventId)?.delete(stream);
  };
  req.on('close', cleanup);
  res.on('finish', cleanup);
}

/** Bus subscriber: something changed for an event on this instance; check its streams now. */
export async function liveHandler(envelope) {
  const watchers = envelope.eventId && streams.get(envelope.eventId);
  if (!watchers?.size) return;
  await Promise.all([...watchers].map(check));
}
