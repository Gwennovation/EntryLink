import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * API base URL. Set EXPO_PUBLIC_API_URL to override. In development we default to the machine
 * running the Expo dev server on port 4000, so a phone on the same Wi-Fi reaches the local API.
 */
function resolveBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000/api`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000/api' : 'http://localhost:4000/api';
}

export const API_URL = resolveBaseUrl();

const unreachable = () => `Can’t reach EntryLink right now. Check your internet connection and try again.${__DEV__ ? ` (API: ${API_URL})` : ''}`;

let token = null;
let onUnauthorized = () => {};
export const setApiToken = (t) => { token = t; };
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: { message: unreachable() } });
  }
  // A non-JSON reply came from something other than the API (proxy/host error page).
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  if (res.status === 401 && token && isJson) onUnauthorized();
  if (res.status === 204) return null;
  if (!isJson) throw new ApiError(res.status, { error: { message: unreachable() } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, body = {}) => request('POST', p, body),
  put: (p, body) => request('PUT', p, body),
};

/** Build multipart form data including an optional picked file ({ uri, name, mimeType }). */
export function formWith(fields, file) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== '') form.append(k, String(v));
  if (file) {
    if (Platform.OS === 'web' && file.file) form.append('proof', file.file, file.name);
    else form.append('proof', { uri: file.uri, name: file.name, type: file.mimeType });
  }
  return form;
}
