/* Ports docs/data.js COMMUNITIES into the tmz_ schema. This is the mockup's
   49-community STRESS-TEST set, not Torah MiTzion's real list — replace the
   source array (or point this script elsewhere) once the client's list
   arrives; nothing else about the schema or the front end needs to change.

   Talks to PostgREST directly (no @supabase/supabase-js dependency) using the
   service-role key, which bypasses RLS — this must only ever run from a
   trusted machine, never in the browser.

   Usage:
     node scripts/seed-communities.mjs
   Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.supabase in the
   repo root (gitignored) unless they are already set in the environment. */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvFile(join(ROOT, '.env.supabase'));

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_BASE || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked .env.supabase and the environment).');
  process.exit(1);
}
const REST = `${URL_BASE.replace(/\/$/, '')}/rest/v1`;
const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json'
};

async function pg(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${REST}${path}`, {
    method,
    headers: { ...HEADERS, ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  // PostgREST returns 201 with an EMPTY body (not 204) for a plain insert
  // that didn't ask for Prefer: return=representation — .json() on that
  // throws, so check the actual text first rather than trusting the status.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Extract the COMMUNITIES array literal from docs/data.js without executing
// the rest of that file (which expects a browser environment).
const src = readFileSync(join(ROOT, 'docs/data.js'), 'utf8');
const match = src.match(/const COMMUNITIES = (\[[\s\S]*?\n\];)/);
if (!match) throw new Error('Could not find COMMUNITIES in docs/data.js');
const COMMUNITIES = new Function(`return ${match[1]}`)();

console.log(`Seeding ${COMMUNITIES.length} communities into ${URL_BASE}...`);

let ok = 0, failed = 0;
for (const c of COMMUNITIES) {
  try {
    // on_conflict=slug: the PK is a fresh uuid every call, so without naming
    // the unique column a re-run would insert-and-409 instead of upserting.
    const [row] = await pg('/tmz_community?on_conflict=slug', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: {
        slug: c.id, region_id: c.rg, lat: c.lat, lon: c.lon,
        founded_year: c.f, closed_year: c.c || null
      }
    });

    const trRows = Object.entries(c.name).map(([lang, name]) => ({
      community_id: row.id, lang, name
    }));
    await pg('/tmz_community_tr', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: trRows
    });

    console.log('  ok  ', c.id.padEnd(16), Object.keys(c.name).join('/'));
    ok++;
  } catch (e) {
    console.error('  FAIL', c.id, '-', e.message);
    failed++;
  }
}

console.log(`\nDone: ${ok} ok, ${failed} failed, ${COMMUNITIES.length} total.`);
if (failed > 0) process.exit(1);
