/* Concatenates supabase/migrations/ into supabase/schema.sql, for pasting into
   the Supabase SQL editor when the CLI is not to hand.

   The migrations remain the source of truth. This file is generated and should
   never be edited — regenerate it instead:  node scripts/build-schema.mjs */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();

const rule = '-- ' + '═'.repeat(67);
const head = `-- Torah MiTzion archive — the whole schema, in one file.
--
-- GENERATED. The source of truth is ${DIR}/, and this is those files
-- concatenated in order for pasting into the Supabase SQL editor.
-- Regenerate with:  node scripts/build-schema.mjs
--
-- PREFER \`supabase db push --linked\`. It runs the same statements AND records
-- them in supabase_migrations.schema_migrations, so the next migration applies
-- cleanly. Paste this instead and that history stays empty, so a later push
-- will try to re-run everything from the beginning and fail on the first
-- \`create table\`. If you do paste it, tell whoever runs the next migration.
--
-- ${files.length} migrations.
`;

writeFileSync('supabase/schema.sql',
  head + files.map(f =>
    `\n${rule}\n-- ${f}\n${rule}\n` + readFileSync(join(DIR, f), 'utf8').trimEnd() + '\n'
  ).join(''));

console.log(`supabase/schema.sql written from ${files.length} migrations.`);
