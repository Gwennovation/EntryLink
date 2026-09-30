import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorNote, StatusBadge, useLoad } from '../../components/ui.jsx';
import { dateTime, peso } from '../../format.js';

const TABS = [['pending', 'Pending'], ['revision_requested', 'Awaiting revision'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']];

export default function Review() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending';
  const eventId = params.get('event_id') ?? '';
  const [q, setQ] = useState('');
  const events = useLoad(() => api.get('/events'));
  const qs = new URLSearchParams(Object.entries({ status, event_id: eventId, q }).filter(([, v]) => v)).toString();
  const { data, error } = useLoad(() => api.get(`/registrations?${qs}`), [qs]);
  const setParam = (k, v) => { const next = new URLSearchParams(params); v ? next.set(k, v) : next.delete(k); if (k === 'status' && !v) next.set('status', ''); setParams(next); };

  return (
    <>
      <div className="page-head">
        <div><h1>Review queue</h1><p>Verify proof of payment, then approve, reject, or ask the attendee for a revision. Approval issues the QR ticket automatically.</p></div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <select value={eventId} onChange={(e) => setParam('event_id', e.target.value)} aria-label="Filter by event">
            <option value="">All events</option>
            {events.data?.events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <input type="search" className="grow" placeholder="Search name, email or payment ref" aria-label="Search registrations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs">
          {TABS.map(([value, label]) => {
            const n = data?.counts?.[value || 'all'];
            return (
              <button key={label} className={status === value ? 'active' : ''} aria-pressed={status === value} onClick={() => setParam('status', value)}>
                {label}{n != null && <span className="count">{n}</span>}
              </button>
            );
          })}
        </div>
        <ErrorNote error={error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Attendee</th><th>Event · ticket</th><th>Amount</th><th>Payment ref</th><th>Submitted</th></tr></thead>
            <tbody>
              {data?.registrations.map((r) => (
                // The whole row is clickable for mouse users; the name is a real link for keyboards and screen readers.
                <tr key={r.id} className="clickable" onClick={() => navigate(`/registrations/${r.id}`)}>
                  <td><StatusBadge status={r.status} /></td>
                  <td>
                    <Link to={`/registrations/${r.id}`} className="row-link" onClick={(e) => e.stopPropagation()}>{r.attendee_name}</Link>
                    <div className="small muted">{r.attendee_email}</div>
                  </td>
                  <td className="cell-wide">{r.event_title}<div className="small muted">{r.ticket_type}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.amount_cents ? peso(r.amount_cents) : 'Free'}</td>
                  <td className="mono">{r.payment_reference ?? '—'}{r.amount_cents > 0 && !r.has_proof && <div className="badge bad">no proof</div>}</td>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTime(r.updated_at)}{r.version > 1 && <div className="small muted">revision {r.version}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.registrations.length === 0 && <div className="empty">{status === 'pending' ? 'All caught up — nothing waiting for review.' : 'No registrations match.'}</div>}
        </div>
      </div>
    </>
  );
}
