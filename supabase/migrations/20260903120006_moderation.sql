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
