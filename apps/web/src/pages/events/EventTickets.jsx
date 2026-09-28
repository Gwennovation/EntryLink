import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorNote, StatusBadge, useAction, useLoad } from '../../components/ui.jsx';
import { dateRange, time } from '../../format.js';

/**
 * Backup copies of attendee QR tickets for the organizer — for when an attendee didn't receive
 * theirs, lost their phone, or doesn't have the app. Every view is recorded in the audit log.
 */
export default function EventTickets() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const event = useLoad(() => api.get(`/events/${id}`), [id]);
  const qs = new URLSearchParams(Object.entries({ q, status }).filter(([, v]) => v)).toString();
  const roster = useLoad(() => api.get(`/events/${id}/tickets?${qs}`), [id, qs]);
  const [selected, setSelected] = useState(null);
  const show = useAction();

  const resend = useAction();
  const [resent, setResent] = useState(null);

  const open = async (t) => {
    setResent(null);
    const res = await show.run(() => api.get(`/events/${id}/tickets/${t.id}/qr`));
    if (res) setSelected(res.ticket);
  };
  const resendTicket = async () => {
    const res = await resend.run(() => api.post(`/events/${id}/tickets/${selected.id}/resend`));
    if (res) setResent(res.channels);
  };
  const printSheet = (params) => navigate(`/events/${id}/tickets/print?${new URLSearchParams(params)}`);

  const e = event.data?.event;
  return (
    <>
      <div className="page-head">
        <div>
          <Link to={`/events/${id}`} className="small">← {e?.title ?? 'Event'}</Link>
          <h1 style={{ marginTop: 4 }}>Tickets & QR codes</h1>
          <p>Backup copies of attendee tickets, in case an attendee didn’t receive theirs. Viewing or printing a QR is recorded in the audit log.</p>
        </div>
        <button className="primary" onClick={() => printSheet({ status: 'issued', ...(q && { q }) })}>Print unused tickets</button>
      </div>
      <ErrorNote error={event.error || roster.error || show.error} />

      <div className="grid grid-3">
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <input style={{ flex: 1 }} placeholder="Search name, email or ticket code" value={q} onChange={(ev) => setQ(ev.target.value)} />
            <select value={status} onChange={(ev) => setStatus(ev.target.value)}>
              <option value="">All statuses</option>
              <option value="issued">Not yet used</option>
              <option value="checked_in">Checked in</option>
              <option value="cancelled">Cancelled</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          {roster.data?.truncated && <div className="alert info" style={{ marginBottom: 12 }}>Showing the first 500 tickets — search to narrow the list.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Attendee</th><th>Ticket</th><th>Code</th><th>Status</th><th /></tr></thead>
              <tbody>
                {roster.data?.tickets.map((t) => (
                  <tr key={t.id} className={selected?.id === t.id ? 'selected' : ''}>
                    <td>{t.attendee_name}<div className="small muted">{t.attendee_email}</div></td>
                    <td>{t.ticket_type}</td>
                    <td className="mono">{t.short_code}</td>
                    <td><StatusBadge status={t.status} />{t.checked_in_at && <div className="small muted">{time(t.checked_in_at)}</div>}</td>
                    <td><button className="small" disabled={show.busy} onClick={() => open(t)}>Show QR</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {roster.data?.tickets.length === 0 && (
              <div className="empty">{q || status ? 'No tickets match.' : 'No tickets yet — they appear here as coordinators approve registrations.'}</div>
            )}
          </div>
        </div>

        <div className="card stack" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
          {selected ? (
            <>
              <div className="row"><h2 style={{ margin: 0 }}>{selected.attendee_name}</h2><span className="spacer" /><StatusBadge status={selected.status} /></div>
              <img className="qr-large" src={selected.qr_image} alt={`QR ticket ${selected.short_code}`} />
              <div className="mono" style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{selected.short_code}</div>
              <div className="small muted" style={{ textAlign: 'center' }}>{selected.ticket_type} · {dateRange(selected.starts_at, selected.ends_at)}</div>
              {selected.status !== 'issued' && (
                <div className="alert info">This ticket is {selected.status.replace('_', ' ')} — the gate will not admit it again.</div>
              )}
              <div className="row">
                <a className="btn" href={selected.qr_image} download={`entrylink-ticket-${selected.short_code}.png`}>Download PNG</a>
                <button onClick={() => printSheet({ q: selected.short_code })}>Print</button>
                {selected.status === 'issued' && <button disabled={resend.busy} onClick={resendTicket}>{resend.busy ? 'Sending…' : 'Resend ticket'}</button>}
              </div>
              <ErrorNote error={resend.error} />
              {resent && (
                <div className="alert ok">
                  Sent to {selected.attendee_name}’s app inbox.{' '}
                  {resent.email === 'not_configured' ? 'Email isn’t set up yet, so no email went out — download or print the QR if they need a copy now.' : 'Email sent too.'}
                </div>
              )}
              <p className="small muted" style={{ margin: 0 }}>
                Send the PNG to the attendee, or print it. It’s the same QR as in their wallet, so the gate admits it only once.
              </p>
            </>
          ) : (
            <div className="empty" style={{ padding: 16 }}>Select <strong>Show QR</strong> on a ticket to view, download or print it.</div>
          )}
        </div>
      </div>
    </>
  );
}
