/* Fills the translation tables from scripts/translations.json and
   scripts/people-translations.json.

   Separate from import-real.mjs on purpose: that file carries what
   torahmitzion.org says, and nothing in it is mine. These two carry renderings
   I wrote, which is a different kind of claim and belongs in different files.

   Idempotent — every write is an upsert on the (entity, lang) primary key, so
   re-running corrects rather than duplicates.

     node scripts/import-translations.mjs            # write
     node scripts/import-translations.mjs --dry-run  # report only */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

function loadEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv(join(ROOT, '.env.supabase'));

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const REST = `${URL_BASE.replace(/\/$/, '')}/rest/v1`;

async function pg(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/* PostgREST upserts on the primary key, which for every *_tr table is
   (entity_id, lang) — exactly the grain a translation lives at. */
const upsert = (table, rows) =>
  rows.length && !DRY
    ? pg(`/${table}`, { method: 'POST', prefer: 'resolution=merge-duplicates', body: rows })
    : Promise.resolve();

const T = JSON.parse(readFileSync(join(ROOT, 'scripts/translations.json'), 'utf8'));
const P = JSON.parse(readFileSync(join(ROOT, 'scripts/people-translations.json'), 'utf8'));

async function main() {
  console.log(`${DRY ? 'DRY RUN against' : 'Writing to'} ${URL_BASE}\n`);

  /* ---- people: merge the duplicate first ------------------------------- */
  /* Two rows for one man would otherwise both receive the same Hebrew name
     and he would appear twice in the Cleveland roster, in Hebrew, as himself. */
  const byName = new Map();          // en display_name -> [person_id, ...]
  for (const r of await pg('/tmz_person_tr?lang=eq.en&select=person_id,display_name&limit=1000')) {
    if (!byName.has(r.display_name)) byName.set(r.display_name, []);
    byName.get(r.display_name).push(r.person_id);
  }

  for (const d of P.duplicates || []) {
    const keep = byName.get(d.keep)?.[0];
    const drop = byName.get(d.drop)?.[0];
    if (!keep || !drop || keep === drop) { console.log(`merge: ${d.drop} — nothing to do`); continue; }
    const moved = await pg(`/tmz_tenure?person_id=eq.${drop}&select=id`);
    if (!DRY) {
      await pg(`/tmz_tenure?person_id=eq.${drop}`, { method: 'PATCH', body: { person_id: keep } });
      await pg(`/tmz_person?id=eq.${drop}`, { method: 'DELETE' });
    }
    byName.delete(d.drop);
    console.log(`merge: "${d.drop}" -> "${d.keep}"  (${moved.length} tenure(s) moved)`);
  }

  /* ---- people: Hebrew, and Russian for Moscow -------------------------- */
  const rows = [], missing = [], ambiguous = [];
  const add = (name, lang, value) => {
    const ids = byName.get(name);
    if (!ids) { missing.push(`${lang}: ${name}`); return; }
    if (ids.length > 1) ambiguous.push(`${lang}: ${name} (${ids.length} rows)`);
    for (const id of ids) rows.push({ person_id: id, lang, display_name: value });
  };
  /* The merged-away spelling is still a key in people{} — it has to be, so the
     duplicate carries a Hebrew name if the merge has already run once. Skip it
     now that the row is gone. */
  const dropped = new Set((P.duplicates || []).map(d => d.drop));
  for (const [name, he] of Object.entries(P.people)) {
    if (dropped.has(name) && !byName.has(name)) continue;
    add(name, 'he', he);
  }
  for (const [name, ru] of Object.entries(P.russian)) {
    if (name.startsWith('_')) continue;
    add(name, 'ru', ru);
  }

  /* A name in the file that matches nothing in the database means the two have
     drifted apart, and a silent skip is how a roster ends up half-Hebrew. */
  if (missing.length) {
    console.error(`\n${missing.length} name(s) in the file match no person in the database:`);
    for (const m of missing) console.error('  ' + m);
    console.error('\nFix the spelling or re-run import-real.mjs first. Nothing was written.');
    process.exit(1);
  }
  if (ambiguous.length) console.log(`note: ${ambiguous.length} name(s) map to more than one person row:\n  ${ambiguous.join('\n  ')}`);

  await upsert('tmz_person_tr', rows);
  const he = rows.filter(r => r.lang === 'he').length;
  console.log(`people: ${he} Hebrew, ${rows.length - he} Russian`);

  /* ---- communities ----------------------------------------------------- */
  /* name is NOT NULL, so a row that only adds a country has to carry the name
     it already holds. Read first, merge, then write whole rows. */
  const comms = await pg('/tmz_community?select=id,slug&limit=200');
  const cid = Object.fromEntries(comms.map(c => [c.slug, c.id]));
  const existing = new Map();
  for (const r of await pg('/tmz_community_tr?select=community_id,lang,name,country,blurb&limit=1000'))
    existing.set(`${r.community_id}|${r.lang}`, r);

  const cRows = [];
  for (const [slug, langs] of Object.entries(T.communities)) {
    const id = cid[slug];
    if (!id) { console.error(`  ! unknown community ${slug}`); continue; }
    for (const [lang, v] of Object.entries(langs)) {
      const prev = existing.get(`${id}|${lang}`);
      const name = v.name ?? prev?.name;
      if (!name) { console.error(`  ! ${slug}/${lang}: no name here and none in the database`); continue; }
      cRows.push({ community_id: id, lang, name, country: v.country ?? prev?.country ?? null,
                   blurb: prev?.blurb ?? null });
    }
  }
  await upsert('tmz_community_tr', cRows);
  console.log(`communities: ${cRows.length} rows`);

  /* ---- event types ----------------------------------------------------- */
  const eRows = [];
  for (const [id, langs] of Object.entries(T.event_types))
    for (const [lang, name] of Object.entries(langs)) eRows.push({ event_type_id: id, lang, name });
  await upsert('tmz_event_type_tr', eRows);
  console.log(`event types: ${eRows.length} rows`);

  /* ---- institutions ---------------------------------------------------- */
  const insts = await pg('/tmz_institution?select=id,slug&limit=200');
  const iid = Object.fromEntries(insts.map(i => [i.slug, i.id]));
  const iRows = [];
  for (const [slug, langs] of Object.entries(T.institutions)) {
    if (!iid[slug]) { console.error(`  ! unknown institution ${slug}`); continue; }
    for (const [lang, name] of Object.entries(langs)) iRows.push({ institution_id: iid[slug], lang, name });
  }
  await upsert('tmz_institution_tr', iRows);
  console.log(`institutions: ${iRows.length} rows`);

  if (P.uncertain?.length)
    console.log(`\n${P.uncertain.length} name(s) written but flagged for a human to confirm — see 'uncertain' in scripts/people-translations.json.`);
  if (DRY) console.log('\nDry run — nothing was written.');
}

main().catch(e => { console.error(e); process.exit(1); });
