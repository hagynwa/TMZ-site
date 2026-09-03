begin;
select plan(6);

-- on conflict: 'na' may already exist from supabase/seed.sql on a real database
insert into tmz_region (id, sort) values ('na', 1) on conflict (id) do nothing;
insert into tmz_region_tr (region_id, lang, name) values
  ('na', 'en', 'North America'), ('na', 'he', 'צפון אמריקה')
  on conflict (region_id, lang) do nothing;

insert into tmz_community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111', 'memphis', 'na', 35.15, -90.05, 2001);
insert into tmz_community_tr (community_id, lang, name) values
  ('11111111-1111-1111-1111-111111111111', 'en', 'Memphis'),
  ('11111111-1111-1111-1111-111111111111', 'he', 'ממפיס');

insert into tmz_photo (community_id, year, storage_path, status) values
  ('11111111-1111-1111-1111-111111111111', 2007, 'a.jpg', 'approved'),
  ('11111111-1111-1111-1111-111111111111', 2007, 'b.jpg', 'approved'),
  ('11111111-1111-1111-1111-111111111111', 2009, 'c.jpg', 'approved'),
  ('11111111-1111-1111-1111-111111111111', 2010, 'd.jpg', 'pending');

select is((tmz_map_payload('en') -> 'communities' -> 0 ->> 'name'), 'Memphis',
          'the map payload carries names resolved into the requested language');

select is((tmz_map_payload('he') -> 'communities' -> 0 ->> 'name'), 'ממפיס',
          'the same call in Hebrew returns the Hebrew name');

select is((tmz_map_payload('en') -> 'communities' -> 0 -> 'years' ->> '2007')::int, 2,
          'the per-year counts are in the payload, so the coverage bars need no second query');

select is((tmz_map_payload('en') -> 'communities' -> 0 -> 'years' ->> '2010'), null,
          'a pending photograph does not appear in the counts');

select is((tmz_map_payload('en') -> 'regions' -> 0 ->> 'name'), 'North America',
          'regions resolve through the same fallback chain');

-- the year screen
insert into tmz_person (id, slug) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'yonatan');
insert into tmz_person_tr (person_id, lang, display_name)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'en', 'Yonatan L.');
insert into tmz_tenure (person_id, community_id, role, start_year, end_year)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          '11111111-1111-1111-1111-111111111111', 'rosh_kollel', 2001, 2009);

select is(
  (tmz_year_payload('memphis', 2007, 'en') -> 'roster' -> 0 ->> 'person'),
  'Yonatan L.',
  'the year payload returns whoever was serving that year'
);

select * from finish();
rollback;
