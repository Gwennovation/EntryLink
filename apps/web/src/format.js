const TZ = 'Asia/Manila';

export const peso = (cents) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: cents % 100 ? 2 : 0 }).format((cents ?? 0) / 100);

export const dateTime = (d) =>
  d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : '—';

export const time = (d) => (d ? new Date(d).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }) : '—');

export const dateRange = (a, b) => {
  const s = new Date(a);
  const e = new Date(b);
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${dateTime(s)} – ${e.toLocaleTimeString('en-PH', { timeStyle: 'short', timeZone: TZ })}`
    : `${dateTime(s)} – ${dateTime(e)}`;
};

/** Value for <input type="datetime-local"> from an ISO string. */
export const toLocalInput = (d) => {
  const date = new Date(d);
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60_000).toISOString().slice(0, 16);
};

export const humanize = (s) => (s ? s.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');
