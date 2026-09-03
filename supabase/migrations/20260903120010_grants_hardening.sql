-- This project is shared with other apps that already carry a broad
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated`.
-- That rule applies to every NEW table regardless of name, so each tmz_ table
-- was created with full DELETE/INSERT/UPDATE/TRUNCATE for both API roles —
-- confirmed by querying information_schema.role_table_grants after the first
-- push. RLS was still filtering rows correctly (verified: an anon UPDATE
-- affected zero rows), but TRUNCATE is not filtered by row-level security at
-- all, so any authenticated contributor could have emptied a table outright.
-- Revoke down to what each role is actually meant to have; RLS policies still
-- narrow the rows within whatever DML verbs remain granted.

revoke insert, update, delete, truncate, references, trigger on
  tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
  tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
  tmz_tenure, tmz_event_type, tmz_event_type_tr,
  tmz_photo, tmz_photo_tr, tmz_photo_person
  from anon;

revoke select, insert, update, delete, truncate, references, trigger on
  tmz_app_user, tmz_moderation
  from anon;

revoke truncate, references, trigger on
  tmz_region, tmz_region_tr, tmz_community, tmz_community_tr,
  tmz_person, tmz_person_tr, tmz_institution, tmz_institution_tr,
  tmz_tenure, tmz_event_type, tmz_event_type_tr,
  tmz_photo, tmz_photo_tr, tmz_photo_person, tmz_moderation, tmz_app_user
  from authenticated;

-- A view, so DML grants on it are inert anyway, but keep it staff-facing to
-- match its purpose: a translator or editor checking what is still missing.
revoke all on tmz_translation_gaps from anon, authenticated;

-- Set the default for THIS schema's future tmz_ tables to something sane, so
-- the next migration does not silently reinherit the ambient broad grant.
-- Scoped to the role that owns these migrations, not a schema-wide override,
-- so the other apps' own default-privilege rule is left untouched.
alter default privileges for role current_user in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
