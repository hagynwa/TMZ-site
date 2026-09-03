import { sb, captureRedirect, getSession, signInWithGoogle, signOut } from './sb.js';
import { $, esc, REGION_NAMES } from './ui.js';
import { dashboard, coverage, communities, people, photos, translations } from './views.js';

/* Auth boot order matters: the redirect back from Google carries the token in
   the URL fragment, so we capture and clear that BEFORE we ever ask the DB who
   we are — otherwise the first request goes out anonymous and the RLS check
   for tmz_app_user fails silently. */
captureRedirect();

const app = $('#app');

async function boot() {
  const session = getSession();
  if (!session) { renderGate(); return; }

  const user = await sb.me();
  if (!user) { renderGate(); return; }

  /* tmz_app_user is empty on first sign-in. The RLS policy lets a user insert
     only their OWN row, so this is safe to do straight from the client. */
  const rows = await sb.from('tmz_app_user').select('*', { filter: { id: `eq.${user.id}` } });
  const profile = rows[0];
  if (!profile) { autoRegister(user); return; }

  renderShell(user, profile);
  handleRoute();
}

/* ---- signed out --------------------------------------------------------- */

function renderGate() {
  app.innerHTML = `
    <div class="gate"><div class="gate-card">
      <img src="../tmz-mark.png" alt="Torah MiTzion">
      <h1>Back office</h1>
      <p>Sign in to manage communities, people and photographs for the Torah MiTzion 30 archive.</p>
      <button class="btn-google" id="signIn">
        <svg width="17" height="17" viewBox="0 0 48 48"><path fill="#4285F4" d="M45 24c0-1.6-.1-3.1-.4-4.5H24v9h11.8c-.5 2.7-2.1 5-4.4 6.5v5.4h7.1C42.7 36.4 45 30.7 45 24z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.4c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.9-12.3-9H4.4v5.7C8 41.4 15.4 46 24 46z"/><path fill="#FBBC04" d="M11.7 28.4c-.5-1.3-.7-2.7-.7-4.4s.2-3 .7-4.4v-5.7H4.4C2.9 17 2 20.4 2 24s.9 7 2.4 10.1l7.3-5.7z"/><path fill="#EA4335" d="M24 10c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 3.4 29.9 1 24 1 15.4 1 8 5.6 4.4 12.2l7.3 5.7C13.5 13.9 18.3 10 24 10z"/></svg>
        Continue with Google
      </button>
      <small>Access is granted per user by an administrator after first sign-in.</small>
    </div></div>`;
  $('#signIn').onclick = () => signInWithGoogle(location.href.split('#')[0]);
}

/* ---- first-run intake --------------------------------------------------- */

/* Silent registration for the back office. The public "how do you know Torah
   MiTzion" question belongs to the site's contributor signup, not here — a
   back-office user is either promoted by an admin or they're not. */
async function autoRegister(user) {
  const displayName = user.user_metadata?.full_name || user.email || null;
  try {
    await sb.from('tmz_app_user').insert({ id: user.id, display_name: displayName });
    boot();
  } catch (e) {
    app.innerHTML = `<div class="gate"><div class="gate-card">
      <h1>Couldn't register</h1>
      <p>${esc(e.message)}</p>
      <button class="btn ghost" onclick="location.reload()">Try again</button>
    </div></div>`;
  }
}

/* ---- signed in ---------------------------------------------------------- */

function renderShell(user, profile) {
  const canWrite = ['editor', 'admin'].includes(profile.role);
  const displayName = profile.display_name || user.email;

  app.innerHTML = `
    <div class="shell">
      <aside class="side">
        <a class="side-brand" href="#/">
          <img src="../tmz-mark.png" alt="">
          <span>Back office<small>Torah MiTzion 30</small></span>
        </a>
        <nav class="nav" id="nav">
          <a href="#/" data-route="dashboard">Dashboard</a>
          <a href="#/coverage" data-route="coverage">Campaign</a>
          <a href="#/communities" data-route="communities">Communities</a>
          <a href="#/people" data-route="people">People</a>
          <a href="#/translations" data-route="translations">Translations</a>
          <a href="#/photos" data-route="photos">Moderation</a>
        </nav>
        <div class="side-me">
          <span class="name">${esc(displayName)}<span class="role-badge">${esc(profile.role)}</span></span>
          <span>${esc(user.email)}</span><br>
          <button id="signOut">Sign out</button>
        </div>
      </aside>
      <main id="page"></main>
    </div>`;

  $('#signOut').onclick = signOut;

  if (!canWrite) {
    /* A contributor can sign in but has no reason to be in the CMS — RLS would
       refuse every write anyway. Tell them plainly rather than showing an app
       full of buttons that fail. */
    $('#page').innerHTML = `
      <div class="page-head"><div><h1>Access pending</h1>
        <p>Your account is registered as <b>${esc(profile.role)}</b>.
          An administrator needs to grant you the <b>editor</b> role before you can use the back office.</p></div></div>
      <div class="empty">
        Nothing to show yet.<br>
        <small style="color:var(--dim)">Your user id: <span class="mono">${esc(user.id)}</span></small>
      </div>`;
  }
}

/* ---- routing ------------------------------------------------------------ */

const routes = {
  dashboard, coverage, communities, people, photos, translations
};

async function handleRoute() {
  if (!$('#page')) return;
  // strip any ?query the view carries (translations uses ?lang=)
  const h = (location.hash || '#/').slice(2).split('?')[0] || 'dashboard';
  const name = routes[h] ? h : 'dashboard';
  document.querySelectorAll('#nav a').forEach(a =>
    a.classList.toggle('on', a.dataset.route === name));
  try {
    $('#page').innerHTML = `<div class="empty">Loading…</div>`;
    await routes[name]();
  } catch (e) {
    $('#page').innerHTML = `<div class="error">${esc(e.message)}</div>`;
    console.error(e);
  }
}

window.addEventListener('hashchange', handleRoute);
boot();
