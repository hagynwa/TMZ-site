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
