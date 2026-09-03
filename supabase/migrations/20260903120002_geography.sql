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
