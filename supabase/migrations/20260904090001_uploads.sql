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
