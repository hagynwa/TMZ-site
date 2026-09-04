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
