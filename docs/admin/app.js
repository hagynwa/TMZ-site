import { sb, captureRedirect, getSession, signInWithGoogle, signOut } from './sb.js';
import { $, esc, REGION_NAMES } from './ui.js';
import { dashboard, communities, people, photos } from './views.js';

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
  if (!profile) { renderIntake(user); return; }

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

function renderIntake(user) {
  const displayName = user.user_metadata?.full_name || user.email || '';
  app.innerHTML = `
    <div class="intake"><div class="intake-card">
      <h1>Welcome</h1>
      <p class="lede">One quick question — how do you know Torah MiTzion? We ask so we can route your access correctly.</p>
      <div id="intakeErr"></div>
      <label><span>Your name</span>
        <input id="i_name" value="${esc(displayName)}"></label>
      <label><span>How you're connected</span>
        <select id="i_kind">
          <option value="shaliach">I was a shaliach or shlicha</option>
          <option value="rosh_kollel">I was a Rosh Kollel</option>
          <option value="community_member">I'm from one of the communities</option>
          <option value="family">A relative served</option>
          <option value="alumnus">I'm otherwise an alumnus</option>
          <option value="staff">Torah MiTzion staff</option>
          <option value="other">Something else</option>
        </select></label>
      <label><span>Tell us a bit more <span class="dim">(which community, which year, in a sentence)</span></span>
        <textarea id="i_detail" rows="3"></textarea></label>
      <button class="btn solid" id="save" style="width:100%; padding:12px; justify-content:center;">Continue</button>
      <small style="display:block; margin-top:14px; color:var(--dim); font-size:11.5px;">
        Signed in as ${esc(user.email)}. <a href="#" id="out">Sign out</a>
      </small>
    </div></div>`;
  $('#out').onclick = e => { e.preventDefault(); signOut(); };
  $('#save').onclick = async () => {
    const err = $('#intakeErr');
    err.innerHTML = '';
    try {
      await sb.from('tmz_app_user').insert({
        id: user.id,
        display_name: $('#i_name').value.trim() || null,
        connection_kind: $('#i_kind').value,
        connection_detail: $('#i_detail').value.trim() || null
      });
      boot();
    } catch (e) {
      err.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  };
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
          <a href="#/communities" data-route="communities">Communities</a>
          <a href="#/people" data-route="people">People</a>
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
  dashboard, communities, people, photos
};

async function handleRoute() {
  if (!$('#page')) return;
  const h = (location.hash || '#/').slice(2) || 'dashboard';
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
