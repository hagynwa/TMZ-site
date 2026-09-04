/* Support for the WhatsApp test console.

   The console drives the real tmz-whatsapp function — same screening, same
   parsing, same database writes — so its photographs land in the real archive
   alongside genuine ones. They can never reach the public site (that requires
   status='approved' AND a public_path, and both are a reviewer's doing), but a
   reviewer working through the queue would have no way to tell a test from a
   grandmother's shoebox. So they say so. */

alter table tmz_submission
  add column is_test boolean not null default false;

comment on column tmz_submission.is_test is
  'Sent through the WhatsApp test console rather than by a real contributor.';

/* Lets the console clean up after itself. Without this, testing the intake
   means slowly filling the moderation queue with pictures of nothing, and the
   only way out is a staff member deleting rows by hand.

   Scoped to one sender and to test submissions only: it cannot touch a real
   contribution even if called with a real contributor's number, because
   is_test is set by the function and never by the caller. */
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
    where s.is_test and p.submitter_ref = p_ref
  ), del as (
    delete from tmz_photo where id in (select id from doomed) returning 1
  ) select count(*)::integer into ph from del;

  with del as (
    delete from tmz_submission
    where is_test and ip_hash = p_ref
      and not exists (select 1 from tmz_photo p where p.submission_id = tmz_submission.id)
    returning 1
  ) select count(*)::integer into sb from del;

  return query select ph, sb;
end;
$$;

/* Only the service role calls this — the edge function, holding the console's
   own token. Nothing reachable from a browser with the anon key. */
revoke all on function tmz_sim_reset(text) from public, anon, authenticated;
