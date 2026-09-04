/* Two columns the automatic path needs.
 *
 * derived_path: the re-encoded, resized copy, kept in the PRIVATE bucket.
 * A photograph is cleaned at the moment it arrives, but it is often not
 * publishable yet — the agent knows it is safe and does not yet know which
 * community or year it belongs to, and a photograph with no year has nowhere
 * to appear. Writing the derivative straight into the public bucket to wait
 * would mean a live URL for something not yet cleared for the site, so it
 * waits in the private one and is copied across the moment it is placed.
 *
 * agent_decision: what screening concluded, so the answer that arrives ten
 * minutes later — "Memphis, 2003" — can publish the photograph without
 * screening it a second time, and so a photograph that was only ever held can
 * never be published by an answer alone. */

alter table tmz_photo
  add column derived_path   text,
  add column agent_decision text check (agent_decision in ('publish', 'hold', 'reject'));

comment on column tmz_photo.derived_path is
  'Sanitised, resized JPEG in tmz-photo-originals. Copied to tmz-photo-public on publication.';
comment on column tmz_photo.agent_decision is
  'Screening''s conclusion, kept so placement arriving later can act on it without re-screening.';
