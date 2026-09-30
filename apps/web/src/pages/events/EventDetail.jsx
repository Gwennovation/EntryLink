import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { ErrorNote, Icon, StatusBadge, useAction, useLoad } from '../../components/ui.jsx';
import { dateRange, peso } from '../../format.js';
import EventForm from './EventForm.jsx';

export default function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api.get(`/events/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [newType, setNewType] = useState({ name: '', price: '', quantity: '' });
  const act = useAction();

  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const e = data.event;
  const owner = user.role === 'organizer' && e.organizer_id === user.id;
  const editable = owner && e.status !== 'closed';

  const doAction = async (fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    if (await act.run(fn) !== undefined) { setEditing(false); reload(); }
  };

  const addType = (ev) => {
    ev.preventDefault();
    doAction(async () => {
      await api.post(`/events/${id}/ticket-types`, {
        name: newType.name, price_cents: Math.round(Number(newType.price || 0) * 100), quantity: newType.quantity ? Number(newType.quantity) : null,
      });
      setNewType({ name: '', price: '', quantity: '' });
      return true;
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row"><h1>{e.title}</h1><StatusBadge status={e.status} /></div>
          <p>{e.venue} · {dateRange(e.starts_at, e.ends_at)} · organized by {e.organizer_name}</p>
        </div>
        <div className="row">
          {e.status !== 'draft' && user.role !== 'admin' && <Link className="btn" to={`/events/${id}/live`}>Live dashboard</Link>}
          {user.role === 'coordinator' && <Link className="btn" to={`/review?event_id=${id}`}>Review registrations</Link>}
          {owner && e.status !== 'draft' && <Link className="btn" to={`/events/${id}/tickets`}>Tickets & QR codes</Link>}
          {owner && e.status === 'published' && <Link className="btn" to={`/events/${id}/poster`}>Poster QR</Link>}
          {owner && e.status === 'draft' && (
            <button className="primary" disabled={act.busy} onClick={() => doAction(() => api.post(`/events/${id}/publish`),
              'Publish this event? Attendees will be able to see it and register.')}>Publish</button>
          )}
          {owner && e.status === 'published' && (
            <button className="danger" disabled={act.busy} onClick={() => doAction(() => api.post(`/events/${id}/close`),
              'Close this event? Registration and gate entry stop, and unused tickets are marked expired. This cannot be undone.')}>Close event</button>
          )}
        </div>
      </div>
      <ErrorNote error={act.error} />

      <div className="grid grid-3" style={{ marginTop: 12 }}>
        <div>
          {editing ? (
            <EventForm initial={e} submitLabel="Save changes" busy={act.busy}
              onSubmit={(body) => doAction(() => api.patch(`/events/${id}`, body))} onCancel={() => setEditing(false)} />
          ) : (
            <div className="card">
              <div className="row" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Details</h2><span className="spacer" />
                {editable && <button className="small" onClick={() => setEditing(true)}>Edit</button>}
              </div>
              <p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{e.description || <span className="muted">No description.</span>}</p>
              <dl className="kv">
                <dt>Venue</dt><dd>{e.venue}</dd>
                <dt>When</dt><dd>{dateRange(e.starts_at, e.ends_at)}</dd>
                <dt>Capacity</dt><dd>{e.capacity.toLocaleString()} attendees</dd>
                <dt>Payment</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>
                  {e.payment_instructions || (e.ticket_types.some((t) => t.price_cents > 0)
                    ? <span className="badge warn">Missing — add them so attendees know where to pay</span>
                    : <span className="muted">Not needed (free event)</span>)}
                </dd>
              </dl>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Ticket types</h2>
          <div className="stack">
            {e.ticket_types.map((t) => (
              <div key={t.id} className="row">
                <div>
                  <strong>{t.name}</strong>
                  <div className="small muted">{t.sold} sold{t.quantity ? ` of ${t.quantity}` : ''}</div>
                </div>
                <span className="spacer" />
                <span>{t.price_cents ? peso(t.price_cents) : 'Free'}</span>
                {editable && t.sold === 0 && (
                  <button className="small danger" disabled={act.busy} title="Delete ticket type" aria-label={`Delete ticket type ${t.name}`}
                    onClick={() => doAction(() => api.del(`/events/${id}/ticket-types/${t.id}`), `Delete ticket type "${t.name}"?`)}><Icon name="x" size="1em" /></button>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <form className="stack" onSubmit={addType} style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <h3>Add ticket type</h3>
              <input required placeholder="Name" value={newType.name} onChange={(ev) => setNewType({ ...newType, name: ev.target.value })} />
              <div className="row">
                <input required type="number" min={0} step="0.01" placeholder="Price ₱" style={{ flex: 1 }} value={newType.price} onChange={(ev) => setNewType({ ...newType, price: ev.target.value })} />
                <input type="number" min={1} placeholder="Qty (opt.)" style={{ flex: 1 }} value={newType.quantity} onChange={(ev) => setNewType({ ...newType, quantity: ev.target.value })} />
              </div>
              <button disabled={act.busy}>Add</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
