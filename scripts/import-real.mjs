/* Replaces the invented 49-community stress-test set with Torah MiTzion's real
   communities, Roshei Kollel and current shlichim, taken from the
   organisation's own community pages (see scripts/real-data.json for the
   source note and every place the site was ambiguous).

   Idempotent: re-running upserts rather than duplicating. Run with
     node scripts/import-real.mjs           # add/update only
     node scripts/import-real.mjs --prune   # also delete communities not listed */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRUNE = process.argv.includes('--prune');

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

const data = JSON.parse(readFileSync(join(ROOT, 'scripts/real-data.json'), 'utf8'));

/* A person is global — the same Rosh Kollel turns up at two communities, and
   Rabbi Itiel Oron genuinely does (Manhattan 2005-07, Washington 2018-19).
   Slugs are derived from the English name so a repeat resolves to one row. */
const slugify = s => s.toLowerCase()
  .replace(/z["']l/g, '').replace(/\brabbi\b|\brav\b|\bthe\b/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const personCache = new Map();
async function person(nameEn, nameHe) {
  const slug = slugify(nameEn);
  if (personCache.has(slug)) return personCache.get(slug);
  const [row] = await pg('/tmz_person?on_conflict=slug', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: [{ slug }]
  });
  const tr = [{ person_id: row.id, lang: 'en', display_name: nameEn }];
  if (nameHe) tr.push({ person_id: row.id, lang: 'he', display_name: nameHe });
  await pg('/tmz_person_tr', { method: 'POST', prefer: 'resolution=merge-duplicates', body: tr });
  personCache.set(slug, row.id);
  return row.id;
}

async function main() {
  console.log(`Importing into ${URL_BASE}\n`);

  // ---- institutions ----
  const instId = {};
  for (const i of data.institutions) {
    const [row] = await pg('/tmz_institution?on_conflict=slug', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: [{ slug: i.slug }]
    });
    instId[i.slug] = row.id;
    await pg('/tmz_institution_tr', {
      method: 'POST', prefer: 'resolution=merge-duplicates',
      body: [{ institution_id: row.id, lang: 'en', name: i.en },
             { institution_id: row.id, lang: 'he', name: i.he }]
    });
  }
  console.log(`institutions: ${Object.keys(instId).length}`);

  // ---- communities ----
  const commId = {};
  for (const c of data.communities) {
    const [row] = await pg('/tmz_community?on_conflict=slug', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: [{ slug: c.slug, region_id: c.rg, lat: c.lat, lon: c.lon,
               founded_year: c.f, closed_year: c.c || null }]
    });
    commId[c.slug] = row.id;
    const tr = Object.entries(c.name).map(([lang, name]) => ({
      community_id: row.id, lang, name,
      country: (c.country || {})[lang] || null,
      blurb: lang === 'en' ? (c.note || null) : null
    }));
    await pg('/tmz_community_tr', { method: 'POST', prefer: 'resolution=merge-duplicates', body: tr });
    console.log(`  community ${c.slug.padEnd(14)} ${c.f}  ${Object.keys(c.name).join('/')}`);
  }

  // ---- tenures ----
  /* Wipe and rewrite rather than upsert: tenure has no natural key, so a
     second run would otherwise duplicate every row. Photographs are untouched. */
  await pg('/tmz_tenure?id=not.is.null', { method: 'DELETE' });

  let n = 0, spouses = 0;
  for (const t of data.tenures) {
    const cid = commId[t.c];
    if (!cid) { console.error(`  ! unknown community ${t.c}`); continue; }
    const pid = await person(t.en, t.he);
    const [row] = await pg('/tmz_tenure', {
      method: 'POST', prefer: 'return=representation',
      body: [{ person_id: pid, community_id: cid, role: t.role,
               start_year: t.from, end_year: t.to,
               institution_id: t.inst ? instId[t.inst] : null }]
    });
    n++;

    /* The site names Roshei Kollel as couples, and the rebbetzin is a shlicha
       in her own right — so she gets her own person and a tenure attached to
       his through household_of, not a footnote on his name. */
    if (t.spouse) {
      const sid = await person(t.spouse);
      await pg('/tmz_tenure', {
        method: 'POST',
        body: [{ person_id: sid, community_id: cid, role: 'spouse',
                 start_year: t.from, end_year: t.to, household_of: row.id }]
      });
      spouses++;
    }
  }
  console.log(`\ntenures: ${n} (+${spouses} spouses)  people: ${personCache.size}`);

  if (PRUNE) {
    const keep = data.communities.map(c => `"${c.slug}"`).join(',');
    const gone = await pg(`/tmz_community?slug=not.in.(${keep})&select=slug`);
    if (gone.length) {
      await pg(`/tmz_community?slug=not.in.(${keep})`, { method: 'DELETE' });
      console.log(`pruned ${gone.length} invented communities: ${gone.map(g => g.slug).join(', ')}`);
    } else {
      console.log('nothing to prune');
    }
  } else {
    console.log('\n(run with --prune to remove the invented communities)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
