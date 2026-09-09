/* Points the browser-side code at a different Supabase project.
 *
 *   node scripts/repoint.mjs <project-ref> <anon key>
 *
 * Three files carry the project's identity, and both values in them are public
 * by design — the site is a static page and has to reach the database from the
 * browser. RLS is what enforces access, not secrecy of the anon key. The
 * service-role key is the one that must never appear here, so this refuses to
 * write anything that is not an anon token. */

import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['docs/api.js', 'docs/admin/config.js', 'docs/sim/index.html'];

const [ref, anon] = process.argv.slice(2);
if (!ref || !anon) {
  console.error('usage: node scripts/repoint.mjs <project-ref> <anon key>');
  process.exit(1);
}
if (!/^[a-z]{20}$/.test(ref)) {
  console.error(`"${ref}" does not look like a project ref (20 lowercase letters).`);
  process.exit(1);
}

/* A JWT's middle segment is its claims. Reading the role out of it is the only
   way to be sure somebody has not pasted the service-role key into a file that
   is about to be committed to a public repository. */
let role;
try {
  role = JSON.parse(Buffer.from(anon.split('.')[1], 'base64url').toString()).role;
} catch {
  console.error('That anon key is not a readable JWT.');
  process.exit(1);
}
if (role !== 'anon') {
  console.error(`REFUSING: that key carries role "${role}", not "anon".`);
  console.error('The service-role key bypasses every RLS policy and must never be committed.');
  process.exit(1);
}

/* Whatever project the files currently point at, discovered rather than
   assumed, so this keeps working after the first migration. */
const current = readFileSync('docs/api.js', 'utf8');
const oldRef = current.match(/https:\/\/([a-z]{20})\.supabase\.co/)?.[1];
const oldKey = current.match(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_.-]+/)?.[0];
if (!oldRef) { console.error('Could not find a project ref in docs/api.js.'); process.exit(1); }

if (oldRef === ref) { console.log(`Already pointed at ${ref}.`); process.exit(0); }

let changed = 0;
for (const f of FILES) {
  const before = readFileSync(f, 'utf8');
  let after = before.split(oldRef).join(ref);
  if (oldKey) after = after.split(oldKey).join(anon);
  if (after !== before) { writeFileSync(f, after); changed++; }
  console.log(`${after === before ? '  unchanged' : '  rewritten'}  ${f}`);
}
console.log(`\n${oldRef} → ${ref}  (${changed} file(s))`);
console.log('Commit and push, then Pages serves the new project within a minute or two.');
