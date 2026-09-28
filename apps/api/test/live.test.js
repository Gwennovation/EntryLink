// The live feed must work when the API runs as several instances (e.g. Vercel Functions): a scan
// handled by another instance never reaches this instance's event bus, so the stream polls the DB.
process.env.LIVE_POLL_MS = '150';
process.env.LIVE_MAX_SECONDS = '2';

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

const { createLiveEvent, db, setup, teardown } = await import('./helpers.js');

let ctx, event, server;
before(async () => {
  ctx = await setup();
  event = await createLiveEvent(ctx.as, { title: 'Live Poll' });
  server = ctx.app.listen(0);
});
after(async () => {
  server.closeAllConnections();
  server.close();
  await teardown();
});

/** Open the SSE stream and collect parsed events until it ends or `until` returns true. */
function stream(until, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const events = [];
    let buf = '';
    const req = http.get({
      port: server.address().port, path: `/api/events/${event.id}/live`,
      headers: { Authorization: `Bearer ${ctx.tokens.organizer}` },
    }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (type) events.push({ type, data: JSON.parse(data), at: Date.now() });
          if (events.length && until(events)) { req.destroy(); resolve({ events, ended: false }); }
        }
      });
      res.on('end', () => resolve({ events, ended: true }));
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
    setTimeout(() => { req.destroy(); resolve({ events, ended: false, timedOut: true }); }, timeoutMs);
  });
}

describe('live dashboard across instances', () => {
  it('pushes gate activity written by another instance (no bus event here)', async () => {
    // Done once the activity and the refreshed stats that follow it have both arrived.
    const pending = stream((evs) => evs.some((e) => e.type === 'activity')
      && evs.some((e) => e.type === 'stats' && e.data.rejected_scans === 1));
    await new Promise((r) => setTimeout(r, 300)); // stream is open
    // Simulate another instance: write straight to the DB, bypassing this process's event bus.
    await db.query(
      `INSERT INTO entry_logs (event_id, scanned_by, method, result) VALUES ($1, $2, 'scan', 'invalid')`,
      [event.id, ctx.users.gate_staff.id],
    );
    const { events } = await pending;
    const activity = events.find((e) => e.type === 'activity');
    assert.ok(activity, 'activity arrived via polling');
    assert.equal(activity.data.name, 'ticket.scan_rejected');
    assert.equal(activity.data.data.result, 'invalid');
    const lastStats = events.filter((e) => e.type === 'stats').at(-1);
    assert.equal(lastStats.data.rejected_scans, 1);
  });

  it('ends the stream before the platform limit so the browser reconnects cleanly', async () => {
    const t0 = Date.now();
    const { ended } = await stream(() => false, 6000);
    assert.equal(ended, true);
    assert.ok(Date.now() - t0 < 4000, 'closed after LIVE_MAX_SECONDS');
  });
});
