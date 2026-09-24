import { useCallback, useEffect, useState } from 'react';
import { humanize } from '../format.js';

const TONE = {
  pending: 'warn', revision_requested: 'info', approved: 'ok', rejected: 'bad', cancelled: '',
  issued: 'brand', checked_in: 'ok', expired: '',
  draft: '', published: 'ok', closed: '',
  accepted: 'ok', duplicate: 'warn', invalid: 'bad', wrong_event: 'bad', not_active: 'bad',
};

export function StatusBadge({ status }) {
  return <span className={`badge ${TONE[status] ?? ''}`}>{humanize(status)}</span>;
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="alert" role="alert">{error.message || String(error)}</div>;
}

export function Stat({ label, value, sub, meter }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {meter != null && <div className="meter"><span style={{ width: `${Math.min(100, meter * 100)}%` }} /></div>}
    </div>
  );
}

/** Load data from an async function; returns { data, error, loading, reload, setData }. */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return load()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error, loading: false }));
  }, [load]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

/** Wrap an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}
