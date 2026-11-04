import { supabase } from './supabase';

// Same-origin Worker by default; set VITE_API_URL to use the Python backend instead.
const API_URL = import.meta.env.VITE_API_URL ?? '/api';

async function send(path, { method, body, form }, token) {
  const headers = { Authorization: `Bearer ${token ?? ''}` };
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    return await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  } catch {
    throw new Error(navigator.onLine === false ? "You're offline. Check your connection and try again." : "Couldn't reach the server. Try again.");
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const { data } = await supabase.auth.getSession();
  let res = await send(path, { method, body, form }, data.session?.access_token);
  if (res.status === 401 && data.session) {
    // The token may have expired while the phone was asleep: refresh once, then give up and sign out.
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error || !refreshed.session) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Your session expired. Please sign in again.');
    }
    res = await send(path, { method, body, form }, refreshed.session.access_token);
  }
  if (!res.ok) {
    let detail;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg).join('; ');
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export function localDate() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function formatDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
