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
