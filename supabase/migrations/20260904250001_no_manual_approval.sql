/* No manual approval. The agent decides, and nothing waits for a person.
 *
 * That leaves one thing a person used to do that nobody now can: release a
 * photograph the screener could not judge because the screener was DOWN. A
 * quota error or an outage is not a verdict on the picture, and with no human
 * to come back to it, a held photograph would sit forever and the contributor
 * would never learn why.
 *
 * So a hold caused by the screener being unavailable is now a retry, and these
 * two columns carry it: whether the photograph still needs judging, and how
 * many times we have tried. Every other hold is gone — the agent publishes or
 * refuses, and says which to the sender. */

alter table tmz_photo
  add column needs_rescreen    boolean not null default false,
  add column rescreen_attempts integer not null default 0;

comment on column tmz_photo.needs_rescreen is
  'The screener was unavailable, not unconvinced. Picked up and judged again on a later message.';

create index tmz_photo_rescreen_idx on tmz_photo (created_at)
  where needs_rescreen;

/* What is waiting on the machine, and what has been abandoned by it. Staff read
   this to see whether the screener is healthy — not to approve anything. */
create or replace view tmz_agent_backlog
  with (security_invoker = true) as
  select p.id, p.community_id, p.year, p.created_at,
         p.rescreen_attempts,
         case
           when p.needs_rescreen and p.rescreen_attempts < 5 then 'waiting for the screener'
           when p.needs_rescreen then 'the screener never answered'
           when p.agent_decision = 'publish' and p.public_path is null then 'waiting to be placed'
           else 'settled'
         end as state,
         (select m.reasons from tmz_moderation m
           where m.photo_id = p.id and m.pass = 'final'
           order by m.decided_at desc limit 1) as why
    from tmz_photo p
   where p.status = 'pending';

comment on view tmz_agent_backlog is
  'Photographs the agent has not settled. A health check on the screener, not an approval queue — nothing here is waiting for a person.';

revoke all on tmz_agent_backlog from anon;
grant select on tmz_agent_backlog to authenticated;
