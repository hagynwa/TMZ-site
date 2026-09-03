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
