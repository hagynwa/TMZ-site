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
