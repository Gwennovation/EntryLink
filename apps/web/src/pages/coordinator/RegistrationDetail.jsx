import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ROLE_LABEL, useAuth } from '../../auth.jsx';
import { ErrorNote, StatusBadge, useAction, useLoad } from '../../components/ui.jsx';
import { dateTime, humanize, peso } from '../../format.js';

function ProofViewer({ registrationId, mime }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let objectUrl;
    api.blob(`/registrations/${registrationId}/proof`)
      .then((b) => { objectUrl = URL.createObjectURL(b); setUrl(objectUrl); })
      .catch(setError);
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [registrationId]);
  if (error) return <ErrorNote error={error} />;
  if (!url) return <div className="empty">Loading proof…</div>;
  return (
    <>
      {mime === 'application/pdf'
        ? <iframe className="proof-frame" src={url} title="Proof of payment" />
        : <img className="proof" src={url} alt="Proof of payment" />}
      <a href={url} target="_blank" rel="noreferrer" className="small">Open full size ↗</a>
    </>
  );
}

function Comments({ registrationId, canPost }) {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api.get(`/registrations/${registrationId}/comments`), [registrationId]);
  const [body, setBody] = useState('');
  const post = useAction();
  const submit = async (e) => {
    e.preventDefault();
    if (await post.run(() => api.post(`/registrations/${registrationId}/comments`, { body }))) { setBody(''); reload(); }
  };
  return (
    <div className="card">
      <h2>Comments</h2>
      <ErrorNote error={error || post.error} />
      <div className="stack">
        {data?.comments.map((c) => (
          <div key={c.id} className={`comment ${c.author_id === user.id ? 'mine' : ''}`}>
            <div className="comment-meta">{c.author_name} · {ROLE_LABEL[c.author_role]} · {dateTime(c.created_at)}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        ))}
        {data?.comments.length === 0 && <div className="muted small">No comments yet.</div>}
      </div>
      {canPost && (
        <form className="stack" onSubmit={submit} style={{ marginTop: 12 }}>
          <textarea placeholder="Write a message to the attendee…" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={2000} />
          <div><button disabled={post.busy || !body.trim()}>Send comment</button></div>
        </form>
      )}
    </div>
  );
}

export default function RegistrationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api.get(`/registrations/${id}`), [id]);
  const [note, setNote] = useState('');
  const act = useAction();
  const [flash, setFlash] = useState(null);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="empty">Loading…</div>;
  const { registration: r, history, ticket } = data;
  const canReview = user.role === 'coordinator' && r.status === 'pending';

  const decide = async (action, label) => {
    const res = await act.run(() => api.post(`/registrations/${id}/${action}`, note.trim() ? { note: note.trim() } : {}));
    if (res) {
      setNote('');
      setFlash(action === 'approve' ? `Approved — ticket ${res.ticket.short_code} issued and the attendee has been notified.` : `${label}. The attendee has been notified.`);
      reload();
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/review" className="small">← Review queue</Link>
          <div className="row" style={{ marginTop: 4 }}><h1>{r.attendee_name}</h1><StatusBadge status={r.status} /></div>
          <p>{r.event_title} · {r.ticket_type} · {r.amount_cents ? peso(r.amount_cents) : 'Free'}</p>
        </div>
      </div>
      {flash && <div className="alert ok" style={{ marginBottom: 16 }}>{flash}</div>}

      <div className="grid grid-3">
        <div className="stack">
          <div className="card">
            <h2>Proof of payment</h2>
            {r.has_proof ? <ProofViewer registrationId={r.id} mime={r.proof_mime} key={`${r.id}-${r.version}`} /> : <div className="empty">{r.amount_cents ? 'No proof uploaded.' : 'Free ticket — no payment required.'}</div>}
          </div>
          <Comments registrationId={r.id} canPost={user.role === 'coordinator'} />
        </div>

        <div className="stack">
          {canReview && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Decision</h2>
              <ErrorNote error={act.error} />
              <label>Note to attendee <span className="field-hint">required for reject / revision</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reference number doesn't match our bank records" />
              </label>
              <button className="ok" disabled={act.busy} onClick={() => decide('approve', 'Approved')}>✓ Approve & issue ticket</button>
              <button disabled={act.busy || note.trim().length < 3} onClick={() => decide('request-revision', 'Revision requested')}>↺ Request revision</button>
              <button className="danger" disabled={act.busy || note.trim().length < 3} onClick={() => decide('reject', 'Rejected')}>✕ Reject</button>
            </div>
          )}

          <div className="card">
            <h2>Registration</h2>
            <dl className="kv">
              <dt>Email</dt><dd>{r.attendee_email}</dd>
              {r.attendee_phone && <><dt>Phone</dt><dd>{r.attendee_phone}</dd></>}
              <dt>Payment ref</dt><dd className="mono">{r.payment_reference ?? '—'}</dd>
              <dt>Submitted</dt><dd>{dateTime(r.created_at)}</dd>
              <dt>Version</dt><dd>{r.version}</dd>
              {r.reviewer_name && <><dt>Reviewed by</dt><dd>{r.reviewer_name}</dd></>}
              {r.review_note && <><dt>Note</dt><dd>{r.review_note}</dd></>}
              {ticket && <><dt>Ticket</dt><dd><span className="mono">{ticket.short_code}</span> <StatusBadge status={ticket.status} /></dd></>}
            </dl>
          </div>

          <div className="card">
            <h2>History</h2>
            <ul className="timeline">
              {history.map((h, i) => (
                <li key={i}>
                  <strong>{humanize(h.to_status)}</strong> <span className="small muted">v{h.version}</span>
                  <div className="small muted">{dateTime(h.created_at)} · {h.actor_name ?? 'system'}</div>
                  {h.note && <div className="small">“{h.note}”</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
