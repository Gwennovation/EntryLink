import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorNote, Icon, Logo, useLoad } from '../../components/ui.jsx';
import { dateRange } from '../../format.js';

/** Printable poster with one QR that takes people to the event's public registration page. */
export default function EventPoster() {
  const { id } = useParams();
  const event = useLoad(() => api.get(`/events/${id}`), [id]);
  const poster = useLoad(() => api.get(`/events/${id}/poster`), [id]);
  const e = event.data?.event;
  const p = poster.data;
  const slug = e?.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <>
      <div className="page-head no-print">
        <div>
          <Link to={`/events/${id}`} className="small back-link"><Icon name="arrow-left" size="1em" />{e?.title ?? 'Event'}</Link>
          <h1 style={{ marginTop: 4 }}>Event poster QR</h1>
          <p>Put this on posters, flyers or slides. Scanning it opens the event page, which sends people to the app to register.</p>
        </div>
        {p && (
          <div className="row">
            <a className="btn" href={p.qr_image} download={`entrylink-poster-qr-${slug}.png`}>Download QR (PNG)</a>
            <button className="primary" onClick={() => window.print()}>Print poster</button>
          </div>
        )}
      </div>
      <ErrorNote error={event.error || poster.error} />
      {p?.link_is_local && (
        <div className="alert info no-print" style={{ marginBottom: 16 }}>
          This QR points to <code>{p.url}</code>. Phones can’t open “localhost” links, so set <code>PUBLIC_WEB_URL</code> on the
          API (e.g. <code>http://192.168.x.x:5173</code> for testing, or your real domain) before printing.
        </div>
      )}

      {e && p && (
        <div className="poster">
          <div className="poster-logo"><Logo height={40} variant="light" /></div>
          <div className="poster-kicker">You’re invited</div>
          <div className="poster-title">{e.title}</div>
          <div className="poster-meta">{dateRange(e.starts_at, e.ends_at)}</div>
          <div className="poster-meta">{e.venue}</div>
          <img className="poster-qr" src={p.qr_image} alt="Scan to register" />
          <div className="poster-cta">Scan to register</div>
          <div className="poster-url">{p.url}</div>
        </div>
      )}
    </>
  );
}
