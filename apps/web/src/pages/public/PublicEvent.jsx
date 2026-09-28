import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Logo, useLoad } from '../../components/ui.jsx';
import { dateRange, peso } from '../../format.js';

// Where "Register in the app" points. Production app: entrylink://  ·  Expo Go during development:
// exp://<your-LAN-IP>:8081/--/  (see README → "Testing on a phone").
const APP_LINK_BASE = import.meta.env.VITE_APP_LINK_BASE || 'entrylink://';
// Optional: where to get the app (App Store / Play Store / Expo link). Hidden when unset.
const APP_DOWNLOAD_URL = import.meta.env.VITE_APP_DOWNLOAD_URL || '';

/** Public page that event poster QR codes open. No sign-in required. */
export default function PublicEvent() {
  const { id } = useParams();
  const { data, error, loading } = useLoad(() => api.get(`/public/events/${id}`), [id]);
  const e = data?.event;
  useEffect(() => {
    document.title = e ? `${e.title} — EntryLink` : 'EntryLink';
  }, [e]);

  return (
    <div className="public-wrap">
      <div className="public-card">
        <Logo height={32} />
        {loading && <div className="empty">Loading event…</div>}
        {error && (
          <div className="stack">
            <h1>Event not found</h1>
            <p className="muted">This event may have been removed or isn’t open yet. Check with the organizer.</p>
          </div>
        )}
        {e && (
          <>
            <div>
              <h1>{e.title}</h1>
              <p className="muted" style={{ margin: '6px 0 0' }}>📅 {dateRange(e.starts_at, e.ends_at)}</p>
              <p className="muted" style={{ margin: '2px 0 0' }}>📍 {e.venue}</p>
            </div>
            {e.description && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{e.description}</p>}

            <div className="stack" style={{ gap: 6 }}>
              {e.ticket_types.map((t) => (
                <div key={t.name} className="row public-ticket">
                  <div>
                    <strong>{t.name}</strong>
                    {t.description && <div className="small muted">{t.description}</div>}
                  </div>
                  <span className="spacer" />
                  <span>{t.sold_out ? <span className="badge">Sold out</span> : <strong>{t.price_cents ? peso(t.price_cents) : 'Free'}</strong>}</span>
                </div>
              ))}
            </div>

            {e.registration_open ? (
              <div className="stack">
                <a className="btn primary public-cta" href={`${APP_LINK_BASE}event/${e.id}`}>Register in the EntryLink app</a>
                <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
                  Registration and your QR ticket live in the EntryLink mobile app.
                  {APP_DOWNLOAD_URL
                    ? <> Don’t have it yet? <a href={APP_DOWNLOAD_URL}>Get the app</a>, then scan the poster again.</>
                    : ' Don’t have it yet? Install EntryLink, then scan the poster again.'}
                </p>
              </div>
            ) : (
              <div className="alert info">{e.sold_out ? 'This event is sold out.' : 'Registration for this event is closed.'}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
