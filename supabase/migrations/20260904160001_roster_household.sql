/* The year payload already returned household_of — the tenure a spouse or child
   hangs off — but never returned the tenures' own ids, so the front end could
   see that someone belonged to a household and not to whose. It grouped every
   spouse in the year under the Rosh Kollel, which put Ikrat Tannenbaum inside
   Rabbi Grunwald's family on the Memphis 2026 screen. She is married to Rabbi
   Tzvi Tannenbaum, who is standing three cards away.

   The fix is one field. household_of is only meaningful next to an id. */

create or replace function tmz_year_payload(community_slug text, yr integer,
                                            want tmz_lang_code default 'en')
returns jsonb language sql stable as $$
  with c as (select * from tmz_community where slug = community_slug)
  select jsonb_build_object(
    'community', (select jsonb_build_object(
        'id', c.slug, 'name', tmz_community_name(c.id, want),
        'region', tmz_region_name(c.region_id, want),
        'f', c.founded_year, 'c', coalesce(c.closed_year, 0)) from c),
    'year', yr,
    'roster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           t.id,
        'person',       tmz_person_name(t.person_id, want),
        'role',         t.role,
        'from',         t.start_year,
        'to',           t.end_year,
        'institution',  (select name from tmz_institution_tr it
                         where it.institution_id = t.institution_id
                         order by (it.lang = want) desc, (it.lang = 'en') desc limit 1),
        'household_of', t.household_of)
        order by t.role, t.start_year)
      from tmz_tenure t, c
      where t.community_id = c.id
        and yr between t.start_year and coalesce(t.end_year, 2200)
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ph.id, 'path', ph.public_path, 'taken_on', ph.taken_on,
        'venue', ph.venue, 'event', ph.event_type_id,
        'event_name', (select name from tmz_event_type_tr et
                       where et.event_type_id = ph.event_type_id
                       order by (et.lang = want) desc, (et.lang = 'en') desc limit 1),
        'people', (select count(*) from tmz_photo_person pp where pp.photo_id = ph.id))
        order by ph.taken_on nulls last)
      from tmz_photo ph, c
      where ph.community_id = c.id and ph.year = yr
        and ph.status = 'approved' and ph.public_path is not null
    ), '[]'::jsonb)
  );
$$;
