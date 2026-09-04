/* Two things the test console found in its first full run.

   1. tmz_sim_reset matched submitter_ref exactly. But answering the agent's
      question appends the answer to that field — "wa:15550000009" becomes
      "wa:15550000009 · אבא שלי מימין · ערב פורים" — so reset silently cleaned
      up only the photographs nobody had said anything about. Match the prefix,
      which is what the column is: an identity followed by whatever was learned.

   2. The agent has nowhere to remember which language someone writes in. It
      answers a photograph in English even when the sender has been writing in
      Hebrew all along, because a photograph carries no text to detect. The
      submission is the right place for it — one row per send, already keyed to
      the sender. */

alter table tmz_submission
  add column lang tmz_lang_code;

comment on column tmz_submission.lang is
  'The language this contributor was writing in, so a photograph with no caption can still be answered in it.';

create index tmz_submission_ip_idx on tmz_submission (ip_hash, created_at desc);

create or replace function tmz_sim_reset(p_ref text)
returns table (photos integer, submissions integer)
language plpgsql security definer set search_path = public as $$
declare
  ph integer;
  sb integer;
begin
  with doomed as (
    select p.id from tmz_photo p
    join tmz_submission s on s.id = p.submission_id
    where s.is_test and p.submitter_ref like p_ref || '%'
  ), del as (
    delete from tmz_photo where id in (select id from doomed) returning 1
  ) select count(*)::integer into ph from del;

  with del as (
    delete from tmz_submission
    where is_test and ip_hash like p_ref || '%'
      and not exists (select 1 from tmz_photo p where p.submission_id = tmz_submission.id)
    returning 1
  ) select count(*)::integer into sb from del;

  return query select ph, sb;
end;
$$;

revoke all on function tmz_sim_reset(text) from public, anon, authenticated;
