# Backend and Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mockup's client-side generated data with a real Supabase schema, row-level security, storage, and a read API the existing front end can consume.

**Architecture:** Postgres on Supabase. Every user-facing string lives in a `*_tr` translation table keyed by `(entity_id, lang)`, resolved through a per-entity SQL function implementing a requested-locale → English → any fallback chain. People are global entities; a `tenure` row binds a person to a community for a span of years with a role, and a Rosh Kollel's household hangs off his tenure via `household_of`. Photographs carry their community-year, event, venue and tagged people, plus a moderation verdict.

**Tech Stack:** Supabase CLI, Postgres 15, pgTAP for schema tests, Supabase Storage, Supabase Auth (Google OAuth).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/config.toml` | Local dev configuration |
| `supabase/migrations/0001_enums.sql` | Shared enum types |
| `supabase/migrations/0002_geography.sql` | `region`, `community` + translations |
| `supabase/migrations/0003_i18n.sql` | Translation fallback resolvers |
| `supabase/migrations/0004_people.sql` | `person`, `institution`, `tenure` |
| `supabase/migrations/0005_photos.sql` | `event_type`, `photo`, `photo_person` |
| `supabase/migrations/0006_moderation.sql` | `moderation`, `app_user` |
| `supabase/migrations/0007_rls.sql` | Row-level security policies |
| `supabase/migrations/0008_api.sql` | Read views and RPCs for the front end |
| `supabase/tests/*.sql` | pgTAP tests, one file per migration |
| `supabase/seed.sql` | Reference data (regions, event types, languages) |
| `scripts/seed-communities.mjs` | Ports `docs/data.js` into real rows |

**Why translation tables and not `jsonb`:** a six-language back office has to answer
"what is still untranslated in Russian?" That is a trivial `LEFT JOIN` against a
translation table and an awkward `jsonb` scan otherwise. It also lets a future
translator role hold write access to one language without touching the parent row.

---

### Task 1: Supabase project and local loop

**Files:**
- Create: `supabase/config.toml` (generated)
- Modify: `.gitignore`

- [ ] **Step 1: Install the CLI and initialise**

```bash
npm install -g supabase
cd /c/Users/rettig_h/TMZ_site
supabase init
```

- [ ] **Step 2: Start the local stack**

```bash
supabase start
```

Expected: prints `API URL`, `DB URL`, `Studio URL`, `anon key`, `service_role key`.
If Docker is not running this fails — start Docker Desktop first.

- [ ] **Step 3: Keep local secrets out of git**

Append to `.gitignore`:

```
supabase/.branches
supabase/.temp
.env.local
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore supabase/config.toml
git commit -m "chore: initialise Supabase local development"
```

---

### Task 2: Enum types

**Files:**
- Create: `supabase/migrations/0001_enums.sql`
- Test: `supabase/tests/0001_enums.test.sql`

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(5);

select has_type('lang_code');
select has_type('tenure_role');
select has_type('photo_status');
select has_type('photo_source');
select has_type('connection_kind');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `type "lang_code" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- The six languages the archive ships in. Adding a seventh is one ALTER TYPE.
create type lang_code as enum ('en', 'he', 'ru', 'fr', 'de', 'es');

-- What a person was doing at a community. 'spouse' and 'child' exist so a Rosh
-- Kollel's household is modelled as tenures too, not as a special-case blob.
create type tenure_role as enum
  ('rosh_kollel', 'shaliach', 'shlicha', 'spouse', 'child', 'staff');

create type photo_status as enum ('pending', 'approved', 'rejected', 'needs_info');
create type photo_source as enum ('web', 'whatsapp', 'import', 'admin');

-- Asked once, at first sign-in: how do you know Torah MiTzion?
create type connection_kind as enum
  ('shaliach', 'rosh_kollel', 'community_member', 'family', 'alumnus', 'staff', 'other');
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..5`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_enums.sql supabase/tests/0001_enums.test.sql
git commit -m "feat(db): add shared enum types"
```

---

### Task 3: Regions and communities

**Files:**
- Create: `supabase/migrations/0002_geography.sql`
- Test: `supabase/tests/0002_geography.test.sql`

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(7);

select has_table('region');
select has_table('community');
select has_table('community_tr');

-- a community must sit at a real coordinate
select throws_ok(
  $$ insert into community (slug, region_id, lat, lon, founded_year)
     values ('bad', 'na', 999, 0, 2001) $$,
  '23514', null, 'latitude outside -90..90 is rejected'
);

-- a community cannot close before it opened
select throws_ok(
  $$ insert into community (slug, region_id, lat, lon, founded_year, closed_year)
     values ('bad2', 'na', 40, -75, 2010, 2005) $$,
  '23514', null, 'closed_year before founded_year is rejected'
);

insert into region (id, sort) values ('zz', 99);
insert into community (slug, region_id, lat, lon, founded_year)
  values ('testville', 'zz', 40.7, -74.0, 2001);
select is(
  (select is_open from community where slug = 'testville'),
  true,
  'a community with no closed_year is open'
);

update community set closed_year = 2015 where slug = 'testville';
select is(
  (select is_open from community where slug = 'testville'),
  false,
  'setting closed_year closes it'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `relation "region" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
create table region (
  id   text primary key,
  sort integer not null default 0
);

create table region_tr (
  region_id text not null references region(id) on delete cascade,
  lang      lang_code not null,
  name      text not null,
  primary key (region_id, lang)
);

create table community (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  region_id    text not null references region(id),
  lat          double precision not null check (lat between -90 and 90),
  lon          double precision not null check (lon between -180 and 180),
  founded_year integer not null check (founded_year between 1900 and 2200),
  closed_year  integer check (closed_year between 1900 and 2200),
  -- derived, so no code can leave status and closed_year disagreeing
  is_open      boolean generated always as (closed_year is null) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint closed_after_founded
    check (closed_year is null or closed_year >= founded_year)
);

create index community_region_idx on community (region_id);

create table community_tr (
  community_id uuid not null references community(id) on delete cascade,
  lang         lang_code not null,
  name         text not null,
  country      text,
  blurb        text,
  primary key (community_id, lang)
);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..7`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0002_geography.sql supabase/tests/0002_geography.test.sql
git commit -m "feat(db): add regions and communities"
```

---

### Task 4: The translation fallback chain

**Files:**
- Create: `supabase/migrations/0003_i18n.sql`
- Test: `supabase/tests/0003_i18n.test.sql`

This is the piece the whole six-language decision rests on. With 49 communities and
six locales most translations will be missing most of the time; the site must
degrade to English rather than render blank.

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(4);

insert into region (id) values ('zz');
insert into community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001);

insert into community_tr (community_id, lang, name) values
  ('11111111-1111-1111-1111-111111111111', 'en', 'Memphis'),
  ('11111111-1111-1111-1111-111111111111', 'he', 'ממפיס');

select is(community_name('11111111-1111-1111-1111-111111111111', 'he'),
          'ממפיס', 'returns the requested language when present');

select is(community_name('11111111-1111-1111-1111-111111111111', 'fr'),
          'Memphis', 'falls back to English when the locale is missing');

delete from community_tr
  where community_id = '11111111-1111-1111-1111-111111111111' and lang = 'en';

select is(community_name('11111111-1111-1111-1111-111111111111', 'fr'),
          'ממפיס', 'falls back to any available translation when English is gone');

select is(community_name('22222222-2222-2222-2222-222222222222', 'en'),
          null, 'returns null for an unknown community rather than erroring');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `function community_name(uuid, lang_code) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- Requested locale, then English, then whatever exists. Ordering does the work,
-- so a missing translation degrades instead of blanking the page.
create or replace function community_name(cid uuid, want lang_code)
returns text language sql stable as $$
  select name from community_tr
  where community_id = cid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

create or replace function region_name(rid text, want lang_code)
returns text language sql stable as $$
  select name from region_tr
  where region_id = rid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

-- What is still untranslated, for the back office coverage view.
create or replace view translation_gaps as
  select 'community' as entity, c.id::text as entity_id, c.slug as ref, l.lang
  from community c
  cross join (select unnest(enum_range(null::lang_code)) as lang) l
  where not exists (
    select 1 from community_tr t where t.community_id = c.id and t.lang = l.lang
  );
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..4`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_i18n.sql supabase/tests/0003_i18n.test.sql
git commit -m "feat(db): add translation fallback resolvers and a coverage view"
```

---

### Task 5: People, institutions and tenures

**Files:**
- Create: `supabase/migrations/0004_people.sql`
- Test: `supabase/tests/0004_people.test.sql`

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(5);

select has_table('person');
select has_table('tenure');

insert into region (id) values ('zz');
insert into community (id, slug, region_id, lat, lon, founded_year) values
  ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001),
  ('33333333-3333-3333-3333-333333333333', 'chicago', 'zz', 41.88, -87.63, 1999);

insert into person (id, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'yonatan-l');

-- the same person, two communities, two roles, years apart
insert into tenure (person_id, community_id, role, start_year, end_year) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'shaliach', 1998, 1999),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'rosh_kollel', 2001, 2009);

select is(
  (select count(*)::int from tenure
   where person_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2,
  'one person holds tenures at more than one community'
);

select throws_ok(
  $$ insert into tenure (person_id, community_id, role, start_year, end_year)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111', 'shaliach', 2010, 2005) $$,
  '23514', null, 'a tenure cannot end before it starts'
);

-- who served at Memphis in 2007?
select is(
  (select count(*)::int from tenure
   where community_id = '11111111-1111-1111-1111-111111111111'
     and 2007 between start_year and coalesce(end_year, 2200)),
  1,
  'a year query finds the tenure spanning it'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `relation "person" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
create table person (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique,
  birth_year integer check (birth_year between 1900 and 2200),
  created_at timestamptz not null default now()
);

create table person_tr (
  person_id    uuid not null references person(id) on delete cascade,
  lang         lang_code not null,
  display_name text not null,
  primary key (person_id, lang)
);

create table institution (
  id   uuid primary key default gen_random_uuid(),
  slug text unique not null
);

create table institution_tr (
  institution_id uuid not null references institution(id) on delete cascade,
  lang           lang_code not null,
  name           text not null,
  primary key (institution_id, lang)
);

-- A person's engagement with one community over a span of years. The household
-- of a Rosh Kollel is stored as tenures too, pointed at his own tenure through
-- household_of, so a family is queried the same way as a cohort.
create table tenure (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references person(id) on delete cascade,
  community_id   uuid not null references community(id) on delete cascade,
  role           tenure_role not null,
  start_year     integer not null check (start_year between 1900 and 2200),
  end_year       integer check (end_year between 1900 and 2200),
  institution_id uuid references institution(id),
  household_of   uuid references tenure(id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint tenure_ends_after_start
    check (end_year is null or end_year >= start_year)
);

create index tenure_community_years_idx on tenure (community_id, start_year, end_year);
create index tenure_person_idx on tenure (person_id);
create index tenure_household_idx on tenure (household_of) where household_of is not null;

create or replace function person_name(pid uuid, want lang_code)
returns text language sql stable as $$
  select display_name from person_tr
  where person_id = pid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..5`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_people.sql supabase/tests/0004_people.test.sql
git commit -m "feat(db): add people, institutions and tenures"
```

---

### Task 6: Events and photographs

**Files:**
- Create: `supabase/migrations/0005_photos.sql`
- Test: `supabase/tests/0005_photos.test.sql`

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(4);

select has_table('photo');
select has_table('photo_person');

insert into region (id) values ('zz');
insert into community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001);

insert into photo (id, community_id, year, storage_path)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '11111111-1111-1111-1111-111111111111', 2007, 'photos/x.jpg');

select is(
  (select status from photo where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'pending'::photo_status,
  'a new photograph is pending, never published by default'
);

select throws_ok(
  $$ insert into photo (community_id, year, storage_path)
     values ('11111111-1111-1111-1111-111111111111', 1850, 'photos/y.jpg') $$,
  '23514', null, 'a year outside the archive window is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `relation "photo" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
create table event_type (
  id   text primary key,
  sort integer not null default 0
);

create table event_type_tr (
  event_type_id text not null references event_type(id) on delete cascade,
  lang          lang_code not null,
  name          text not null,
  primary key (event_type_id, lang)
);

create table photo (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid references community(id) on delete set null,
  year          integer check (year between 1990 and 2200),
  taken_on      date,
  event_type_id text references event_type(id),
  venue         text,
  storage_path  text not null,
  width         integer,
  height        integer,
  bytes         bigint,
  -- perceptual hash; the same photograph arriving twice by two routes is common
  phash         text,
  status        photo_status not null default 'pending',
  source        photo_source not null default 'web',
  submitted_by  uuid references auth.users(id) on delete set null,
  submitter_ref text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create index photo_community_year_idx on photo (community_id, year)
  where status = 'approved';
create index photo_status_idx on photo (status, created_at desc);
create index photo_phash_idx on photo (phash) where phash is not null;

create table photo_tr (
  photo_id uuid not null references photo(id) on delete cascade,
  lang     lang_code not null,
  caption  text,
  primary key (photo_id, lang)
);

create table photo_person (
  photo_id   uuid not null references photo(id) on delete cascade,
  person_id  uuid not null references person(id) on delete cascade,
  confidence real check (confidence between 0 and 1),
  added_by   uuid references auth.users(id) on delete set null,
  primary key (photo_id, person_id)
);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..4`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_photos.sql supabase/tests/0005_photos.test.sql
git commit -m "feat(db): add event types, photographs and people tagging"
```

---

### Task 7: Moderation and application users

**Files:**
- Create: `supabase/migrations/0006_moderation.sql`
- Test: `supabase/tests/0006_moderation.test.sql`

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(3);

select has_table('moderation');
select has_table('app_user');
select col_type_is('app_user', 'connection_kind', 'connection_kind',
                   'first sign-in records how the user knows Torah MiTzion');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `relation "moderation" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- One row per screening pass. Kept as history, not overwritten, so a rejection
-- can be explained months later.
create table moderation (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references photo(id) on delete cascade,
  model       text not null,
  verdict     photo_status not null,
  scores      jsonb not null default '{}'::jsonb,
  reasons     text[],
  reviewed_by uuid references auth.users(id) on delete set null,
  decided_at  timestamptz not null default now()
);

create index moderation_photo_idx on moderation (photo_id, decided_at desc);

create table app_user (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  connection_kind   connection_kind,
  connection_detail text,
  home_community_id uuid references community(id) on delete set null,
  role              text not null default 'contributor'
                    check (role in ('contributor', 'translator', 'editor', 'admin')),
  created_at        timestamptz not null default now()
);

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_user
    where id = auth.uid() and role in ('editor', 'admin')
  );
$$;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..3`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_moderation.sql supabase/tests/0006_moderation.test.sql
git commit -m "feat(db): add moderation history and application users"
```

---

### Task 8: Row-level security

**Files:**
- Create: `supabase/migrations/0007_rls.sql`
- Test: `supabase/tests/0007_rls.test.sql`

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(3);

insert into region (id) values ('zz');
insert into community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001);
insert into photo (community_id, year, storage_path, status)
  values ('11111111-1111-1111-1111-111111111111', 2007, 'a.jpg', 'approved');
insert into photo (community_id, year, storage_path, status)
  values ('11111111-1111-1111-1111-111111111111', 2007, 'b.jpg', 'pending');

set local role anon;

select is((select count(*)::int from photo), 1,
          'anonymous readers see approved photographs only');

select is((select count(*)::int from community), 1,
          'anonymous readers see communities');

select throws_ok(
  $$ update photo set status = 'approved' $$,
  '42501', null, 'anonymous readers cannot approve a photograph'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — anon sees 2 photographs because RLS is not enabled.

- [ ] **Step 3: Write the migration**

```sql
-- Reference and published content is world-readable; nothing else is.
alter table region          enable row level security;
alter table region_tr       enable row level security;
alter table community       enable row level security;
alter table community_tr    enable row level security;
alter table person          enable row level security;
alter table person_tr       enable row level security;
alter table institution     enable row level security;
alter table institution_tr  enable row level security;
alter table tenure          enable row level security;
alter table event_type      enable row level security;
alter table event_type_tr   enable row level security;
alter table photo           enable row level security;
alter table photo_tr        enable row level security;
alter table photo_person    enable row level security;
alter table moderation      enable row level security;
alter table app_user        enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'region','region_tr','community','community_tr','person','person_tr',
    'institution','institution_tr','tenure','event_type','event_type_tr'
  ] loop
    execute format(
      'create policy %I_public_read on %I for select using (true)', tbl, tbl);
    execute format(
      'create policy %I_staff_write on %I for all to authenticated
       using (is_staff()) with check (is_staff())', tbl, tbl);
  end loop;
end $$;

-- A photograph is public only once approved.
create policy photo_public_read on photo
  for select using (status = 'approved' or is_staff());

-- Anyone signed in may submit, but never straight into the archive.
create policy photo_submit on photo
  for insert to authenticated
  with check (status = 'pending' and submitted_by = auth.uid());

create policy photo_staff_write on photo
  for all to authenticated using (is_staff()) with check (is_staff());

create policy photo_tr_read on photo_tr for select using (
  exists (select 1 from photo p
          where p.id = photo_id and (p.status = 'approved' or is_staff())));
create policy photo_tr_staff on photo_tr
  for all to authenticated using (is_staff()) with check (is_staff());

create policy photo_person_read on photo_person for select using (
  exists (select 1 from photo p
          where p.id = photo_id and (p.status = 'approved' or is_staff())));
create policy photo_person_staff on photo_person
  for all to authenticated using (is_staff()) with check (is_staff());

-- Moderation history is staff-only.
create policy moderation_staff on moderation
  for all to authenticated using (is_staff()) with check (is_staff());

-- A user reads and edits their own profile; staff read all.
create policy app_user_self on app_user
  for select to authenticated using (id = auth.uid() or is_staff());
create policy app_user_self_write on app_user
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy app_user_insert_self on app_user
  for insert to authenticated with check (id = auth.uid());
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..3`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_rls.sql supabase/tests/0007_rls.test.sql
git commit -m "feat(db): enable row-level security"
```

---

### Task 9: Storage buckets

**Files:**
- Create: `supabase/migrations/0009_storage.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Originals stay private: an unapproved submission must not be guessable by URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-originals', 'photo-originals', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- Derivatives are generated only after approval, so this bucket is safe to serve.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-public', 'photo-public', true, 10485760,
        array['image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "submit to originals" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photo-originals');

create policy "staff read originals" on storage.objects
  for select to authenticated
  using (bucket_id = 'photo-originals' and is_staff());

create policy "world reads derivatives" on storage.objects
  for select using (bucket_id = 'photo-public');
```

- [ ] **Step 2: Verify the buckets exist**

```bash
supabase db reset
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
  -c "select id, public from storage.buckets order by id;"
```

Expected: two rows — `photo-originals | f` and `photo-public | t`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0009_storage.sql
git commit -m "feat(db): add photograph storage buckets and policies"
```

---

### Task 10: Reference seed data

**Files:**
- Create: `supabase/seed.sql`

- [ ] **Step 1: Write the seed**

```sql
insert into region (id, sort) values
  ('na', 1), ('la', 2), ('eu', 3), ('oc', 4)
on conflict (id) do nothing;

insert into region_tr (region_id, lang, name) values
  ('na','en','North America'),    ('na','he','צפון אמריקה'),
  ('na','ru','Северная Америка'), ('na','fr','Amérique du Nord'),
  ('na','de','Nordamerika'),      ('na','es','América del Norte'),
  ('la','en','Latin America'),    ('la','he','אמריקה הלטינית'),
  ('la','ru','Латинская Америка'),('la','fr','Amérique latine'),
  ('la','de','Lateinamerika'),    ('la','es','América Latina'),
  ('eu','en','Europe & Asia'),    ('eu','he','אירופה ואסיה'),
  ('eu','ru','Европа и Азия'),    ('eu','fr','Europe et Asie'),
  ('eu','de','Europa & Asien'),   ('eu','es','Europa y Asia'),
  ('oc','en','Africa & Oceania'), ('oc','he','אפריקה ואוקיאניה'),
  ('oc','ru','Африка и Океания'), ('oc','fr','Afrique et Océanie'),
  ('oc','de','Afrika & Ozeanien'),('oc','es','África y Oceanía')
on conflict do nothing;

insert into event_type (id, sort) values
  ('simchat_torah', 1), ('shabbaton', 2), ('morning_seder', 3),
  ('yom_haatzmaut', 4), ('chanukah', 5), ('purim', 6),
  ('opening_night', 7), ('melave_malka', 8), ('shavuot', 9),
  ('farewell', 10), ('chavruta', 11), ('youth', 12)
on conflict (id) do nothing;

insert into event_type_tr (event_type_id, lang, name) values
  ('simchat_torah','en','Simchat Torah hakafot'), ('simchat_torah','he','הקפות שמחת תורה'),
  ('shabbaton','en','Community shabbaton'),       ('shabbaton','he','שבתון קהילתי'),
  ('morning_seder','en','Morning seder'),         ('morning_seder','he','סדר בוקר'),
  ('yom_haatzmaut','en','Yom Ha''atzmaut'),       ('yom_haatzmaut','he','יום העצמאות'),
  ('chanukah','en','Chanukah night'),             ('chanukah','he','ליל חנוכה'),
  ('purim','en','Purim seudah'),                  ('purim','he','סעודת פורים'),
  ('opening_night','en','Opening night'),         ('opening_night','he','ערב פתיחה'),
  ('melave_malka','en','Melave Malka'),           ('melave_malka','he','מלווה מלכה'),
  ('shavuot','en','Shavuot night learning'),      ('shavuot','he','ליל שבועות'),
  ('farewell','en','Farewell dinner'),            ('farewell','he','ארוחת פרידה'),
  ('chavruta','en','Chavruta learning'),          ('chavruta','he','לימוד בחברותא'),
  ('youth','en','Youth shabbaton'),               ('youth','he','שבתון נוער')
on conflict do nothing;
```

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
```

Expected: reset completes and the seed runs without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): seed regions and event types in six languages"
```

---

### Task 11: The read API the front end consumes

**Files:**
- Create: `supabase/migrations/0010_api.sql`
- Test: `supabase/tests/0010_api.test.sql`

Replaces what `docs/data.js` generates. The front end asks for one payload per
view, already resolved into the requested language.

- [ ] **Step 1: Write the failing test**

```sql
begin;
select plan(2);

insert into region (id) values ('na');
insert into region_tr (region_id, lang, name) values ('na','en','North America');
insert into community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111','memphis','na',35.15,-90.05,2001);
insert into community_tr (community_id, lang, name)
  values ('11111111-1111-1111-1111-111111111111','en','Memphis');
insert into photo (community_id, year, storage_path, status)
  values ('11111111-1111-1111-1111-111111111111', 2007, 'a.jpg', 'approved');

select is(
  (select (map_payload('en') -> 'communities' -> 0 ->> 'name')),
  'Memphis',
  'the map payload carries resolved names'
);

select is(
  (select (map_payload('en') -> 'communities' -> 0 -> 'years' -> '2007')::int),
  1,
  'the map payload carries the per-year photograph count'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
supabase test db
```

Expected: FAIL — `function map_payload(unknown) does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- One call fills the whole map view: every community, its resolved name, and a
-- year -> count object so the coverage bars and the holes need no second query.
create or replace function map_payload(want lang_code default 'en')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'lang', want,
    'regions', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', region_name(r.id, want))
                       order by r.sort)
      from region r), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',      c.slug,
        'name',    community_name(c.id, want),
        'lon',     c.lon,
        'lat',     c.lat,
        'rg',      c.region_id,
        'f',       c.founded_year,
        'c',       coalesce(c.closed_year, 0),
        'total',   coalesce(p.total, 0),
        'years',   coalesce(p.years, '{}'::jsonb)
      ) order by c.founded_year)
      from community c
      left join lateral (
        select count(*)::int as total,
               jsonb_object_agg(x.year::text, x.n) as years
        from (select year, count(*)::int as n
              from photo
              where community_id = c.id and status = 'approved' and year is not null
              group by year) x
      ) p on true
    ), '[]'::jsonb)
  );
$$;

-- Everything the year screen needs for one community-year.
create or replace function year_payload(community_slug text, yr integer,
                                        want lang_code default 'en')
returns jsonb language sql stable as $$
  with c as (select * from community where slug = community_slug)
  select jsonb_build_object(
    'community', (select jsonb_build_object(
        'id', c.slug, 'name', community_name(c.id, want),
        'region', region_name(c.region_id, want),
        'f', c.founded_year, 'c', coalesce(c.closed_year, 0)) from c),
    'year', yr,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person', person_name(t.person_id, want),
        'role',   t.role,
        'from',   t.start_year,
        'to',     t.end_year,
        'household_of', t.household_of))
      from tenure t, c
      where t.community_id = c.id
        and yr between t.start_year and coalesce(t.end_year, 2200)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'path', ph.storage_path, 'taken_on', ph.taken_on,
        'venue', ph.venue, 'event', ph.event_type_id))
      from photo ph, c
      where ph.community_id = c.id and ph.year = yr and ph.status = 'approved'
    ), '[]'::jsonb)
  );
$$;

grant execute on function map_payload(lang_code) to anon, authenticated;
grant execute on function year_payload(text, integer, lang_code) to anon, authenticated;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
supabase db reset && supabase test db
```

Expected: `ok 1..2`, all pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_api.sql supabase/tests/0010_api.test.sql
git commit -m "feat(db): add map and year read payloads"
```

---

### Task 12: Port the mockup data into real rows

**Files:**
- Create: `scripts/seed-communities.mjs`

The mockup's 49 communities are a stress-test set, not the real list. This script
exists so the schema can be exercised end to end before the client's list arrives,
and so replacing it later is a one-file change.

- [ ] **Step 1: Write the script**

```js
/* Ports docs/data.js COMMUNITIES into Postgres. Placeholder data — replace the
   source list when the client supplies the real one. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const src = readFileSync('docs/data.js', 'utf8');
const COMMUNITIES = eval(src.match(/const COMMUNITIES = (\[[\s\S]*?\n\];)/)[1].slice(0, -1));

for (const c of COMMUNITIES) {
  const { data, error } = await db.from('community').upsert({
    slug: c.id, region_id: c.rg, lat: c.lat, lon: c.lon,
    founded_year: c.f, closed_year: c.c || null
  }, { onConflict: 'slug' }).select('id').single();
  if (error) { console.error(c.id, error.message); continue; }

  const rows = Object.entries(c.name).map(([lang, name]) => ({
    community_id: data.id, lang, name
  }));
  const tr = await db.from('community_tr').upsert(rows, {
    onConflict: 'community_id,lang'
  });
  if (tr.error) console.error(c.id, 'tr', tr.error.message);
  else console.log('ok', c.id, Object.keys(c.name).join('/'));
}
console.log('done:', COMMUNITIES.length, 'communities');
```

- [ ] **Step 2: Run it**

```bash
npm install @supabase/supabase-js
export SUPABASE_URL=$(supabase status -o env | grep '^API_URL' | cut -d= -f2- | tr -d '"')
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep '^SERVICE_ROLE_KEY' | cut -d= -f2- | tr -d '"')
node scripts/seed-communities.mjs
```

Expected: 49 `ok <slug> en/he/ru` lines, then `done: 49 communities`.

- [ ] **Step 3: Verify the payload matches the mockup**

```bash
psql "$(supabase status -o env | grep '^DB_URL' | cut -d= -f2- | tr -d '"')" -c \
  "select jsonb_array_length(map_payload('he') -> 'communities') as n,
          map_payload('he') -> 'communities' -> 0 ->> 'name' as first_he;"
```

Expected: `n = 49`, and `first_he` is a Hebrew name.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-communities.mjs
git commit -m "feat: port mockup communities into the database"
```

---

## After this plan

The front end still reads `docs/data.js`. Swapping it for `map_payload` /
`year_payload` is the first task of Phase 3, together with the back office that
lets the client edit these rows without touching code.
