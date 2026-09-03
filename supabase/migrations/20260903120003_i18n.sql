-- The fallback chain the whole six-language decision rests on: requested locale,
-- then English, then whatever exists. With 49 communities and six locales most
-- translations are missing most of the time, and the site must degrade to
-- English rather than render blank.

create or replace function tmz_community_name(cid uuid, want tmz_lang_code)
returns text language sql stable as $$
  select name from tmz_community_tr
  where community_id = cid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

create or replace function tmz_region_name(rid text, want tmz_lang_code)
returns text language sql stable as $$
  select name from tmz_region_tr
  where region_id = rid
  order by (lang = want) desc, (lang = 'en') desc, lang
  limit 1;
$$;

-- What is still untranslated, for the back-office coverage view.
create or replace view tmz_translation_gaps as
  select 'community' as entity, c.id::text as entity_id, c.slug as ref, l.lang
  from tmz_community c
  cross join (select unnest(enum_range(null::tmz_lang_code)) as lang) l
  where not exists (
    select 1 from tmz_community_tr t where t.community_id = c.id and t.lang = l.lang
  );
