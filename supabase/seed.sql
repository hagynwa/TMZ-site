-- Reference data only. Communities and people are loaded by
-- scripts/seed-communities.mjs so the placeholder set can be swapped for the
-- client's real list without touching this file.

insert into tmz_region (id, sort) values
  ('na', 1), ('la', 2), ('eu', 3), ('oc', 4)
on conflict (id) do nothing;

insert into tmz_region_tr (region_id, lang, name) values
  ('na','en','North America'),     ('na','he','צפון אמריקה'),
  ('na','ru','Северная Америка'),  ('na','fr','Amérique du Nord'),
  ('na','de','Nordamerika'),       ('na','es','América del Norte'),
  ('la','en','Latin America'),     ('la','he','אמריקה הלטינית'),
  ('la','ru','Латинская Америка'), ('la','fr','Amérique latine'),
  ('la','de','Lateinamerika'),     ('la','es','América Latina'),
  ('eu','en','Europe & Asia'),     ('eu','he','אירופה ואסיה'),
  ('eu','ru','Европа и Азия'),     ('eu','fr','Europe et Asie'),
  ('eu','de','Europa & Asien'),    ('eu','es','Europa y Asia'),
  ('oc','en','Africa & Oceania'),  ('oc','he','אפריקה ואוקיאניה'),
  ('oc','ru','Африка и Океания'),  ('oc','fr','Afrique et Océanie'),
  ('oc','de','Afrika & Ozeanien'), ('oc','es','África y Oceanía')
on conflict (region_id, lang) do nothing;

insert into tmz_event_type (id, sort) values
  ('simchat_torah', 1), ('shabbaton', 2), ('morning_seder', 3),
  ('yom_haatzmaut', 4), ('chanukah', 5), ('purim', 6),
  ('opening_night', 7), ('melave_malka', 8), ('shavuot', 9),
  ('farewell', 10), ('chavruta', 11), ('youth', 12)
on conflict (id) do nothing;

insert into tmz_event_type_tr (event_type_id, lang, name) values
  ('simchat_torah','en','Simchat Torah hakafot'), ('simchat_torah','he','הקפות שמחת תורה'),
  ('shabbaton','en','Community shabbaton'),       ('shabbaton','he','שבתון קהילתי'),
  ('morning_seder','en','Morning seder'),         ('morning_seder','he','סדר בוקר'),
  ('yom_haatzmaut','en','Yom Ha''atzmaut'),       ('yom_haatzmaut','he','יום העצמאות'),
  ('chanukah','en','Chanukah night'),             ('chanukah','he','ליל חנוכה'),
  ('purim','en','Purim seudah'),                  ('purim','he','סעודת פורים'),
  ('opening_night','en','Opening night'),         ('opening_night','he','ערב פתיחה'),
  ('melave_malka','en','Melave Malka'),           ('melave_malka','he','מלווה מלכה'),
  ('shavuot','en','Shavuot night learning'),      ('shavuot','he','ליל שבועות'),
  ('farewell','en','Farewell dinner'),            ('farewell','he','ארוחת פרידה'),
  ('chavruta','en','Chavruta learning'),          ('chavruta','he','לימוד בחברותא'),
  ('youth','en','Youth shabbaton'),               ('youth','he','שבתון נוער')
on conflict (event_type_id, lang) do nothing;
