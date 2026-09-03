-- Reference and published content is world-readable. Nothing else is.
-- Grants let the role reach the table at all; the policies below decide the rows.
grant usage on schema public to anon, authenticated;
grant select on tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
                tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
                tmz_tenure, tmz_event_type, tmz_event_type_tr,
                tmz_photo, tmz_photo_tr, tmz_photo_person
  to anon, authenticated;
grant insert on tmz_photo to authenticated;
grant select, insert, update on tmz_app_user to authenticated;
grant select, insert, update, delete on
  tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
  tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
  tmz_tenure, tmz_event_type, tmz_event_type_tr,
  tmz_photo, tmz_photo_tr, tmz_photo_person, tmz_moderation
  to authenticated;


alter table tmz_region          enable row level security;
alter table tmz_region_tr       enable row level security;
alter table tmz_community       enable row level security;
alter table tmz_community_tr    enable row level security;
alter table tmz_person          enable row level security;
alter table tmz_person_tr       enable row level security;
alter table tmz_institution     enable row level security;
alter table tmz_institution_tr  enable row level security;
alter table tmz_tenure          enable row level security;
alter table tmz_event_type      enable row level security;
alter table tmz_event_type_tr   enable row level security;
alter table tmz_photo           enable row level security;
alter table tmz_photo_tr        enable row level security;
alter table tmz_photo_person    enable row level security;
alter table tmz_moderation      enable row level security;
alter table tmz_app_user        enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'tmz_region','tmz_region_tr','tmz_community','tmz_community_tr',
    'tmz_person','tmz_person_tr','tmz_institution','tmz_institution_tr',
    'tmz_tenure','tmz_event_type','tmz_event_type_tr'
  ] loop
    execute format(
      'create policy %I on %I for select using (true)', tbl || '_public_read', tbl);
    execute format(
      'create policy %I on %I for all to authenticated
       using (tmz_is_staff()) with check (tmz_is_staff())', tbl || '_staff_write', tbl);
  end loop;
end $$;

-- A photograph becomes public only once it is approved.
create policy tmz_photo_public_read on tmz_photo
  for select using (status = 'approved' or tmz_is_staff());

-- Anyone signed in may submit, but never straight into the archive.
create policy tmz_photo_submit on tmz_photo
  for insert to authenticated
  with check (status = 'pending' and submitted_by = auth.uid());

create policy tmz_photo_staff_write on tmz_photo
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

create policy tmz_photo_tr_read on tmz_photo_tr for select using (
  exists (select 1 from tmz_photo p
          where p.id = photo_id and (p.status = 'approved' or tmz_is_staff())));
create policy tmz_photo_tr_staff on tmz_photo_tr
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

create policy tmz_photo_person_read on tmz_photo_person for select using (
  exists (select 1 from tmz_photo p
          where p.id = photo_id and (p.status = 'approved' or tmz_is_staff())));
create policy tmz_photo_person_staff on tmz_photo_person
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

-- Moderation history is staff only.
create policy tmz_moderation_staff on tmz_moderation
  for all to authenticated using (tmz_is_staff()) with check (tmz_is_staff());

-- A user reads and edits their own profile; staff read all.
create policy tmz_app_user_self on tmz_app_user
  for select to authenticated using (id = auth.uid() or tmz_is_staff());
create policy tmz_app_user_self_write on tmz_app_user
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy tmz_app_user_insert_self on tmz_app_user
  for insert to authenticated with check (id = auth.uid());
