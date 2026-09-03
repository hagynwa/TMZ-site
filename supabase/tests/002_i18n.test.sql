begin;
select plan(5);

insert into tmz_region (id) values ('zz');
insert into tmz_region_tr (region_id, lang, name) values ('zz', 'en', 'Testland');

insert into tmz_community (id, slug, region_id, lat, lon, founded_year)
  values ('11111111-1111-1111-1111-111111111111', 'memphis', 'zz', 35.15, -90.05, 2001);

insert into tmz_community_tr (community_id, lang, name) values
  ('11111111-1111-1111-1111-111111111111', 'en', 'Memphis'),
  ('11111111-1111-1111-1111-111111111111', 'he', 'ממפיס');

select is(tmz_community_name('11111111-1111-1111-1111-111111111111', 'he'), 'ממפיס',
          'returns the requested language when it exists');

select is(tmz_community_name('11111111-1111-1111-1111-111111111111', 'fr'), 'Memphis',
          'falls back to English when the requested locale is missing');

delete from tmz_community_tr
  where community_id = '11111111-1111-1111-1111-111111111111' and lang = 'en';

select is(tmz_community_name('11111111-1111-1111-1111-111111111111', 'fr'), 'ממפיס',
          'falls back to any translation left when English is gone too');

select is(tmz_community_name('22222222-2222-2222-2222-222222222222', 'en'), null,
          'an unknown community returns null instead of erroring');

-- the back office needs to know what is still missing
select is(
  (select count(*)::int from tmz_translation_gaps
   where entity_id = '11111111-1111-1111-1111-111111111111'),
  5,
  'the coverage view reports the five locales still untranslated'
);

select * from finish();
rollback;
