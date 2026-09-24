import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { ErrorNote, StatusBadge, useAction, useLoad } from '../../components/ui.jsx';
import { dateRange, peso } from '../../format.js';
import EventForm from './EventForm.jsx';

export default function Events() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => api.get('/events'));
  const [creating, setCreating] = useState(false);
  const create = useAction();
  const isOrganizer = user.role === 'organizer';

  const submit = async (body) => {
    const res = await create.run(() => api.post('/events', body));
    if (res) navigate(`/events/${res.event.id}`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isOrganizer ? 'My events' : 'Events'}</h1>
          <p>{isOrganizer ? 'Create events, set ticket types and capacity, and monitor attendance.' : 'Open an event to see its live dashboard and report.'}</p>
        </div>
        {isOrganizer && !creating && <button className="primary" onClick={() => setCreating(true)}>+ New event</button>}
      </div>

      {creating && (
        <div style={{ marginBottom: 16 }}>
          <EventForm withTicketTypes submitLabel="Create draft event" busy={create.busy} error={create.error}
            onSubmit={submit} onCancel={() => setCreating(false)} />
        </div>
      )}

      <ErrorNote error={error} />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>When</th><th>Status</th><th>Tickets</th><th>Price range</th><th /></tr></thead>
            <tbody>
              {data?.events.map((e) => {
                const prices = e.ticket_types.map((t) => t.price_cents);
                return (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/events/${e.id}`)}>
                    <td><strong>{e.title}</strong><div className="small muted">{e.venue}</div></td>
                    <td className="small">{dateRange(e.starts_at, e.ends_at)}</td>
                    <td><StatusBadge status={e.status} /></td>
                    <td>{e.approved_count} / {e.capacity}</td>
                    <td className="small">{prices.length ? `${peso(Math.min(...prices))} – ${peso(Math.max(...prices))}` : '—'}</td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      {user.role !== 'admin' && e.status !== 'draft' && <Link to={`/events/${e.id}/live`}>Live dashboard →</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data?.events.length === 0 && <div className="empty">{isOrganizer ? 'No events yet — create your first one.' : 'No events yet.'}</div>}
        </div>
      </div>
    </>
  );
}
