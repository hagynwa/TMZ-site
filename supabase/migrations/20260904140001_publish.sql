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
