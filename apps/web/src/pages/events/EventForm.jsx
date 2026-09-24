import { useState } from 'react';
import { ErrorNote } from '../../components/ui.jsx';
import { toLocalInput } from '../../format.js';

const blankType = () => ({ name: '', price: '', quantity: '' });

/**
 * Create or edit an event. On create it also collects ticket types.
 * Prices are entered in pesos and sent as centavos.
 */
export default function EventForm({ initial, withTicketTypes, onSubmit, onCancel, busy, error, submitLabel }) {
  const [f, setF] = useState(() => ({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    venue: initial?.venue ?? '',
    starts_at: initial ? toLocalInput(initial.starts_at) : '',
    ends_at: initial ? toLocalInput(initial.ends_at) : '',
    capacity: initial?.capacity ?? '',
    types: [{ name: 'General Admission', price: '', quantity: '' }],
  }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setType = (i, k, v) => setF({ ...f, types: f.types.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });

  const submit = (e) => {
    e.preventDefault();
    const body = {
      title: f.title, description: f.description, venue: f.venue, capacity: Number(f.capacity),
      starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(),
    };
    if (withTicketTypes) {
      body.ticket_types = f.types.map((t) => ({
        name: t.name, price_cents: Math.round(Number(t.price || 0) * 100), quantity: t.quantity ? Number(t.quantity) : null,
      }));
    }
    onSubmit(body);
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <ErrorNote error={error} />
      <div className="form-grid">
        <label style={{ gridColumn: '1 / -1' }}>Title<input required minLength={3} value={f.title} onChange={set('title')} placeholder="e.g. Metro Manila Career Fair 2026" /></label>
        <label style={{ gridColumn: '1 / -1' }}>Description<textarea value={f.description} onChange={set('description')} /></label>
        <label>Venue<input required value={f.venue} onChange={set('venue')} /></label>
        <label>Capacity<input required type="number" min={1} value={f.capacity} onChange={set('capacity')} /></label>
        <label>Starts<input required type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></label>
        <label>Ends<input required type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></label>
      </div>

      {withTicketTypes && (
        <div className="stack">
          <h3>Ticket types</h3>
          {f.types.map((t, i) => (
            <div className="form-grid" key={i}>
              <label>Name<input required value={t.name} onChange={(e) => setType(i, 'name', e.target.value)} /></label>
              <label>Price (₱) <span className="field-hint">0 for free</span><input required type="number" min={0} step="0.01" value={t.price} onChange={(e) => setType(i, 'price', e.target.value)} /></label>
              <label>Quantity <span className="field-hint">blank = up to capacity</span><input type="number" min={1} value={t.quantity} onChange={(e) => setType(i, 'quantity', e.target.value)} /></label>
              {f.types.length > 1 && (
                <div style={{ alignSelf: 'end' }}>
                  <button type="button" className="small danger" onClick={() => setF({ ...f, types: f.types.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              )}
            </div>
          ))}
          <div><button type="button" className="small" onClick={() => setF({ ...f, types: [...f.types, blankType()] })}>+ Add ticket type</button></div>
        </div>
      )}

      <div className="row">
        <button className="primary" disabled={busy}>{submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
