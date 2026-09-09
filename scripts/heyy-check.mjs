/* Checks the Heyy webhook without touching the real number.
 *
 *   node scripts/heyy-check.mjs
 *
 * Posts Heyy-shaped events at the function the way Heyy will, and confirms the
 * three things that decide whether the integration is sound: a wrong secret is
 * refused, an event we do not handle is acknowledged rather than retried
 * forever, and a real inbound message with a photograph is read, placed and
 * screened.
 *
 * Reads .env.supabase. Cleans up after itself. */

import { readFileSync } from 'node:fs';

for (const l of readFileSync('.env.supabase', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
const S = process.env.HEYY_WEBHOOK_SECRET;
if (!U || !K || !S) {
  console.error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and HEYY_WEBHOOK_SECRET in .env.supabase');
  process.exit(1);
}

const FROM = '15559' + Math.floor(Math.random() * 900000 + 100000);
const rest = async (p, init = {}) =>
  fetch(`${U}/rest/v1${p}`, { headers: { apikey: K, Authorization: `Bearer ${K}` }, ...init });
const q = async p => (await rest(p)).json();

const post = async (secret, body) => {
  const r = await fetch(`${U}/functions/v1/tmz-whatsapp?heyy=${encodeURIComponent(secret)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: r.status, text: (await r.text()).slice(0, 40) };
};

const event = (content) => ({
  event: 'message.received',
  data: {
    id: 'check-' + Date.now(), sender: 'inbound', content,
    contact: { name: 'Integration check' },
    handle: { type: 'phone_number', value: '+' + FROM },
    channel: { type: 'whatsapp', name: 'Torah MiTzion' }
  }
});

let bad = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) bad++;
};

console.log(`Checking ${U}\n`);

let r = await post('definitely-not-the-secret', event({ body: 'hello' }));
check('a wrong secret is refused', r.status === 403, `got ${r.status}`);

r = await post(S, { event: 'message.sent', data: { sender: 'outbound' } });
check('an event we ignore is acknowledged', r.status === 200 && r.text.includes('ignored'),
      `got ${r.status} ${r.text}`);

r = await post(S, event({ body: 'שלום, יש לי תמונה מממפיס 2004' }));
check('a text message is accepted', r.status === 200, `got ${r.status}`);

r = await post(S, event({
  body: 'ממפיס 2004',
  attachments: [{ file: {
    id: 'f1', url: 'https://picsum.photos/id/1074/1400/1000',
    type: 'image', contentType: 'image/jpeg', size: 180000 } }]
}));
check('a photograph is accepted', r.status === 200, `got ${r.status}`);

process.stdout.write('\nwaiting for the agent to finish');
let photo = null;
for (let i = 0; i < 15 && !photo; i++) {
  await new Promise(x => setTimeout(x, 2000));
  process.stdout.write('.');
  [photo] = await q(`/tmz_photo?select=id,year,community_id,agent_decision,status,width,height,submission_id` +
                    `&submitter_ref=like.wa:${FROM}%25`);
}
console.log('\n');

check('the photograph arrived and was sanitised', Boolean(photo?.width),
      photo ? `${photo.width}x${photo.height}` : 'nothing arrived');
check('the caption placed it', photo?.year === 2004 && Boolean(photo?.community_id),
      photo ? `year=${photo.year} community=${photo.community_id ? 'set' : 'MISSING'}` : '');
check('screening reached a verdict', Boolean(photo?.agent_decision),
      photo?.agent_decision === 'hold'
        ? 'hold — the screener was unreachable; it retries on the next message'
        : photo?.agent_decision ?? '');

// ---- clean up ----
if (photo) {
  const full = (await q(`/tmz_photo?select=storage_path,derived_path,public_path&id=eq.${photo.id}`))[0];
  for (const [bucket, key] of [
    ['tmz-photo-originals', full?.storage_path], ['tmz-photo-originals', full?.derived_path],
    ['tmz-photo-public', full?.public_path]
  ]) {
    if (key) await fetch(`${U}/storage/v1/object/${bucket}/${key}`,
      { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${K}` } });
  }
  await rest(`/tmz_photo?id=eq.${photo.id}`, { method: 'DELETE' });
  if (photo.submission_id) await rest(`/tmz_submission?id=eq.${photo.submission_id}`, { method: 'DELETE' });
}
await rest(`/tmz_wa_contact?ref=eq.wa:${FROM}`, { method: 'DELETE' });
console.log('cleaned up.\n');

console.log(bad === 0
  ? 'Heyy is wired correctly.'
  : `${bad} check(s) failed — do not publish the number yet.`);
process.exit(bad === 0 ? 0 : 1);
