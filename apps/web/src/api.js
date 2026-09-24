// Minimal fetch wrapper around the EntryLink REST API.
const BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'entrylink.token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, { body, raw } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: { message: 'Cannot reach the EntryLink server. Check your connection.' } });
  }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, body = {}) => request('POST', p, { body }),
  put: (p, body) => request('PUT', p, { body }),
  patch: (p, body) => request('PATCH', p, { body }),
  del: (p) => request('DELETE', p),
  blob: async (p) => (await request('GET', p, { raw: true })).blob(),
};

export const liveUrl = (eventId) => `${BASE}/events/${eventId}/live?access_token=${encodeURIComponent(getToken() ?? '')}`;

/** Download an authenticated file (e.g. CSV report) via a temporary object URL. */
export async function download(path, filename) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
