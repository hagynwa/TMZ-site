/* A minimal Supabase client for the back office. The full supabase-js is 60KB
   over the CDN and needs a bundler for its ESM imports; every call the CMS
   actually makes is a plain PostgREST HTTPS request. This wraps that plus
   Auth's implicit-flow token handling. */

const AUTH = `${window.TMZ_SUPABASE_URL}/auth/v1`;
const REST = `${window.TMZ_SUPABASE_URL}/rest/v1`;
const KEY = window.TMZ_SUPABASE_ANON_KEY;
const SESSION_STORAGE_KEY = 'tmz.admin.session';

// ---- session ---------------------------------------------------------------

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.access_token) return null;
    if (s.expires_at && s.expires_at * 1000 < Date.now()) return null;
    return s;
  } catch { return null; }
}

/* Access tokens last an hour. Without this the back office signs you out
   mid-afternoon and sends you back through Google, which is no way to spend a
   day editing records. Refresh a minute early so a long request cannot land
   on an expired token. */
async function refreshSession() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null'); }
  catch { return null; }
  if (!stored?.refresh_token) return null;

  const res = await fetch(`${AUTH}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: stored.refresh_token })
  });
  if (!res.ok) { writeSession(null); return null; }

  const d = await res.json();
  if (!d.access_token) { writeSession(null); return null; }
  const s = {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? stored.refresh_token,
    expires_in: d.expires_in ?? 3600,
    expires_at: Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600) - 60,
    token_type: d.token_type || 'bearer'
  };
  writeSession(s);
  return s;
}

/* The one entry point the app should use: hands back a usable session,
   refreshing transparently, or null when the user really must sign in again. */
export async function ensureSession() {
  return readSession() ?? await refreshSession();
}

function writeSession(s) {
  if (s && s.access_token) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_STORAGE_KEY);
}

/* Supabase's implicit-flow redirect appends the tokens in the URL fragment.
   We pick them up on load, stash them, then wipe the hash so the same URL is
   safe to bookmark or share. */
export function captureRedirect() {
  if (!location.hash.includes('access_token=')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const access_token = params.get('access_token');
  if (!access_token) return null;
  const ttl = +params.get('expires_in') || 3600;
  const s = {
    access_token,
    refresh_token: params.get('refresh_token'),
    expires_in: ttl,
    expires_at: Math.floor(Date.now() / 1000) + ttl - 60,
    token_type: params.get('token_type') || 'bearer'
  };
  writeSession(s);
  history.replaceState(null, '', location.pathname + location.search);
  return s;
}

export function getSession() { return readSession(); }

export function signOut() {
  const s = readSession();
  writeSession(null);
  if (s) fetch(`${AUTH}/logout`, { method: 'POST', headers: authHeaders(s) }).catch(() => {});
  location.reload();
}

/* Google → Supabase Auth → back here. Supabase's OAuth endpoint expects the
   redirect URL to be on the allow list (added earlier). */
export function signInWithGoogle(redirectTo) {
  const url = new URL(`${AUTH}/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo || location.href.split('#')[0]);
  location.href = url.toString();
}

// ---- request layer ---------------------------------------------------------

function authHeaders(session) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${session ? session.access_token : KEY}`
  };
}

async function pg(path, { method = 'GET', body, prefer, session, retried } = {}) {
  const active = session || await ensureSession();
  const headers = { ...authHeaders(active), 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${REST}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });

  // A token can expire between the check and the request landing. Refresh once
  // and replay rather than throwing a confusing 401 at the view.
  if (res.status === 401 && !retried) {
    const fresh = await refreshSession();
    if (fresh) return pg(path, { method, body, prefer, session: fresh, retried: true });
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// A named alias the views can read to know they've reached the DB at all.
export const sb = {
  from(table) {
    return {
      select(cols = '*', { order, limit, filter } = {}) {
        const q = new URLSearchParams();
        q.set('select', cols);
        if (order) q.set('order', order);
        if (limit != null) q.set('limit', limit);
        if (filter) for (const [k, v] of Object.entries(filter)) q.set(k, v);
        return pg(`/${table}?${q}`);
      },
      insert(row, opts = {}) {
        return pg(`/${table}`, {
          method: 'POST',
          body: Array.isArray(row) ? row : [row],
          prefer: `resolution=merge-duplicates,return=${opts.return || 'representation'}`
        });
      },
      update(patch, filter) {
        const q = new URLSearchParams(filter || {});
        return pg(`/${table}?${q}`, {
          method: 'PATCH', body: patch, prefer: 'return=representation'
        });
      },
      upsert(row, opts = {}) {
        const q = new URLSearchParams();
        if (opts.onConflict) q.set('on_conflict', opts.onConflict);
        return pg(`/${table}?${q}`, {
          method: 'POST',
          body: Array.isArray(row) ? row : [row],
          prefer: 'resolution=merge-duplicates,return=representation'
        });
      },
      delete(filter) {
        const q = new URLSearchParams(filter || {});
        return pg(`/${table}?${q}`, { method: 'DELETE' });
      }
    };
  },

  async rpc(fn, args = {}) {
    return pg(`/rpc/${fn}`, { method: 'POST', body: args });
  },

  async me() {
    const s = await ensureSession();
    if (!s) return null;
    const res = await fetch(`${AUTH}/user`, { headers: authHeaders(s) });
    if (!res.ok) { writeSession(null); return null; }
    return res.json();
  }
};
