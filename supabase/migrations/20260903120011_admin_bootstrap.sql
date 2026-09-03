-- The very first back-office user has nobody to promote them to admin, so
-- their profile row would land as 'contributor' and refuse them entry. This
-- trigger promotes a hard-coded list of bootstrap emails to admin on insert.
-- Add or remove emails here as the team grows; other users stay
-- 'contributor' and must be promoted manually by an existing admin.

create or replace function tmz_bootstrap_admin() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  my_email text;
begin
  select email into my_email from auth.users where id = new.id;
  if lower(coalesce(my_email, '')) in ('hagai.rettig@gmail.com') then
    new.role := 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists tmz_app_user_bootstrap on tmz_app_user;
create trigger tmz_app_user_bootstrap
  before insert on tmz_app_user
  for each row execute function tmz_bootstrap_admin();
