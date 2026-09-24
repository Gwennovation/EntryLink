import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { ErrorNote, StatusBadge, useAction, useLoad } from '../../components/ui.jsx';
import { humanize, time } from '../../format.js';

const RESULT_HOLD_MS = 2500;   // how long the big green/red banner stays up
const SAME_CODE_COOLDOWN_MS = 4000; // ignore the same QR still held in front of the camera

/** Camera → canvas → jsQR loop. Calls onCode(text) when a QR is decoded. */
function useQrCamera(videoRef, active, onCode) {
  const [camError, setCamError] = useState(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let stream;
    let raf;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastScan = 0;

    const tick = (t) => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && t - lastScan > 150) {
        lastScan = t;
        // Downscale for speed; QR codes decode fine at ~640px.
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) onCode(code.data);
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream = s;
        videoRef.current.srcObject = s;
        return videoRef.current.play().then(() => { setRunning(true); raf = requestAnimationFrame(tick); });
      })
      .catch((err) => setCamError(err?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser, or use manual lookup below.'
        : 'No camera available. Use manual lookup below.'));
    if (!navigator.mediaDevices) setCamError('This browser cannot access the camera (HTTPS is required). Use manual lookup below.');

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
      setRunning(false);
    };
  }, [active, videoRef, onCode]);
  return { camError, running };
}

export default function Gate() {
  const events = useLoad(() => api.get('/events'));
  const openEvents = (events.data?.events ?? []).filter((e) => e.status === 'published');
  const [eventId, setEventId] = useState('');
  const [cameraOn, setCameraOn] = useState(true);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const busyRef = useRef(false);
  const lastCodeRef = useRef({ code: null, at: 0 });
  const holdRef = useRef(null);

  useEffect(() => {
    if (!eventId && openEvents.length) {
      // Default to whichever event is happening now.
      const now = Date.now();
      const live = openEvents.find((e) => new Date(e.starts_at) - 6 * 3600_000 < now && new Date(e.ends_at) > now);
      setEventId((live ?? openEvents[0]).id);
    }
  }, [openEvents, eventId]);

  const show = useCallback((res) => {
    setResult(res);
    setLog((l) => [{ ...res, at: new Date().toISOString(), key: Math.random() }, ...l].slice(0, 15));
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(() => setResult(null), RESULT_HOLD_MS);
    navigator.vibrate?.(res.valid ? 80 : [60, 60, 60]);
  }, []);

  const onCode = useCallback(async (payload) => {
    const now = Date.now();
    if (busyRef.current || !eventId) return;
    if (lastCodeRef.current.code === payload && now - lastCodeRef.current.at < SAME_CODE_COOLDOWN_MS) return;
    lastCodeRef.current = { code: payload, at: now };
    busyRef.current = true;
    setError(null);
    try {
      show(await api.post('/checkin/scan', { event_id: eventId, payload }));
    } catch (err) {
      setError(err);
    } finally {
      busyRef.current = false;
    }
  }, [eventId, show]);

  const { camError, running } = useQrCamera(videoRef, cameraOn && Boolean(eventId), onCode);
  const current = openEvents.find((e) => e.id === eventId);

  return (
    <>
      <div className="page-head">
        <div><h1>Gate scanner</h1><p>Point the camera at the attendee’s QR ticket. Results appear instantly.</p></div>
        <div className="row">
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
            {openEvents.length === 0 && <option value="">No open events</option>}
            {openEvents.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <button onClick={() => setCameraOn((c) => !c)}>{cameraOn ? 'Pause camera' : 'Resume camera'}</button>
        </div>
      </div>
      <ErrorNote error={events.error || error} />

      <div className="grid grid-2">
        <div className="stack">
          <div className="scanner">
            <video ref={videoRef} muted playsInline />
            {running && <div className="reticle" />}
            {!running && <div className="placeholder">{camError ?? (cameraOn ? 'Starting camera…' : 'Camera paused')}</div>}
          </div>
          <div className={`scan-result ${result ? (result.valid ? 'valid' : 'invalid') : 'idle'}`} aria-live="assertive">
            {result ? (
              <>
                <div className="big">{result.valid ? '✓ VALID' : `✕ ${humanize(result.result).toUpperCase()}`}</div>
                <div className="msg">{result.message}</div>
                {result.ticket && <div style={{ opacity: 0.9, marginTop: 4 }}>{result.ticket.ticket_type} · <span className="mono">{result.ticket.short_code}</span></div>}
              </>
            ) : <div className="msg">Ready to scan{current ? ` — ${current.title}` : ''}</div>}
          </div>
        </div>

        <div className="stack">
          <ManualCheckIn eventId={eventId} onResult={show} />
          <div className="card">
            <h2>This session</h2>
            {log.length === 0 && <div className="muted small">Scans you make will appear here.</div>}
            <table>
              <tbody>
                {log.map((l) => (
                  <tr key={l.key}>
                    <td className="small muted">{time(l.at)}</td>
                    <td><StatusBadge status={l.result} /></td>
                    <td>{l.ticket?.attendee_name ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

/** Manual override for edge cases: look up by name / email / ticket code, give a reason, admit. */
function ManualCheckIn({ eventId, onResult }) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const act = useAction();

  const search = async (e) => {
    e.preventDefault();
    setSelected(null);
    const res = await act.run(() => api.get(`/checkin/lookup?event_id=${eventId}&q=${encodeURIComponent(q)}`));
    if (res) setMatches(res.tickets);
  };
  const admit = async (e) => {
    e.preventDefault();
    const res = await act.run(() => api.post('/checkin/manual', { event_id: eventId, ticket_id: selected.id, reason }));
    if (res) { onResult(res); setSelected(null); setReason(''); setMatches(null); setQ(''); }
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Manual check-in</h2>
      <p className="small muted" style={{ margin: 0 }}>For damaged screens, dead phones, or unreadable codes. Every manual entry is logged with your reason.</p>
      <ErrorNote error={act.error} />
      <form className="row" onSubmit={search}>
        <input style={{ flex: 1 }} placeholder="Ticket code, name or email" value={q} onChange={(e) => setQ(e.target.value)} minLength={2} required />
        <button disabled={act.busy || !eventId}>Search</button>
      </form>
      {matches && matches.length === 0 && <div className="muted small">No tickets found for this event.</div>}
      {matches?.map((t) => (
        <button key={t.id} type="button" className={selected?.id === t.id ? 'primary' : ''} style={{ justifyContent: 'space-between' }} onClick={() => setSelected(t)}>
          <span>{t.attendee_name} · <span className="mono">{t.short_code}</span></span>
          <StatusBadge status={t.status} />
        </button>
      ))}
      {selected && (
        <form className="stack" onSubmit={admit}>
          <label>Reason<input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Phone battery dead — verified government ID" /></label>
          <button className="ok" disabled={act.busy}>Check in {selected.attendee_name}</button>
        </form>
      )}
    </div>
  );
}
