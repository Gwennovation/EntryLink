import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download, liveUrl } from '../../api.js';
import { ErrorNote, Stat, StatusBadge, useAction, useLoad } from '../../components/ui.jsx';
import { dateRange, humanize, peso, time } from '../../format.js';

/** Live attendance dashboard (FR-008, NFR-006): counts update over SSE without a reload. */
export default function EventLive() {
  const { id } = useParams();
  const event = useLoad(() => api.get(`/events/${id}`), [id]);
  const initial = useLoad(() => api.get(`/events/${id}/stats`), [id]);
  const [stats, setStats] = useState(null);
  const [feed, setFeed] = useState([]);
  const [connected, setConnected] = useState(false);
  const [report, setReport] = useState(null);
  const act = useAction();

  useEffect(() => {
    if (initial.data) {
      setStats(initial.data.stats);
      setFeed(initial.data.recent_entries.map((r) => ({
        key: `e${r.id}`, at: r.created_at, result: r.result, who: r.attendee_name, code: r.short_code, method: r.method,
      })));
    }
  }, [initial.data]);

  useEffect(() => {
    const source = new EventSource(liveUrl(id));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // EventSource retries on its own
    source.addEventListener('stats', (e) => setStats(JSON.parse(e.data)));
    source.addEventListener('activity', (e) => {
      const a = JSON.parse(e.data);
      if (a.name === 'ticket.checked_in' || a.name === 'ticket.scan_rejected') {
        setFeed((f) => [{
          key: a.id ? `e${a.id}` : `${a.name}${a.occurred_at}`, at: a.occurred_at, result: a.name === 'ticket.checked_in' ? 'accepted' : a.data.result,
          who: a.data.attendee_name, code: a.data.short_code, method: a.data.method, fresh: true, // highlighted briefly as it arrives
        }, ...f].slice(0, 30));
      }
    });
    return () => source.close();
  }, [id]);

  const e = event.data?.event;
  const slug = e?.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row">
            <h1>{e?.title ?? 'Live dashboard'}</h1>
            {e && <StatusBadge status={e.status} />}
            <span className="small muted row" style={{ gap: 6 }}>
              {connected ? <><span className="pulse" /> Live</> : 'Reconnecting…'}
            </span>
          </div>
          {e && <p>{e.venue} · {dateRange(e.starts_at, e.ends_at)}</p>}
        </div>
        <div className="row">
          <Link className="btn" to={`/events/${id}`}>Event details</Link>
          <button onClick={() => act.run(async () => setReport((await api.get(`/events/${id}/report`)).report))} disabled={act.busy}>View report</button>
          <button className="primary" onClick={() => act.run(() => download(`/events/${id}/report?format=csv`, `entrylink-report-${slug}.csv`))} disabled={act.busy}>
            Download CSV
          </button>
        </div>
      </div>
      <ErrorNote error={event.error || initial.error || act.error} />

      {stats && (
        <div className="stats">
          <Stat label="Checked in (on site)" value={stats.checked_in.toLocaleString()} sub={`of ${stats.capacity.toLocaleString()} capacity`} meter={stats.checked_in / stats.capacity} />
          <Stat label="Tickets issued" value={stats.tickets_issued.toLocaleString()} sub={`${Math.max(0, stats.tickets_issued - stats.checked_in)} not yet arrived`} meter={stats.tickets_issued / stats.capacity} />
          <Stat label="Pending approval" value={stats.registrations.pending} sub={`${stats.registrations.revision_requested} awaiting attendee revision`} />
          <Stat label="Revenue (approved)" value={peso(stats.revenue_cents)} />
          <Stat label="Rejected scans" value={stats.rejected_scans} sub="duplicates, invalid, wrong event" />
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h2>Gate activity</h2>
          {feed.length === 0 && <div className="empty">No scans yet.</div>}
          <div className="table-wrap">
            <table>
              <tbody>
                {feed.map((f) => (
                  <tr key={f.key} className={f.fresh ? 'fresh' : undefined}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{time(f.at)}</td>
                    <td><StatusBadge status={f.result} /></td>
                    <td>{f.who ?? <span className="muted">Unknown ticket</span>}{f.code && <div className="small muted mono">{f.code}</div>}</td>
                    <td className="small muted">{f.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {stats && (
          <div className="card">
            <h2>Registrations</h2>
            <dl className="kv">
              {Object.entries(stats.registrations).map(([k, v]) => (
                <Fragment key={k}><dt>{humanize(k)}</dt><dd>{v}</dd></Fragment>
              ))}
            </dl>
            <p className="small muted" style={{ marginBottom: 0 }}>Updated {time(stats.generated_at)}</p>
          </div>
        )}
      </div>

      {report && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row"><h2 style={{ margin: 0 }}>Attendance & revenue report</h2><span className="spacer" /><button className="small" onClick={() => setReport(null)}>Hide</button></div>
          <div className="stats" style={{ marginTop: 12 }}>
            <Stat label="Attendance rate" value={`${Math.round(report.summary.attendance_rate * 100)}%`} />
            <Stat label="No-shows" value={report.summary.no_shows} />
            <Stat label="Revenue" value={peso(report.summary.revenue_cents)} />
          </div>
          <h3>By ticket type</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ticket type</th><th>Price</th><th>Approved</th><th>Checked in</th><th>Revenue</th></tr></thead>
              <tbody>
                {report.by_ticket_type.map((t) => (
                  <tr key={t.name}><td>{t.name}</td><td>{peso(t.price_cents)}</td><td>{t.approved}</td><td>{t.checked_in}</td><td>{peso(t.revenue_cents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginTop: 16 }}>Attendees ({report.attendees.length})</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Ticket</th><th>Code</th><th>Status</th><th>Checked in</th></tr></thead>
              <tbody>
                {report.attendees.map((a) => (
                  <tr key={a.short_code}><td>{a.full_name}</td><td>{a.email}</td><td>{a.ticket_type}</td><td className="mono">{a.short_code}</td><td><StatusBadge status={a.ticket_status} /></td><td>{time(a.checked_in_at)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
