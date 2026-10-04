import { useState } from 'react';
import { api } from '../../api.js';
import { ROLE_LABEL } from '../../auth.jsx';
import { ErrorNote, useAction, useLoad } from '../../components/ui.jsx';
import { dateTime } from '../../format.js';

const ENTITY_TYPES = ['', 'registration', 'ticket', 'event', 'ticket_type', 'user', 'comment'];

export default function Audit() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [pages, setPages] = useState([]); // older pages appended via "Load more"
  const qs = new URLSearchParams(Object.entries({ entity_type: entityType, action, limit: '50' }).filter(([, v]) => v));
  const filterKey = qs.toString();
  const { data, error } = useLoad(() => api.get(`/audit?${filterKey}`), [filterKey]);
  const more = useAction();
  const verify = useAction();
  const [verdict, setVerdict] = useState(null);

  const entries = [...(data?.entries ?? []), ...pages.flatMap((p) => p.entries)];
  const nextBefore = pages.length ? pages.at(-1).next_before : data?.next_before;

  const loadMore = async () => {
    const page = await more.run(() => api.get(`/audit?${qs}&before=${nextBefore}`));
    if (page) setPages((p) => [...p, page]);
  };
  const runVerify = async () => setVerdict(await verify.run(() => api.get('/audit/verify')));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Append-only record of every workflow action. Each entry is hash-chained to the previous one.</p>
        </div>
        <button onClick={runVerify} disabled={verify.busy}>{verify.busy ? 'Verifying…' : 'Verify integrity'}</button>
      </div>
      {verdict && (
        <div className={`alert ${verdict.valid ? 'ok' : ''}`} style={{ marginBottom: 16 }}>
          {verdict.valid
            ? `Chain intact — ${verdict.checked} entries verified. Head hash ${verdict.headHash?.slice(0, 16)}…`
            : `Tampering detected at entry #${verdict.brokenAtId} (${verdict.checked} entries checked).`}
        </div>
      )}
      <ErrorNote error={verify.error} />
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPages([]); }}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t ? t.replace('_', ' ') : 'All entities'}</option>)}
          </select>
          <input placeholder="Action, e.g. registration.approved" value={action} onChange={(e) => { setAction(e.target.value.trim()); setPages([]); }} />
        </div>
        <ErrorNote error={error || more.error} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>When</th><th>Action</th><th>Actor</th><th>Entity</th><th>Details</th><th>Hash</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted">{e.id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.occurred_at)}</td>
                  <td><code>{e.action}</code></td>
                  <td>{e.actor_name ?? <span className="muted">system</span>}{e.actor_role && <div className="small muted">{ROLE_LABEL[e.actor_role]}</div>}</td>
                  <td>{e.entity_type}<div className="small muted mono">{e.entity_id?.slice(0, 8)}</div></td>
                  <td className="small mono" style={{ minWidth: 220, maxWidth: 360, wordBreak: 'break-word' }}>{JSON.stringify(e.data)}</td>
                  <td className="small mono muted" title={e.hash}>{e.hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && entries.length === 0 && <div className="empty">No audit entries match.</div>}
        </div>
        {nextBefore && <div className="row" style={{ marginTop: 12 }}><button onClick={loadMore} disabled={more.busy}>Load older entries</button></div>}
      </div>
    </>
  );
}
