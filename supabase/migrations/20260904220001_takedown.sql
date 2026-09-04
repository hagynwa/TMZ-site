/* Taking a photograph down has to take the file down.
 *
 * Found while cleaning up after a test: deleting the row left the object in
 * the public bucket and its URL kept returning 200.
 *
 * The first attempt at a fix was a trigger deleting from storage.objects, and
 * Postgres refused it: "Direct deletion from storage tables is not allowed."
 * Which is the answer — files can only be removed through the Storage API, so
 * a takedown cannot live in SQL at all, and the tmz_unpublish function added
 * one migration ago was a half-takedown by construction. It nulled public_path
 * and left the file serving.
 *
 * So it goes, and the two callers that CAN reach the Storage API own this:
 * the back office (docs/admin/views.js already removes the object before it
 * clears public_path) and the edge function (tmz-whatsapp, for the test
 * console's reset). What SQL keeps is the audit note, which is all it was ever
 * able to do honestly. */

drop function if exists tmz_unpublish(uuid, text);

/* Records a takedown. The caller deletes the object first — this is the note
   that says it happened, not the thing that makes it happen. */
create or replace function tmz_record_takedown(p_photo_id uuid, p_reason text default null)
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

comment on function tmz_record_takedown is
  'Marks a photograph as taken down. Does NOT delete the file — SQL cannot; the caller must remove the storage object through the Storage API first.';

revoke all on function tmz_record_takedown(uuid, text) from public, anon;
grant execute on function tmz_record_takedown(uuid, text) to authenticated;
