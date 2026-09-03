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
  const s = {
    access_token,
    refresh_token: params.get('refresh_token'),
    expires_in: +params.get('expires_in') || 3600,
    expires_at: Math.floor(Date.now() / 1000) + (+params.get('expires_in') || 3600),
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

async function pg(path, { method = 'GET', body, prefer, session } = {}) {
  const headers = { ...authHeaders(session || readSession()), 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${REST}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
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
    const s = readSession();
    if (!s) return null;
    const res = await fetch(`${AUTH}/user`, { headers: authHeaders(s) });
    if (!res.ok) { writeSession(null); return null; }
    return res.json();
  }
};
