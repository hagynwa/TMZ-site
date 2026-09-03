begin;
select plan(5);

insert into tmz_region (id) values ('zz');
insert into tmz_community (id, slug, region_id, lat, lon, founded_year) values
  ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001),
  ('33333333-3333-3333-3333-333333333333', 'chicago', 'zz', 41.88, -87.63, 1999);

insert into tmz_person (id, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'yonatan-l'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'michal-l');

-- The same person, two communities, two roles, years apart. This is the whole
-- reason person is global rather than nested under a community.
insert into tmz_tenure (id, person_id, community_id, role, start_year, end_year) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
   'shaliach', 1998, 1999),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   'rosh_kollel', 2001, 2009);

select is((select count(*)::int from tmz_tenure
           where person_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
          2, 'one person holds tenures at more than one community');

select throws_ok(
  $$ insert into tmz_tenure (person_id, community_id, role, start_year, end_year)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             '11111111-1111-1111-1111-111111111111', 'shaliach', 2010, 2005) $$,
  '23514', null, 'a tenure cannot end before it starts'
);

select is((select count(*)::int from tmz_tenure
           where community_id = '11111111-1111-1111-1111-111111111111'
             and 2007 between start_year and coalesce(end_year, 2200)),
          1, 'a year query finds the tenure spanning it');

-- the household hangs off the Rosh Kollel's own tenure
insert into tmz_tenure (person_id, community_id, role, start_year, end_year, household_of)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          '11111111-1111-1111-1111-111111111111', 'spouse', 2001, 2009,
          'dddddddd-dddd-dddd-dddd-dddddddddddd');

select is((select count(*)::int from tmz_tenure
           where household_of = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
          1, 'a household member attaches to the Rosh Kollel tenure');

-- removing the Rosh Kollel's tenure takes his household with it
delete from tmz_tenure where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
select is((select count(*)::int from tmz_tenure
           where community_id = '11111111-1111-1111-1111-111111111111'),
          0, 'deleting a tenure cascades to the household attached to it');

select * from finish();
rollback;
