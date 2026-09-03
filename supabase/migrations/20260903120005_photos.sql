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
