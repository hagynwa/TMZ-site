-- Torah MiTzion archive — the whole schema, in one file.
--
-- GENERATED. The source of truth is supabase/migrations/, and this is those files
-- concatenated in order for pasting into the Supabase SQL editor.
-- Regenerate with:  node scripts/build-schema.mjs
--
-- PREFER `supabase db push --linked`. It runs the same statements AND records
-- them in supabase_migrations.schema_migrations, so the next migration applies
-- cleanly. Paste this instead and that history stays empty, so a later push
-- will try to re-run everything from the beginning and fail on the first
-- `create table`. If you do paste it, tell whoever runs the next migration.
--
-- 24 migrations.

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120001_enums.sql
-- ═══════════════════════════════════════════════════════════════════
-- Torah MiTzion 30th-anniversary archive.
-- Every object in this project carries the tmz_ prefix so it can share a
-- Supabase project with unrelated work without collision.

-- pgTAP backs `supabase test db`. Harmless in production, but drop this line
-- from the production migration set if you would rather not ship it.
create extension if not exists pgtap with schema extensions;

-- The six languages the archive ships in. Adding a seventh is one ALTER TYPE.
create type tmz_lang_code as enum ('en', 'he', 'ru', 'fr', 'de', 'es');

-- What a person was doing at a community. 'spouse' and 'child' exist so a Rosh
-- Kollel's household is modelled as tenures too, not as a special-case blob.
create type tmz_tenure_role as enum
  ('rosh_kollel', 'shaliach', 'shlicha', 'spouse', 'child', 'staff');

create type tmz_photo_status as enum ('pending', 'approved', 'rejected', 'needs_info');
create type tmz_photo_source as enum ('web', 'whatsapp', 'import', 'admin');

-- Asked once, at first sign-in: how do you know Torah MiTzion?
create type tmz_connection_kind as enum
  ('shaliach', 'rosh_kollel', 'community_member', 'family', 'alumnus', 'staff', 'other');

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120002_geography.sql
-- ═══════════════════════════════════════════════════════════════════
create table tmz_region (
  id   text primary key,
  sort integer not null default 0
);

create table tmz_region_tr (
  region_id text not null references tmz_region(id) on delete cascade,
  lang      tmz_lang_code not null,
  name      text not null,
  primary key (region_id, lang)
);

create table tmz_community (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  region_id    text not null references tmz_region(id),
  lat          double precision not null check (lat between -90 and 90),
  lon          double precision not null check (lon between -180 and 180),
  founded_year integer not null check (founded_year between 1900 and 2200),
  closed_year  integer check (closed_year between 1900 and 2200),
  -- derived, so no code path can leave a status and a closed_year disagreeing
  is_open      boolean generated always as (closed_year is null) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint tmz_community_closed_after_founded
    check (closed_year is null or closed_year >= founded_year)
);

create index tmz_community_region_idx on tmz_community (region_id);

create table tmz_community_tr (
  community_id uuid not null references tmz_community(id) on delete cascade,
  lang         tmz_lang_code not null,
  name         text not null,
  country      text,
  blurb        text,
  primary key (community_id, lang)
);

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120003_i18n.sql
-- ═══════════════════════════════════════════════════════════════════
-- The fallback chain the whole six-language decision rests on: requested locale,
-- then English, then whatever exists. With 49 communities and six locales most
-- translations are missing most of the time, and the site must degrade to
-- English rather than render blank.

create or replace function tmz_community_name(cid uuid, want tmz_lang_code)
returns text language sql stable as $$
  select name from tmz_community_tr
  where community_id = cid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

create or replace function tmz_region_name(rid text, want tmz_lang_code)
returns text language sql stable as $$
  select name from tmz_region_tr
  where region_id = rid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

-- What is still untranslated, for the back-office coverage view.
create or replace view tmz_translation_gaps as
  select 'community' as entity, c.id::text as entity_id, c.slug as ref, l.lang
  from tmz_community c
  cross join (select unnest(enum_range(null::tmz_lang_code)) as lang) l
  where not exists (
    select 1 from tmz_community_tr t where t.community_id = c.id and t.lang = l.lang
  );

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120004_people.sql
-- ═══════════════════════════════════════════════════════════════════
create table tmz_person (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique,
  birth_year integer check (birth_year between 1900 and 2200),
  created_at timestamptz not null default now()
);

create table tmz_person_tr (
  person_id    uuid not null references tmz_person(id) on delete cascade,
  lang         tmz_lang_code not null,
  display_name text not null,
  primary key (person_id, lang)
);

create table tmz_institution (
  id   uuid primary key default gen_random_uuid(),
  slug text unique not null
);

create table tmz_institution_tr (
  institution_id uuid not null references tmz_institution(id) on delete cascade,
  lang           tmz_lang_code not null,
  name           text not null,
  primary key (institution_id, lang)
);

-- A person's engagement with one community over a span of years. People are
-- global: a shaliach in Memphis 2003 may be Rosh Kollel in Chicago 2018, and
-- that thread is a feature. The household of a Rosh Kollel is stored as tenures
-- too, pointed at his own tenure through household_of, so a family is queried
-- exactly the way a cohort is.
create table tmz_tenure (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references tmz_person(id) on delete cascade,
  community_id   uuid not null references tmz_community(id) on delete cascade,
  role           tmz_tenure_role not null,
  start_year     integer not null check (start_year between 1900 and 2200),
  end_year       integer check (end_year between 1900 and 2200),
  institution_id uuid references tmz_institution(id),
  household_of   uuid references tmz_tenure(id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint tmz_tenure_ends_after_start
    check (end_year is null or end_year >= start_year)
);

create index tmz_tenure_community_years_idx
  on tmz_tenure (community_id, start_year, end_year);
create index tmz_tenure_person_idx on tmz_tenure (person_id);
create index tmz_tenure_household_idx
  on tmz_tenure (household_of) where household_of is not null;

create or replace function tmz_person_name(pid uuid, want tmz_lang_code)
returns text language sql stable as $$
  select display_name from tmz_person_tr
  where person_id = pid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120005_photos.sql
-- ═══════════════════════════════════════════════════════════════════
create table tmz_event_type (
  id   text primary key,
  sort integer not null default 0
);

create table tmz_event_type_tr (
  event_type_id text not null references tmz_event_type(id) on delete cascade,
  lang          tmz_lang_code not null,
  name          text not null,
  primary key (event_type_id, lang)
);

create table tmz_photo (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid references tmz_community(id) on delete set null,
  year          integer check (year between 1990 and 2200),
  taken_on      date,
  event_type_id text references tmz_event_type(id),
  venue         text,
  storage_path  text not null,
  width         integer,
  height        integer,
  bytes         bigint,
  -- perceptual hash: the same photograph arriving twice by two routes is common
  phash         text,
  status        tmz_photo_status not null default 'pending',
  source        tmz_photo_source not null default 'web',
  submitted_by  uuid references auth.users(id) on delete set null,
  submitter_ref text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create index tmz_photo_community_year_idx
  on tmz_photo (community_id, year) where status = 'approved';
create index tmz_photo_status_idx on tmz_photo (status, created_at desc);
create index tmz_photo_phash_idx on tmz_photo (phash) where phash is not null;

create table tmz_photo_tr (
  photo_id uuid not null references tmz_photo(id) on delete cascade,
  lang     tmz_lang_code not null,
  caption  text,
  primary key (photo_id, lang)
);

create table tmz_photo_person (
  photo_id   uuid not null references tmz_photo(id) on delete cascade,
  person_id  uuid not null references tmz_person(id) on delete cascade,
  confidence real check (confidence between 0 and 1),
  added_by   uuid references auth.users(id) on delete set null,
  primary key (photo_id, person_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120006_moderation.sql
-- ═══════════════════════════════════════════════════════════════════
-- One row per screening pass, kept as history rather than overwritten, so a
-- rejection can still be explained months later.
create table tmz_moderation (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references tmz_photo(id) on delete cascade,
  model       text not null,
  verdict     tmz_photo_status not null,
  scores      jsonb not null default '{}'::jsonb,
  reasons     text[],
  reviewed_by uuid references auth.users(id) on delete set null,
  decided_at  timestamptz not null default now()
);

create index tmz_moderation_photo_idx on tmz_moderation (photo_id, decided_at desc);

create table tmz_app_user (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  connection_kind   tmz_connection_kind,
  connection_detail text,
  home_community_id uuid references tmz_community(id) on delete set null,
  role              text not null default 'contributor'
                    check (role in ('contributor', 'translator', 'editor', 'admin')),
  created_at        timestamptz not null default now()
);

-- security definer so the policy check can read tmz_app_user without the
-- caller needing select rights on it, which would otherwise recurse.
create or replace function tmz_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tmz_app_user
    where id = auth.uid() and role in ('editor', 'admin')
  );
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120007_rls.sql
-- ═══════════════════════════════════════════════════════════════════
-- Reference and published content is world-readable. Nothing else is.
-- Grants let the role reach the table at all; the policies below decide the rows.
grant usage on schema public to anon, authenticated;
grant select on tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
                tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
                tmz_tenure, tmz_event_type, tmz_event_type_tr,
                tmz_photo, tmz_photo_tr, tmz_photo_person
  to anon, authenticated;
grant insert on tmz_photo to authenticated;
grant select, insert, update on tmz_app_user to authenticated;
grant select, insert, update, delete on
  tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
  tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
  tmz_tenure, tmz_event_type, tmz_event_type_tr,
  tmz_photo, tmz_photo_tr, tmz_photo_person, tmz_moderation
  to authenticated;


alter table tmz_region          enable row level security;
alter table tmz_region_tr       enable row level security;
alter table tmz_community       enable row level security;
alter table tmz_community_tr    enable row level security;
alter table tmz_person          enable row level security;
alter table tmz_person_tr       enable row level security;
alter table tmz_institution     enable row level security;
alter table tmz_institution_tr  enable row level security;
alter table tmz_tenure          enable row level security;
alter table tmz_event_type      enable row level security;
alter table tmz_event_type_tr   enable row level security;
alter table tmz_photo           enable row level security;
alter table tmz_photo_tr        enable row level security;
alter table tmz_photo_person    enable row level security;
alter table tmz_moderation      enable row level security;
alter table tmz_app_user        enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'tmz_region','tmz_region_tr','tmz_community','tmz_community_tr',
    'tmz_person','tmz_person_tr','tmz_institution','tmz_institution_tr',
    'tmz_tenure','tmz_event_type','tmz_event_type_tr'
  ] loop
    execute format(
      'create policy %I on %I for select using (true)', tbl || '_public_read', tbl);
    execute format(
      'create policy %I on %I for all to authenticated
       using (tmz_is_staff()) with check (tmz_is_staff())', tbl || '_staff_write', tbl);
  end loop;
end $$;

-- A photograph becomes public only once it is approved.
create policy tmz_photo_public_read on tmz_photo
  for select using (status = 'approved' or tmz_is_staff());

-- Anyone signed in may submit, but never straight into the archive.
create policy tmz_photo_submit on tmz_photo
  for insert to authenticated
  with check (status = 'pending' and submitted_by = auth.uid());

create policy tmz_photo_staff_write on tmz_photo
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

create policy tmz_photo_tr_read on tmz_photo_tr for select using (
  exists (select 1 from tmz_photo p
          where p.id = photo_id and (p.status = 'approved' or tmz_is_staff())));
create policy tmz_photo_tr_staff on tmz_photo_tr
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

create policy tmz_photo_person_read on tmz_photo_person for select using (
  exists (select 1 from tmz_photo p
          where p.id = photo_id and (p.status = 'approved' or tmz_is_staff())));
create policy tmz_photo_person_staff on tmz_photo_person
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

-- Moderation history is staff only.
create policy tmz_moderation_staff on tmz_moderation
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

-- A user reads and edits their own profile; staff read all.
create policy tmz_app_user_self on tmz_app_user
  for select to authenticated using (id = auth.uid() or tmz_is_staff());
create policy tmz_app_user_self_write on tmz_app_user
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy tmz_app_user_insert_self on tmz_app_user
  for insert to authenticated with check (id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120008_storage.sql
-- ═══════════════════════════════════════════════════════════════════
-- Originals stay private: an unapproved submission must not be guessable by URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tmz-photo-originals', 'tmz-photo-originals', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- Derivatives are generated only after approval, so this bucket is safe to serve.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tmz-photo-public', 'tmz-photo-public', true, 10485760,
        array['image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy "tmz submit to originals" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tmz-photo-originals');

create policy "tmz staff read originals" on storage.objects
  for select to authenticated
  using (bucket_id = 'tmz-photo-originals' and tmz_is_staff());

create policy "tmz world reads derivatives" on storage.objects
  for select using (bucket_id = 'tmz-photo-public');

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120009_api.sql
-- ═══════════════════════════════════════════════════════════════════
-- The two calls the front end makes instead of reading docs/data.js.

-- One call fills the whole map view: every community, its resolved name, and a
-- year -> count object, so the coverage bars and the holes need no second query.
create or replace function tmz_map_payload(want tmz_lang_code default 'en')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'lang', want,
    'regions', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', tmz_region_name(r.id, want))
                       order by r.sort)
      from tmz_region r), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',    c.slug,
        'name',  tmz_community_name(c.id, want),
        'lon',   c.lon,
        'lat',   c.lat,
        'rg',    c.region_id,
        'f',     c.founded_year,
        'c',     coalesce(c.closed_year, 0),
        'total', coalesce(p.total, 0),
        'years', coalesce(p.years, '{}'::jsonb)
      ) order by c.founded_year, c.slug)
      from tmz_community c
      left join lateral (
        select count(*)::int as total,
               jsonb_object_agg(x.year::text, x.n) as years
        from (select year, count(*)::int as n
              from tmz_photo
              where community_id = c.id and status = 'approved' and year is not null
              group by year) x
      ) p on true
    ), '[]'::jsonb)
  );
$$;

-- Everything the year screen needs for one community-year.
create or replace function tmz_year_payload(community_slug text, yr integer,
                                            want tmz_lang_code default 'en')
returns jsonb language sql stable as $$
  with c as (select * from tmz_community where slug = community_slug)
  select jsonb_build_object(
    'community', (select jsonb_build_object(
        'id', c.slug, 'name', tmz_community_name(c.id, want),
        'region', tmz_region_name(c.region_id, want),
        'f', c.founded_year, 'c', coalesce(c.closed_year, 0)) from c),
    'year', yr,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person',       tmz_person_name(t.person_id, want),
        'role',         t.role,
        'from',         t.start_year,
        'to',           t.end_year,
        'household_of', t.household_of)
        order by t.role, t.start_year)
      from tmz_tenure t, c
      where t.community_id = c.id
        and yr between t.start_year and coalesce(t.end_year, 2200)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'path', ph.storage_path, 'taken_on', ph.taken_on,
        'venue', ph.venue, 'event', ph.event_type_id)
        order by ph.taken_on nulls last)
      from tmz_photo ph, c
      where ph.community_id = c.id and ph.year = yr and ph.status = 'approved'
    ), '[]'::jsonb)
  );
$$;

grant execute on function tmz_map_payload(tmz_lang_code) to anon, authenticated;
grant execute on function tmz_year_payload(text, integer, tmz_lang_code) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120010_grants_hardening.sql
-- ═══════════════════════════════════════════════════════════════════
-- This project is shared with other apps that already carry a broad
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated`.
-- That rule applies to every NEW table regardless of name, so each tmz_ table
-- was created with full DELETE/INSERT/UPDATE/TRUNCATE for both API roles —
-- confirmed by querying information_schema.role_table_grants after the first
-- push. RLS was still filtering rows correctly (verified: an anon UPDATE
-- affected zero rows), but TRUNCATE is not filtered by row-level security at
-- all, so any authenticated contributor could have emptied a table outright.
-- Revoke down to what each role is actually meant to have; RLS policies still
-- narrow the rows within whatever DML verbs remain granted.

revoke insert, update, delete, truncate, references, trigger on
  tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
  tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
  tmz_tenure, tmz_event_type, tmz_event_type_tr,
  tmz_photo, tmz_photo_tr, tmz_photo_person
  from anon;

revoke select, insert, update, delete, truncate, references, trigger on
  tmz_app_user, tmz_moderation
  from anon;

revoke truncate, references, trigger on
  tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
  tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
  tmz_tenure, tmz_event_type, tmz_event_type_tr,
  tmz_photo, tmz_photo_tr, tmz_photo_person, tmz_moderation, tmz_app_user
  from authenticated;

-- A view, so DML grants on it are inert anyway, but keep it staff-facing to
-- match its purpose: a translator or editor checking what is still missing.
revoke all on tmz_translation_gaps from anon, authenticated;

-- Set the default for THIS schema's future tmz_ tables to something sane, so
-- the next migration does not silently reinherit the ambient broad grant.
-- Scoped to the role that owns these migrations, not a schema-wide override,
-- so the other apps' own default-privilege rule is left untouched.
alter default privileges for role current_user in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260903120011_admin_bootstrap.sql
-- ═══════════════════════════════════════════════════════════════════
-- The very first back-office user has nobody to promote them to admin, so
-- their profile row would land as 'contributor' and refuse them entry. This
-- trigger promotes a hard-coded list of bootstrap emails to admin on insert.
-- Add or remove emails here as the team grows; other users stay
-- 'contributor' and must be promoted manually by an existing admin.

create or replace function tmz_bootstrap_admin() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  my_email text;
begin
  select email into my_email from auth.users where id = new.id;
  if lower(coalesce(my_email, '')) in ('hagai.rettig@gmail.com') then
    new.role := 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists tmz_app_user_bootstrap on tmz_app_user;
create trigger tmz_app_user_bootstrap
  before insert on tmz_app_user
  for each row execute function tmz_bootstrap_admin();

-- ═══════════════════════════════════════════════════════════════════
-- 20260904090001_uploads.sql
-- ═══════════════════════════════════════════════════════════════════
-- Public upload support: who sent a photograph, how often they may, and
-- whether we already hold it.

-- One row per submission event, so a contributor's details are recorded once
-- rather than copied onto every photograph they send.
create table tmz_submission (
  id                uuid primary key default gen_random_uuid(),
  contributor_name  text,
  contributor_email text,
  contributor_note  text,
  source            tmz_photo_source not null default 'web',
  -- salted hash, never the address itself: enough to rate-limit and to spot
  -- abuse, useless for identifying anyone.
  ip_hash           text,
  consented         boolean not null default false,
  created_at        timestamptz not null default now()
);

create index tmz_submission_created_idx on tmz_submission (created_at desc);

alter table tmz_photo
  add column submission_id uuid references tmz_submission(id) on delete set null;

create index tmz_photo_submission_idx on tmz_photo (submission_id);

-- Rate limiting lives in Postgres for now. The original stack calls for Redis,
-- and this is deliberately behind one function so swapping the storage is a
-- one-body change — but a table is honest until there is traffic that needs
-- anything faster, and it costs no new service.
create table tmz_rate_limit (
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);

create index tmz_rate_limit_window_idx on tmz_rate_limit (window_start);

/* Returns true when the caller may proceed, false when they are over the limit.
   The window is a fixed bucket rather than a sliding one: cheaper, and the
   difference does not matter for "twenty uploads an hour". */
create or replace function tmz_rate_take(
  p_bucket text, p_limit integer, p_window_seconds integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into tmz_rate_limit (bucket, window_start, count)
  values (p_bucket, w, 1)
  on conflict (bucket, window_start)
  do update set count = tmz_rate_limit.count + 1
  returning count into c;

  delete from tmz_rate_limit where window_start < now() - interval '1 day';
  return c <= p_limit;
end;
$$;

/* Hamming distance between two 64-bit perceptual hashes given as hex. Under
   about 10 means "the same photograph", which is how the same picture arriving
   once by WhatsApp and once by the upload page gets caught. */
create or replace function tmz_phash_distance(a text, b text)
returns integer language sql immutable as $$
  select length(replace(
    (('x' || lpad(a, 16, '0'))::bit(64) # ('x' || lpad(b, 16, '0'))::bit(64))::text,
    '0', ''))
$$;

/* Nearest existing photograph to a candidate hash, so the upload path can say
   "we already have this" instead of collecting the same picture five times. */
create or replace function tmz_find_duplicate(p_hash text, p_max_distance integer default 10)
returns table (photo_id uuid, distance integer, status tmz_photo_status)
language sql stable security definer set search_path = public as $$
  select id, tmz_phash_distance(phash, p_hash), status
  from tmz_photo
  where phash is not null
    and tmz_phash_distance(phash, p_hash) <= p_max_distance
  order by 2 asc
  limit 1;
$$;

alter table tmz_submission enable row level security;
alter table tmz_rate_limit enable row level security;

-- Both tables are written only by the service role inside the upload function,
-- which bypasses RLS. Staff may read submissions to see who sent what.
create policy tmz_submission_staff on tmz_submission
  for select to authenticated using (tmz_is_staff());

revoke all on tmz_submission, tmz_rate_limit from anon, authenticated;
grant select on tmz_submission to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904100001_dashboard.sql
-- ═══════════════════════════════════════════════════════════════════
-- The campaign view: where the holes are, and where photographs are coming
-- from. Computed in one call so the dashboard is a single round trip.

/* Every community crossed with every year it was open, and what we hold for
   each. This is the "Memphis 2003 has nothing" question, answered directly:
   the rows with n = 0 are the campaign's whole target list. */
create or replace function tmz_coverage(want tmz_lang_code default 'en')
returns jsonb language sql stable security definer set search_path = public as $$
  with span as (
    select c.id, c.slug, c.region_id, c.founded_year,
           coalesce(c.closed_year, extract(year from now())::int) as last_year,
           tmz_community_name(c.id, want) as name
    from tmz_community c
  ),
  cells as (
    select s.id, s.slug, s.name, s.region_id, y.yr,
           coalesce(p.n, 0) as n
    from span s
    cross join lateral generate_series(s.founded_year, s.last_year) as y(yr)
    left join lateral (
      select count(*)::int as n from tmz_photo
      where community_id = s.id and year = y.yr and status = 'approved'
    ) p on true
  )
  select jsonb_build_object(
    'years', (select coalesce(jsonb_agg(distinct yr order by yr), '[]'::jsonb) from cells),
    'total_cells', (select count(*) from cells),
    'empty_cells', (select count(*) from cells where n = 0),
    'rows', coalesce((
      select jsonb_agg(r order by r->>'name')
      from (
        select jsonb_build_object(
          'slug', slug, 'name', name, 'region', region_id,
          'first', min(yr), 'last', max(yr),
          'held', sum(n), 'empty', count(*) filter (where n = 0),
          'years', jsonb_object_agg(yr::text, n)
        ) as r
        from cells group by id, slug, name, region_id
      ) x
    ), '[]'::jsonb)
  );
$$;

/* Where submissions are coming from and what happened to them. Drives the
   intake half of the dashboard. */
create or replace function tmz_intake_stats(days integer default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'window_days', days,
    'by_source', coalesce((
      select jsonb_object_agg(source, n) from (
        select source::text, count(*)::int as n from tmz_photo
        where created_at > now() - (days || ' days')::interval
        group by source) s), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, n) from (
        select status::text, count(*)::int as n from tmz_photo
        where created_at > now() - (days || ' days')::interval
        group by status) s), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'n', n) order by d)
      from (
        select date_trunc('day', created_at) as d, count(*)::int as n
        from tmz_photo where created_at > now() - (days || ' days')::interval
        group by 1) x), '[]'::jsonb),
    'contributors', (
      select count(distinct coalesce(contributor_email, ip_hash))::int
      from tmz_submission where created_at > now() - (days || ' days')::interval),
    'auto_rejected', (
      select count(*)::int from tmz_moderation
      where verdict = 'rejected' and decided_at > now() - (days || ' days')::interval)
  );
$$;

revoke execute on function tmz_coverage(tmz_lang_code) from anon;
revoke execute on function tmz_intake_stats(integer) from anon;
grant execute on function tmz_coverage(tmz_lang_code) to authenticated;
grant execute on function tmz_intake_stats(integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904140001_publish.sql
-- ═══════════════════════════════════════════════════════════════════
-- Approving a photograph has to move a file, not just flip a column. The
-- original stays in the private bucket forever; approval copies it into the
-- public one, and that copy is what the site serves.

alter table tmz_photo add column public_path text;

comment on column tmz_photo.public_path is
  'Key in tmz-photo-public. Null until approved; the original in '
  'tmz-photo-originals is never served directly.';

-- Staff need write access to the public bucket to make that copy. Readers
-- already have world SELECT on it from migration 8.
create policy "tmz staff write derivatives" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tmz-photo-public' and tmz_is_staff());

create policy "tmz staff manage derivatives" on storage.objects
  for update to authenticated
  using (bucket_id = 'tmz-photo-public' and tmz_is_staff())
  with check (bucket_id = 'tmz-photo-public' and tmz_is_staff());

-- Un-approving should be able to take the derivative back down.
create policy "tmz staff remove derivatives" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tmz-photo-public' and tmz_is_staff());

/* The public read payload now needs the servable path, so the site never has
   to know the private original exists. */
create or replace function tmz_year_payload(community_slug text, yr integer,
                                            want tmz_lang_code default 'en')
returns jsonb language sql stable as $$
  with c as (select * from tmz_community where slug = community_slug)
  select jsonb_build_object(
    'community', (select jsonb_build_object(
        'id', c.slug, 'name', tmz_community_name(c.id, want),
        'region', tmz_region_name(c.region_id, want),
        'f', c.founded_year, 'c', coalesce(c.closed_year, 0)) from c),
    'year', yr,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person',       tmz_person_name(t.person_id, want),
        'role',         t.role,
        'from',         t.start_year,
        'to',           t.end_year,
        'institution',  (select name from tmz_institution_tr it
                         where it.institution_id = t.institution_id
                         order by (it.lang = want) desc, (it.lang = 'en') desc limit 1),
        'household_of', t.household_of)
        order by t.role, t.start_year)
      from tmz_tenure t, c
      where t.community_id = c.id
        and yr between t.start_year and coalesce(t.end_year, 2200)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'path', ph.public_path, 'taken_on', ph.taken_on,
        'venue', ph.venue, 'event', ph.event_type_id,
        'event_name', (select name from tmz_event_type_tr et
                       where et.event_type_id = ph.event_type_id
                       order by (et.lang = want) desc, (et.lang = 'en') desc limit 1),
        'people', (select count(*) from tmz_photo_person pp where pp.photo_id = ph.id))
        order by ph.taken_on nulls last)
      from tmz_photo ph, c
      where ph.community_id = c.id and ph.year = yr
        and ph.status = 'approved' and ph.public_path is not null
    ), '[]'::jsonb)
  );
$$;

/* Counts must follow the same rule as the payload: a photograph with no
   derivative cannot be shown, so it must not be counted either. Otherwise the
   map promises pictures the year screen cannot produce. */
create or replace function tmz_map_payload(want tmz_lang_code default 'en')
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'lang', want,
    'regions', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', tmz_region_name(r.id, want))
                       order by r.sort)
      from tmz_region r), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',    c.slug,
        'name',  tmz_community_name(c.id, want),
        'lon',   c.lon,
        'lat',   c.lat,
        'rg',    c.region_id,
        'f',     c.founded_year,
        'c',     coalesce(c.closed_year, 0),
        'total', coalesce(p.total, 0),
        'years', coalesce(p.years, '{}'::jsonb)
      ) order by c.founded_year, c.slug)
      from tmz_community c
      left join lateral (
        select count(*)::int as total,
               jsonb_object_agg(x.year::text, x.n) as years
        from (select year, count(*)::int as n
              from tmz_photo
              where community_id = c.id and status = 'approved'
                and public_path is not null and year is not null
              group by year) x
      ) p on true
    ), '[]'::jsonb)
  );
$$;

grant execute on function tmz_map_payload(tmz_lang_code) to anon, authenticated;
grant execute on function tmz_year_payload(text, integer, tmz_lang_code) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904160001_roster_household.sql
-- ═══════════════════════════════════════════════════════════════════
/* The year payload already returned household_of — the tenure a spouse or child
   hangs off — but never returned the tenures' own ids, so the front end could
   see that someone belonged to a household and not to whose. It grouped every
   spouse in the year under the Rosh Kollel, which put Ikrat Tannenbaum inside
   Rabbi Grunwald's family on the Memphis 2026 screen. She is married to Rabbi
   Tzvi Tannenbaum, who is standing three cards away.

   The fix is one field. household_of is only meaningful next to an id. */

create or replace function tmz_year_payload(community_slug text, yr integer,
                                            want tmz_lang_code default 'en')
returns jsonb language sql stable as $$
  with c as (select * from tmz_community where slug = community_slug)
  select jsonb_build_object(
    'community', (select jsonb_build_object(
        'id', c.slug, 'name', tmz_community_name(c.id, want),
        'region', tmz_region_name(c.region_id, want),
        'f', c.founded_year, 'c', coalesce(c.closed_year, 0)) from c),
    'year', yr,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           t.id,
        'person',       tmz_person_name(t.person_id, want),
        'role',         t.role,
        'from',         t.start_year,
        'to',           t.end_year,
        'institution',  (select name from tmz_institution_tr it
                         where it.institution_id = t.institution_id
                         order by (it.lang = want) desc, (it.lang = 'en') desc limit 1),
        'household_of', t.household_of)
        order by t.role, t.start_year)
      from tmz_tenure t, c
      where t.community_id = c.id
        and yr between t.start_year and coalesce(t.end_year, 2200)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'path', ph.public_path, 'taken_on', ph.taken_on,
        'venue', ph.venue, 'event', ph.event_type_id,
        'event_name', (select name from tmz_event_type_tr et
                       where et.event_type_id = ph.event_type_id
                       order by (et.lang = want) desc, (et.lang = 'en') desc limit 1),
        'people', (select count(*) from tmz_photo_person pp where pp.photo_id = ph.id))
        order by ph.taken_on nulls last)
      from tmz_photo ph, c
      where ph.community_id = c.id and ph.year = yr
        and ph.status = 'approved' and ph.public_path is not null
    ), '[]'::jsonb)
  );
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904170001_sim.sql
-- ═══════════════════════════════════════════════════════════════════
/* Support for the WhatsApp test console.

   The console drives the real tmz-whatsapp function — same screening, same
   parsing, same database writes — so its photographs land in the real archive
   alongside genuine ones. They can never reach the public site (that requires
   status='approved' AND a public_path, and both are a reviewer's doing), but a
   reviewer working through the queue would have no way to tell a test from a
   grandmother's shoebox. So they say so. */

alter table tmz_submission
  add column is_test boolean not null default false;

comment on column tmz_submission.is_test is
  'Sent through the WhatsApp test console rather than by a real contributor.';

/* Lets the console clean up after itself. Without this, testing the intake
   means slowly filling the moderation queue with pictures of nothing, and the
   only way out is a staff member deleting rows by hand.

   Scoped to one sender and to test submissions only: it cannot touch a real
   contribution even if called with a real contributor's number, because
   is_test is set by the function and never by the caller. */
create or replace function tmz_sim_reset(p_ref text)
returns table (photos integer, submissions integer)
language plpgsql security definer set search_path = public as $$
declare
  ph integer;
  sb integer;
begin
  with doomed as (
    select p.id from tmz_photo p
    join tmz_submission s on s.id = p.submission_id
    where s.is_test and p.submitter_ref = p_ref
  ), del as (
    delete from tmz_photo where id in (select id from doomed) returning 1
  ) select count(*)::integer into ph from del;

  with del as (
    delete from tmz_submission
    where is_test and ip_hash = p_ref
      and not exists (select 1 from tmz_photo p where p.submission_id = tmz_submission.id)
    returning 1
  ) select count(*)::integer into sb from del;

  return query select ph, sb;
end;
$$;

/* Only the service role calls this — the edge function, holding the console's
   own token. Nothing reachable from a browser with the anon key. */
revoke all on function tmz_sim_reset(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904180001_sim_fixes.sql
-- ═══════════════════════════════════════════════════════════════════
/* Two things the test console found in its first full run.

   1. tmz_sim_reset matched submitter_ref exactly. But answering the agent's
      question appends the answer to that field — "wa:15550000009" becomes
      "wa:15550000009 · אבא שלי מימין · ערב פורים" — so reset silently cleaned
      up only the photographs nobody had said anything about. Match the prefix,
      which is what the column is: an identity followed by whatever was learned.

   2. The agent has nowhere to remember which language someone writes in. It
      answers a photograph in English even when the sender has been writing in
      Hebrew all along, because a photograph carries no text to detect. The
      submission is the right place for it — one row per send, already keyed to
      the sender. */

alter table tmz_submission
  add column lang tmz_lang_code;

comment on column tmz_submission.lang is
  'The language this contributor was writing in, so a photograph with no caption can still be answered in it.';

create index tmz_submission_ip_idx on tmz_submission (ip_hash, created_at desc);

create or replace function tmz_sim_reset(p_ref text)
returns table (photos integer, submissions integer)
language plpgsql security definer set search_path = public as $$
declare
  ph integer;
  sb integer;
begin
  with doomed as (
    select p.id from tmz_photo p
    join tmz_submission s on s.id = p.submission_id
    where s.is_test and p.submitter_ref like p_ref || '%'
  ), del as (
    delete from tmz_photo where id in (select id from doomed) returning 1
  ) select count(*)::integer into ph from del;

  with del as (
    delete from tmz_submission
    where is_test and ip_hash like p_ref || '%'
      and not exists (select 1 from tmz_photo p where p.submission_id = tmz_submission.id)
    returning 1
  ) select count(*)::integer into sb from del;

  return query select ph, sb;
end;
$$;

revoke all on function tmz_sim_reset(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904190001_wa_contact.sql
-- ═══════════════════════════════════════════════════════════════════
/* Where a WhatsApp conversation's memory lives.

   The language was being stored on tmz_submission, which only exists once
   someone has sent a photograph. So the common opening — "שלום, יש לי תמונות
   ישנות", then the picture — could not work: at the moment of the greeting
   there was no row to write to, and the photograph that followed was answered
   in English.

   One row per sender, written on the first message of any kind. It is also the
   obvious home for anything else the agent needs to remember about someone
   between messages. */

create table tmz_wa_contact (
  ref         text primary key,           -- 'wa:<phone>', the same key used elsewhere
  lang        tmz_lang_code,
  display_name text,
  is_test     boolean not null default false,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

comment on table tmz_wa_contact is
  'Per-sender state for the WhatsApp agent. Not public: no policy grants access, and only the service role reads it.';

alter table tmz_wa_contact enable row level security;
revoke all on table tmz_wa_contact from anon, authenticated;

/* The console cleans up after itself, and its contacts are part of that. */
create or replace function tmz_sim_reset(p_ref text)
returns table (photos integer, submissions integer)
language plpgsql security definer set search_path = public as $$
declare
  ph integer;
  sb integer;
begin
  with doomed as (
    select p.id from tmz_photo p
    join tmz_submission s on s.id = p.submission_id
    where s.is_test and p.submitter_ref like p_ref || '%'
  ), del as (
    delete from tmz_photo where id in (select id from doomed) returning 1
  ) select count(*)::integer into ph from del;

  with del as (
    delete from tmz_submission
    where is_test and ip_hash like p_ref || '%'
      and not exists (select 1 from tmz_photo p where p.submission_id = tmz_submission.id)
    returning 1
  ) select count(*)::integer into sb from del;

  delete from tmz_wa_contact where is_test and ref = p_ref;

  return query select ph, sb;
end;
$$;

revoke all on function tmz_sim_reset(text) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904200001_autopublish.sql
-- ═══════════════════════════════════════════════════════════════════
/* Automatic publishing.
 *
 * Until now a photograph reached the site only when a person clicked Approve.
 * The agent now does that itself, and the columns below exist so that decision
 * stays legible after the fact: who published a photograph, when, on what
 * grounds, and how to find everything one bad run let through.
 *
 * Nothing here weakens the public read rule. The site still serves only
 * status='approved' with a public_path, and both are still set by the same
 * writes a human made — the difference is who makes them. */

alter table tmz_photo
  add column published_by text check (published_by in ('agent', 'staff'));
-- published_at already exists on this table.

comment on column tmz_photo.published_by is
  'Who moved this into the public bucket. Lets staff review or reverse a run of agent decisions as a group.';

create index tmz_photo_published_idx on tmz_photo (published_by, published_at desc)
  where published_by is not null;

/* Screening is now a gate rather than a hint, so its record has to say which
   pass produced a verdict and what the agent did about it. */
alter table tmz_moderation
  add column pass     text,
  add column decision text;

comment on column tmz_moderation.pass is
  'Which screening pass this row records: describe, judge, or confirm.';
comment on column tmz_moderation.decision is
  'What the agent did: published, held, or rejected.';

/* What the agent remembers about a sender between messages. Community and year
   travel with the person, not the photograph: someone emptying a shoebox says
   "Memphis, 2003" once and then sends eleven pictures. */
alter table tmz_wa_contact
  add column community_id  uuid references tmz_community(id) on delete set null,
  add column year          integer check (year between 1990 and 2200),
  add column strikes       integer not null default 0,
  add column blocked_until timestamptz;

comment on column tmz_wa_contact.strikes is
  'Rejected sends. Publishing without a human in the loop means the only defence against someone probing the screener is to stop answering them.';

/* Publishing without a human means a mistake is public, so the reverse has to
   be one call rather than a hunt through three tables. Staff only. */
create or replace function tmz_unpublish(p_photo_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tmz_is_staff() then
    raise exception 'staff only';
  end if;

  update tmz_photo
     set status = 'rejected', public_path = null,
         published_by = null, published_at = null
   where id = p_photo_id;

  insert into tmz_moderation (photo_id, model, verdict, pass, decision, reasons, reviewed_by)
  values (p_photo_id, 'human', 'rejected', 'review', 'rejected',
          array[coalesce(p_reason, 'unpublished by staff')], auth.uid());
end;
$$;

revoke all on function tmz_unpublish(uuid, text) from public, anon;
grant execute on function tmz_unpublish(uuid, text) to authenticated;

/* Everything the agent put on the site, newest first — the review queue that
   replaces the approval queue. Reading it is a staff job; the public payloads
   do not go anywhere near it. */
create or replace view tmz_agent_published as
  select p.id, p.community_id, p.year, p.public_path, p.published_at,
         p.submitter_ref, p.event_type_id,
         (select jsonb_agg(jsonb_build_object(
            'pass', m.pass, 'decision', m.decision, 'model', m.model,
            'scores', m.scores, 'reasons', m.reasons) order by m.decided_at)
          from tmz_moderation m where m.photo_id = p.id) as screening
    from tmz_photo p
   where p.published_by = 'agent'
   order by p.published_at desc;

revoke all on tmz_agent_published from anon;
grant select on tmz_agent_published to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904210001_derived.sql
-- ═══════════════════════════════════════════════════════════════════
/* Two columns the automatic path needs.
 *
 * derived_path: the re-encoded, resized copy, kept in the PRIVATE bucket.
 * A photograph is cleaned at the moment it arrives, but it is often not
 * publishable yet — the agent knows it is safe and does not yet know which
 * community or year it belongs to, and a photograph with no year has nowhere
 * to appear. Writing the derivative straight into the public bucket to wait
 * would mean a live URL for something not yet cleared for the site, so it
 * waits in the private one and is copied across the moment it is placed.
 *
 * agent_decision: what screening concluded, so the answer that arrives ten
 * minutes later — "Memphis, 2003" — can publish the photograph without
 * screening it a second time, and so a photograph that was only ever held can
 * never be published by an answer alone. */

alter table tmz_photo
  add column derived_path   text,
  add column agent_decision text check (agent_decision in ('publish', 'hold', 'reject'));

comment on column tmz_photo.derived_path is
  'Sanitised, resized JPEG in tmz-photo-originals. Copied to tmz-photo-public on publication.';
comment on column tmz_photo.agent_decision is
  'Screening''s conclusion, kept so placement arriving later can act on it without re-screening.';

-- ═══════════════════════════════════════════════════════════════════
-- 20260904220001_takedown.sql
-- ═══════════════════════════════════════════════════════════════════
/* Taking a photograph down has to take the file down.
 *
 * Found while cleaning up after a test: deleting the row left the object in
 * the public bucket and its URL kept returning 200.
 *
 * The first attempt at a fix was a trigger deleting from storage.objects, and
 * Postgres refused it: "Direct deletion from storage tables is not allowed."
 * Which is the answer — files can only be removed through the Storage API, so
 * a takedown cannot live in SQL at all, and the tmz_unpublish function added
 * one migration ago was a half-takedown by construction. It nulled public_path
 * and left the file serving.
 *
 * So it goes, and the two callers that CAN reach the Storage API own this:
 * the back office (docs/admin/views.js already removes the object before it
 * clears public_path) and the edge function (tmz-whatsapp, for the test
 * console's reset). What SQL keeps is the audit note, which is all it was ever
 * able to do honestly. */

drop function if exists tmz_unpublish(uuid, text);

/* Records a takedown. The caller deletes the object first — this is the note
   that says it happened, not the thing that makes it happen. */
create or replace function tmz_record_takedown(p_photo_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tmz_is_staff() then
    raise exception 'staff only';
  end if;

  update tmz_photo
     set status = 'rejected', public_path = null,
         published_by = null, published_at = null
   where id = p_photo_id;

  insert into tmz_moderation (photo_id, model, verdict, pass, decision, reasons, reviewed_by)
  values (p_photo_id, 'human', 'rejected', 'review', 'rejected',
          array[coalesce(p_reason, 'unpublished by staff')], auth.uid());
end;
$$;

comment on function tmz_record_takedown is
  'Marks a photograph as taken down. Does NOT delete the file — SQL cannot; the caller must remove the storage object through the Storage API first.';

revoke all on function tmz_record_takedown(uuid, text) from public, anon;
grant execute on function tmz_record_takedown(uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904230001_contributors.sql
-- ═══════════════════════════════════════════════════════════════════
/* Who has actually sent something.
 *
 * Aggregated in the database rather than in the browser on purpose:
 * tmz_submission holds contributor_email, and a leaderboard is no reason to
 * ship a list of people's email addresses to a page. Only a name, a count and
 * a date leave this function. */

create or replace function tmz_contributors(days integer default 90, lim integer default 25)
returns table (
  name        text,
  source      tmz_photo_source,
  sent        bigint,
  on_site     bigint,
  waiting     bigint,
  refused     bigint,
  last_sent   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(nullif(trim(s.contributor_name), ''), 'anonymous') as name,
    s.source,
    count(p.id)                                                   as sent,
    count(*) filter (where p.status = 'approved')                 as on_site,
    count(*) filter (where p.status = 'pending')                  as waiting,
    count(*) filter (where p.status = 'rejected')                 as refused,
    max(s.created_at)                                             as last_sent
  from tmz_submission s
  join tmz_photo p on p.submission_id = s.id
  where s.created_at > now() - make_interval(days => days)
    and not s.is_test
  group by 1, 2
  order by sent desc, last_sent desc
  limit lim;
$$;

comment on function tmz_contributors is
  'Contributor leaderboard. Aggregated server-side so no email address reaches the client.';

revoke all on function tmz_contributors(integer, integer) from public, anon;
grant execute on function tmz_contributors(integer, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904240001_staff_only.sql
-- ═══════════════════════════════════════════════════════════════════
/* Two ways campaign data was reachable by any signed-in user, not just staff.
 *
 * Anyone can sign in with Google — that is the whole point of the contributor
 * flow, and until an admin promotes them they see an "access pending" screen.
 * "Access pending" has to mean it.
 *
 * 1. tmz_agent_published is a VIEW, and a view in Postgres runs with its
 *    OWNER's rights unless it says otherwise. So RLS on tmz_photo, which is
 *    correct, was being bypassed by reading the view instead — and the view
 *    carried submitter_ref, which for a WhatsApp contribution is 'wa:' plus
 *    the sender's phone number. A contributor could have read the phone number
 *    of every person who sent a photograph.
 *
 * 2. tmz_coverage, tmz_intake_stats and tmz_contributors are SECURITY DEFINER
 *    and were granted to `authenticated` wholesale. Security definer means the
 *    function's own rights, so the grant was the only gate and it was the
 *    wrong shape. They check tmz_is_staff() themselves now.
 */

drop view if exists tmz_agent_published;

create view tmz_agent_published
  with (security_invoker = true) as
  select p.id, p.community_id, p.year, p.public_path, p.published_at,
         p.event_type_id,
         (select jsonb_agg(jsonb_build_object(
            'pass', m.pass, 'decision', m.decision, 'model', m.model,
            'scores', m.scores, 'reasons', m.reasons) order by m.decided_at)
          from tmz_moderation m where m.photo_id = p.id) as screening
    from tmz_photo p
   where p.published_by = 'agent';

comment on view tmz_agent_published is
  'Everything the agent put on the site. security_invoker so the reader''s own RLS applies; submitter_ref is deliberately not exposed — it carries a phone number.';

revoke all on tmz_agent_published from anon;
grant select on tmz_agent_published to authenticated;

/* The gate moves inside, where security definer cannot route around it. */
create or replace function tmz_contributors(days integer default 90, lim integer default 25)
returns table (
  name text, source tmz_photo_source, sent bigint,
  on_site bigint, waiting bigint, refused bigint, last_sent timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tmz_is_staff() then
    raise exception 'staff only';
  end if;
  return query
    select
      coalesce(nullif(trim(s.contributor_name), ''), 'anonymous'),
      s.source,
      count(p.id),
      count(*) filter (where p.status = 'approved'),
      count(*) filter (where p.status = 'pending'),
      count(*) filter (where p.status = 'rejected'),
      max(s.created_at)
    from tmz_submission s
    join tmz_photo p on p.submission_id = s.id
    where s.created_at > now() - make_interval(days => days)
      and not s.is_test
    group by 1, 2
    order by 3 desc, 7 desc
    limit lim;
end;
$$;

revoke all on function tmz_contributors(integer, integer) from public, anon;
grant execute on function tmz_contributors(integer, integer) to authenticated;

/* The two dashboard functions were SECURITY DEFINER, which means they ran with
   their owner's rights and the grant to `authenticated` was the only gate. They
   are re-created here as SECURITY INVOKER — the default — so the reader's own
   RLS applies: tmz_photo shows a non-staff reader only approved photographs and
   tmz_submission shows them nothing, which is exactly right. Nothing about the
   numbers changes for staff, who could already see all of it.

   They are reproduced verbatim below apart from that one word; the bodies are
   unchanged from migration 20260904100001. */

create or replace function tmz_coverage(want tmz_lang_code default 'en')
returns jsonb language sql stable set search_path = public as $$
  with span as (
    select c.id, c.slug, c.region_id, c.founded_year,
           coalesce(c.closed_year, extract(year from now())::int) as last_year,
           tmz_community_name(c.id, want) as name
    from tmz_community c
  ),
  cells as (
    select s.id, s.slug, s.name, s.region_id, y.yr,
           coalesce(p.n, 0) as n
    from span s
    cross join lateral generate_series(s.founded_year, s.last_year) as y(yr)
    left join lateral (
      select count(*)::int as n from tmz_photo
      where community_id = s.id and year = y.yr and status = 'approved'
    ) p on true
  )
  select jsonb_build_object(
    'years', (select coalesce(jsonb_agg(distinct yr order by yr), '[]'::jsonb) from cells),
    'total_cells', (select count(*) from cells),
    'empty_cells', (select count(*) from cells where n = 0),
    'rows', coalesce((
      select jsonb_agg(r order by r->>'name')
      from (
        select jsonb_build_object(
          'slug', slug, 'name', name, 'region', region_id,
          'first', min(yr), 'last', max(yr),
          'held', sum(n), 'empty', count(*) filter (where n = 0),
          'years', jsonb_object_agg(yr::text, n)
        ) as r
        from cells group by id, slug, name, region_id
      ) x
    ), '[]'::jsonb)
  );
$$;

create or replace function tmz_intake_stats(days integer default 30)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'window_days', days,
    'by_source', coalesce((
      select jsonb_object_agg(source, n) from (
        select source::text, count(*)::int as n from tmz_photo
        where created_at > now() - (days || ' days')::interval
        group by source) s), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, n) from (
        select status::text, count(*)::int as n from tmz_photo
        where created_at > now() - (days || ' days')::interval
        group by status) s), '{}'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'n', n) order by d)
      from (
        select date_trunc('day', created_at) as d, count(*)::int as n
        from tmz_photo where created_at > now() - (days || ' days')::interval
        group by 1) x), '[]'::jsonb),
    'contributors', (
      select count(distinct coalesce(contributor_email, ip_hash))::int
      from tmz_submission where created_at > now() - (days || ' days')::interval),
    'auto_rejected', (
      select count(*)::int from tmz_moderation
      where verdict = 'rejected' and decided_at > now() - (days || ' days')::interval)
  );
$$;

revoke execute on function tmz_coverage(tmz_lang_code) from anon;
revoke execute on function tmz_intake_stats(integer) from anon;
grant execute on function tmz_coverage(tmz_lang_code) to authenticated;
grant execute on function tmz_intake_stats(integer) to authenticated;

/* `revoke ... from anon` is not enough: every function is granted to PUBLIC on
   creation, and anon inherits that. tmz_coverage was still answering anonymous
   callers after the revoke above — harmless in content (it reads only what the
   public map payload already exposes) but not what the grant claimed, and a
   grant that does not mean what it says is the kind of thing nobody rechecks. */
revoke execute on function tmz_coverage(tmz_lang_code) from public;
revoke execute on function tmz_intake_stats(integer) from public;
revoke execute on function tmz_contributors(integer, integer) from public;
grant execute on function tmz_coverage(tmz_lang_code) to authenticated;
grant execute on function tmz_intake_stats(integer) to authenticated;
grant execute on function tmz_contributors(integer, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- 20260904250001_no_manual_approval.sql
-- ═══════════════════════════════════════════════════════════════════
/* No manual approval. The agent decides, and nothing waits for a person.
 *
 * That leaves one thing a person used to do that nobody now can: release a
 * photograph the screener could not judge because the screener was DOWN. A
 * quota error or an outage is not a verdict on the picture, and with no human
 * to come back to it, a held photograph would sit forever and the contributor
 * would never learn why.
 *
 * So a hold caused by the screener being unavailable is now a retry, and these
 * two columns carry it: whether the photograph still needs judging, and how
 * many times we have tried. Every other hold is gone — the agent publishes or
 * refuses, and says which to the sender. */

alter table tmz_photo
  add column needs_rescreen    boolean not null default false,
  add column rescreen_attempts integer not null default 0;

comment on column tmz_photo.needs_rescreen is
  'The screener was unavailable, not unconvinced. Picked up and judged again on a later message.';

create index tmz_photo_rescreen_idx on tmz_photo (created_at)
  where needs_rescreen;

/* What is waiting on the machine, and what has been abandoned by it. Staff read
   this to see whether the screener is healthy — not to approve anything. */
create or replace view tmz_agent_backlog
  with (security_invoker = true) as
  select p.id, p.community_id, p.year, p.created_at,
         p.rescreen_attempts,
         case
           when p.needs_rescreen and p.rescreen_attempts < 5 then 'waiting for the screener'
           when p.needs_rescreen then 'the screener never answered'
           when p.agent_decision = 'publish' and p.public_path is null then 'waiting to be placed'
           else 'settled'
         end as state,
         (select m.reasons from tmz_moderation m
           where m.photo_id = p.id and m.pass = 'final'
           order by m.decided_at desc limit 1) as why
    from tmz_photo p
   where p.status = 'pending';

comment on view tmz_agent_backlog is
  'Photographs the agent has not settled. A health check on the screener, not an approval queue — nothing here is waiting for a person.';

revoke all on tmz_agent_backlog from anon;
grant select on tmz_agent_backlog to authenticated;
