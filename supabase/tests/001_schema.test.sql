begin;
select plan(14);

-- enums
select has_type('tmz_lang_code');
select has_type('tmz_tenure_role');
select has_type('tmz_photo_status');
select has_type('tmz_photo_source');
select has_type('tmz_connection_kind');

-- tables
select has_table('tmz_region');
select has_table('tmz_community');
select has_table('tmz_community_tr');
select has_table('tmz_photo');
select has_table('tmz_moderation');

-- constraints that protect the data model
select throws_ok(
  $$ insert into tmz_community (slug, region_id, lat, lon, founded_year)
     values ('bad', 'zz', 999, 0, 2001) $$,
  null, null, 'a latitude outside -90..90 is rejected'
);

insert into tmz_region (id) values ('zz');

select throws_ok(
  $$ insert into tmz_community (slug, region_id, lat, lon, founded_year, closed_year)
     values ('bad2', 'zz', 40, -75, 2010, 2005) $$,
  '23514', null, 'a community cannot close before it opened'
);

insert into tmz_community (slug, region_id, lat, lon, founded_year)
  values ('testville', 'zz', 40.7, -74.0, 2001);
select is((select is_open from tmz_community where slug = 'testville'), true,
          'a community with no closed_year reads as open');

update tmz_community set closed_year = 2015 where slug = 'testville';
select is((select is_open from tmz_community where slug = 'testville'), false,
          'setting closed_year closes it, with no second field to keep in sync');

select * from finish();
rollback;
