begin;
select plan(4);

insert into tmz_region (id) values ('zz');
insert into tmz_community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001);
insert into tmz_photo (community_id, year, storage_path, status)
  values ('11111111-1111-1111-1111-111111111111', 2007, 'a.jpg', 'approved');
insert into tmz_photo (community_id, year, storage_path, status)
  values ('11111111-1111-1111-1111-111111111111', 2007, 'b.jpg', 'pending');
insert into tmz_photo (community_id, year, storage_path, status)
  values ('11111111-1111-1111-1111-111111111111', 2008, 'c.jpg', 'rejected');

set local role anon;

select is((select count(*)::int from tmz_photo), 1,
          'an anonymous reader sees approved photographs only');

select is((select count(*)::int from tmz_community), 1,
          'an anonymous reader sees communities');

select throws_ok(
  $$ update tmz_photo set status = 'approved' $$,
  null, null, 'an anonymous reader cannot approve a photograph'
);

-- the map payload runs as the caller, so an anon call must not leak pending work
select is(
  ((tmz_map_payload('en') -> 'communities' -> 0 ->> 'total')::int),
  1,
  'the map payload counts approved photographs only for an anonymous caller'
);

select * from finish();
rollback;
