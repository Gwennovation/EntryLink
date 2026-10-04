import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorNote, Icon, Logo, useLoad } from '../../components/ui.jsx';
import { dateRange } from '../../format.js';

/** Printable sheet of QR tickets (one card per attendee). Sidebar and controls are hidden when printing. */
export default function TicketSheet() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const qs = params.toString();
  const { data, error, loading } = useLoad(() => api.get(`/events/${id}/tickets/qr-sheet?${qs}`), [id, qs], { pollMs: 0 });
  const tickets = data?.tickets ?? [];

  return (
    <>
      <div className="page-head no-print">
        <div>
          <Link to={`/events/${id}/tickets`} className="small back-link"><Icon name="arrow-left" size="1em" />Tickets & QR codes</Link>
          <h1 style={{ marginTop: 4 }}>Print tickets</h1>
          <p>{loading ? 'Generating QR codes…' : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} ready to print.`}</p>
        </div>
        <button className="primary" disabled={!tickets.length} onClick={() => window.print()}>Print</button>
      </div>
      <ErrorNote error={error} />
      {data?.truncated && <div className="alert info no-print" style={{ marginBottom: 12 }}>Only the first 500 tickets are included — filter by name or code to print the rest.</div>}
      {data && !tickets.length && <div className="empty">No tickets to print.</div>}

      <div className="ticket-sheet">
        {tickets.map((t) => (
          <div className="ticket-card" key={t.id}>
            <div className="ticket-logo"><Logo height={20} variant="light" /></div>
            <div className="ticket-event">{t.event_title}</div>
            <img src={t.qr_image} alt={`QR ticket ${t.short_code}`} />
            <div className="ticket-code">{t.short_code}</div>
            <div className="ticket-name">{t.attendee_name}</div>
            <div className="ticket-meta">{t.ticket_type}</div>
            <div className="ticket-meta">{t.venue}</div>
            <div className="ticket-meta">{dateRange(t.starts_at, t.ends_at)}</div>
          </div>
        ))}
      </div>
    </>
  );
}
