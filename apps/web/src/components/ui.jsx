import { useCallback, useEffect, useState } from 'react';
import { humanize } from '../format.js';

const TONE = {
  pending: 'warn', revision_requested: 'info', approved: 'ok', rejected: 'bad', cancelled: '',
  issued: 'brand', checked_in: 'ok', expired: '',
  draft: '', published: 'ok', closed: '',
  accepted: 'ok', duplicate: 'warn', invalid: 'bad', wrong_event: 'bad', not_active: 'bad',
};

// One stroke icon set (24-unit grid, 2px round strokes), drawn at the surrounding text size.
const ICON_PATHS = {
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  'rotate-ccw': 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  'external-link': 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  'volume-on': 'M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14',
  'volume-off': 'M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  play: 'M6 3l14 9-14 9V3z',
};

/** Decorative icon: the adjacent text (or the control's aria-label) carries the meaning. */
export function Icon({ name, size = '1.15em', strokeWidth = 2 }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

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

/** The EntryLink wordmark; swaps to the light-on-dark version when the system is in dark mode. */
export function Logo({ height = 28, variant }) {
  if (variant) return <img src={`/logo-${variant}.svg`} alt="EntryLink" style={{ height, width: 'auto', display: 'block' }} />;
  return (
    <picture>
      <source srcSet="/logo-dark.svg" media="(prefers-color-scheme: dark)" />
      <img src="/logo-light.svg" alt="EntryLink" style={{ height, width: 'auto', display: 'block' }} />
    </picture>
  );
}
