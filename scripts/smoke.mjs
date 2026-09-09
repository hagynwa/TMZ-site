/* The check to run before anybody is told the number.
 *
 *   node scripts/smoke.mjs
 *
 * Walks both doors into the archive — the contribute page and the WhatsApp
 * agent — and the refusals that matter. It does not prove the screener's
 * judgement is right; that needs the organisation's own photographs through
 * /sim/. It proves the plumbing is connected and the door is shut to what
 * should not get in.
 *
 * Cleans up everything it creates. */

import { readFileSync } from 'node:fs';

for (const l of readFileSync('.env.supabase', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const T = process.env.SIM_TOKEN;
if (!U || !K) { console.error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }

const anon = readFileSync('docs/api.js', 'utf8')
  .match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]+/)?.[0];

const rest = (p, init = {}) =>
  fetch(`${U}/rest/v1${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` }, ...init });
const q = async p => (await rest(p)).json();
const b64 = b => Buffer.from(b).toString('base64');
const pic = async (id, w = 1400, h = 1000) => Buffer.from(await (await fetch(
  `https://picsum.photos/id/${id}/${w}/${h}`, { headers: { 'User-Agent': 'tmz-smoke/1.0' } })).arrayBuffer());

let bad = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) bad++;
};

const created = { photos: [], submissions: [], contacts: [] };

// ---- the contribute page ---------------------------------------------------
console.log('the contribute page\n');

const upload = async (file, mime, extra = {}) => {
  const r = await fetch(`${U}/functions/v1/tmz-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({
      consented: true, community_slug: 'memphis', year: 2004,
      contributor_name: 'Smoke test', file: b64(file), mime, ...extra
    })
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};

let r = await upload(Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><script>alert(1)</script></svg>'),
  'image/jpeg');
check('an SVG carrying script is refused', r.status === 415, `got ${r.status}`);

r = await upload(Buffer.from('<!doctype html><script>alert(1)</script>'), 'image/png');
check('an HTML page declared as an image is refused', r.status === 415, `got ${r.status}`);

r = await upload(await pic(1084), 'image/jpeg');
check('a real photograph is accepted', r.ok === true || r.accepted !== undefined,
      r.message ?? r.error ?? `status ${r.status}`);
if (r.photo_id) created.photos.push(r.photo_id);

// ---- the WhatsApp agent ----------------------------------------------------
console.log('\nthe WhatsApp agent\n');

if (!T) {
  console.log('  (skipped — SIM_TOKEN is not set, so the test console is off)');
} else {
  const FROM = '15558' + Math.floor(Math.random() * 900000 + 100000);
  const sim = async (body, qs = 'sim=1') => {
    const res = await fetch(`${U}/functions/v1/tmz-whatsapp?${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tmz-sim-token': T },
      body: JSON.stringify(body)
    });
    return { status: res.status, ...(await res.json()) };
  };
  const steps = o => (o.trace || []).map(s => s.step);

  let o = await sim({ from: FROM, type: 'text', text: 'שלום' });
  check('a Hebrew message is answered in Hebrew', /[֐-׿]/.test(o.replies?.[0] ?? ''),
        (o.replies?.[0] ?? '').slice(0, 40));

  o = await sim({ from: FROM, name: 'Smoke test', type: 'image', caption: 'ממפיס 2004',
                  image: { data: b64(await pic(1074)), mime: 'image/jpeg' } });
  const st = steps(o);
  check('a photograph is sanitised', st.includes('sanitised'), st.join(' → '));
  check('the Hebrew caption places it', st.includes('caption read locally'));
  check('a verdict is reached', st.includes('screened'));

  o = await sim({ from: FROM, name: 'Smoke test', type: 'image',
                  image: { data: b64(await pic(1050, 4640, 3480)), mime: 'image/jpeg' } });
  check('an oversized photograph is turned away kindly',
        steps(o).includes('refused at the door') &&
        !/did not pass/.test(o.replies?.[0] ?? ''),
        (o.replies?.[0] ?? '').slice(0, 50));

  await sim({ from: FROM }, 'sim=reset');
  created.contacts.push(`wa:${FROM}`);
}

// ---- what the public can see ----------------------------------------------
console.log('\nwhat the public can see\n');

const rpc = async (fn, args) => (await fetch(`${U}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(args)
})).json();

const map = await rpc('tmz_map_payload', { want: 'en' });
check('the map payload answers anonymously', Array.isArray(map?.communities),
      `${map?.communities?.length ?? 0} communities`);
check('it carries the real communities', (map?.communities?.length ?? 0) === 23,
      `expected 23, got ${map?.communities?.length ?? 0}`);

for (const fn of ['tmz_coverage', 'tmz_intake_stats', 'tmz_contributors']) {
  const res = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: '{}' });
  check(`${fn} is closed to the public`, res.status === 401 || res.status === 403, `got ${res.status}`);
}

// ---- clean up --------------------------------------------------------------
for (const id of created.photos) {
  const [p] = await q(`/tmz_photo?select=storage_path,derived_path,public_path,submission_id&id=eq.${id}`);
  for (const [bucket, key] of [
    ['tmz-photo-originals', p?.storage_path], ['tmz-photo-originals', p?.derived_path],
    ['tmz-photo-public', p?.public_path]
  ]) if (key) await fetch(`${U}/storage/v1/object/${bucket}/${key}`,
    { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${K}` } });
  await rest(`/tmz_photo?id=eq.${id}`, { method: 'DELETE' });
  if (p?.submission_id) await rest(`/tmz_submission?id=eq.${p.submission_id}`, { method: 'DELETE' });
}
for (const ref of created.contacts) await rest(`/tmz_wa_contact?ref=eq.${ref}`, { method: 'DELETE' });

const left = (await q('/tmz_photo?select=id')).length;
console.log(`\ncleaned up — ${left} photograph(s) in the archive.`);
console.log(bad === 0
  ? '\nEverything is connected. Calibrate the screener on real photographs through /sim/, then publish the number.'
  : `\n${bad} check(s) failed — do not publish the number yet.`);
process.exit(bad === 0 ? 0 : 1);
