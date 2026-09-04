/* Where a WhatsApp conversation's memory lives.

   The language was being stored on tmz_submission, which only exists once
   someone has sent a photograph. So the common opening — "שלום, יש לי תמונות
   ישנות", then the picture — could not work: at the moment of the greeting
   there was no row to write to, and the photograph that followed was answered
   in English.

   One row per sender, written on the first message of any kind. It is also the
   obvious home for anything else the agent needs to remember about someone
   between messages. */

create table tmz_wa_contact (
  ref         text primary key,           -- 'wa:<phone>', the same key used elsewhere
  lang        tmz_lang_code,
  display_name text,
  is_test     boolean not null default false,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

comment on table tmz_wa_contact is
  'Per-sender state for the WhatsApp agent. Not public: no policy grants access, and only the service role reads it.';

alter table tmz_wa_contact enable row level security;
revoke all on table tmz_wa_contact from anon, authenticated;

/* The console cleans up after itself, and its contacts are part of that. */
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

  delete from tmz_wa_contact where is_test and ref = p_ref;

  return query select ph, sb;
end;
$$;

revoke all on function tmz_sim_reset(text) from public, anon, authenticated;
