/* Automatic publishing.
 *
 * Until now a photograph reached the site only when a person clicked Approve.
 * The agent now does that itself, and the columns below exist so that decision
 * stays legible after the fact: who published a photograph, when, on what
 * grounds, and how to find everything one bad run let through.
 *
 * Nothing here weakens the public read rule. The site still serves only
 * status='approved' with a public_path, and both are still set by the same
 * writes a human made — the difference is who makes them. */

alter table tmz_photo
  add column published_by text check (published_by in ('agent', 'staff'));
-- published_at already exists on this table.

comment on column tmz_photo.published_by is
  'Who moved this into the public bucket. Lets staff review or reverse a run of agent decisions as a group.';

create index tmz_photo_published_idx on tmz_photo (published_by, published_at desc)
  where published_by is not null;

/* Screening is now a gate rather than a hint, so its record has to say which
   pass produced a verdict and what the agent did about it. */
alter table tmz_moderation
  add column pass     text,
  add column decision text;

comment on column tmz_moderation.pass is
  'Which screening pass this row records: describe, judge, or confirm.';
comment on column tmz_moderation.decision is
  'What the agent did: published, held, or rejected.';

/* What the agent remembers about a sender between messages. Community and year
   travel with the person, not the photograph: someone emptying a shoebox says
   "Memphis, 2003" once and then sends eleven pictures. */
alter table tmz_wa_contact
  add column community_id  uuid references tmz_community(id) on delete set null,
  add column year          integer check (year between 1990 and 2200),
  add column strikes       integer not null default 0,
  add column blocked_until timestamptz;

comment on column tmz_wa_contact.strikes is
  'Rejected sends. Publishing without a human in the loop means the only defence against someone probing the screener is to stop answering them.';

/* Publishing without a human means a mistake is public, so the reverse has to
   be one call rather than a hunt through three tables. Staff only. */
create or replace function tmz_unpublish(p_photo_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tmz_is_staff() then
    raise exception 'staff only';
  end if;

  update tmz_photo
     set status = 'rejected', public_path = null,
         published_by = null, published_at = null
   where id = p_photo_id;

  insert into tmz_moderation (photo_id, model, verdict, pass, decision, reasons, reviewed_by)
  values (p_photo_id, 'human', 'rejected', 'review', 'rejected',
          array[coalesce(p_reason, 'unpublished by staff')], auth.uid());
end;
$$;

revoke all on function tmz_unpublish(uuid, text) from public, anon;
grant execute on function tmz_unpublish(uuid, text) to authenticated;

/* Everything the agent put on the site, newest first — the review queue that
   replaces the approval queue. Reading it is a staff job; the public payloads
   do not go anywhere near it. */
create or replace view tmz_agent_published as
  select p.id, p.community_id, p.year, p.public_path, p.published_at,
         p.submitter_ref, p.event_type_id,
         (select jsonb_agg(jsonb_build_object(
            'pass', m.pass, 'decision', m.decision, 'model', m.model,
            'scores', m.scores, 'reasons', m.reasons) order by m.decided_at)
          from tmz_moderation m where m.photo_id = p.id) as screening
    from tmz_photo p
   where p.published_by = 'agent'
   order by p.published_at desc;

revoke all on tmz_agent_published from anon;
grant select on tmz_agent_published to authenticated;
