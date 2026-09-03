-- Torah MiTzion 30th-anniversary archive.
-- Every object in this project carries the tmz_ prefix so it can share a
-- Supabase project with unrelated work without collision.

-- pgTAP backs `supabase test db`. Harmless in production, but drop this line
-- from the production migration set if you would rather not ship it.
create extension if not exists pgtap with schema extensions;

-- The six languages the archive ships in. Adding a seventh is one ALTER TYPE.
create type tmz_lang_code as enum ('en', 'he', 'ru', 'fr', 'de', 'es');

-- What a person was doing at a community. 'spouse' and 'child' exist so a Rosh
-- Kollel's household is modelled as tenures too, not as a special-case blob.
create type tmz_tenure_role as enum
  ('rosh_kollel', 'shaliach', 'shlicha', 'spouse', 'child', 'staff');

create type tmz_photo_status as enum ('pending', 'approved', 'rejected', 'needs_info');
create type tmz_photo_source as enum ('web', 'whatsapp', 'import', 'admin');

-- Asked once, at first sign-in: how do you know Torah MiTzion?
create type tmz_connection_kind as enum
  ('shaliach', 'rosh_kollel', 'community_member', 'family', 'alumnus', 'staff', 'other');
