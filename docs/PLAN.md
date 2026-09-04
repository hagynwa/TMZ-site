# Torah MiTzion 30 — Master Plan

Living status file. Update the checkboxes as work lands. Read this first in any
new session to know where things stand.

**What this is:** a photo archive for Torah MiTzion's 30th anniversary (1996–2026),
gathering photographs from every community across all thirty years.

**Stack:** Supabase (Postgres, Auth, Storage) · Railway (web + worker) · Redis
(cache, queue, rate limit) · Gemini (moderation, metadata) · HookMyApp (WhatsApp)

---

## Settled decisions

These are locked. Do not relitigate without the user.

| # | Decision | Consequence |
|---|----------|-------------|
| 1 | **Direction A — "Light from Zion"** | Dark, cinematic. Schematic world map re-centred on Jerusalem, arcs radiating out. B and C rejected. |
| 2 | **Schematic, not geographic, projection** | Longitude/latitude stretched piecewise so populated bands get room. Distances are for legibility, not scale. |
| 3 | **No fixed number of communities** | Nothing hand-placed. Label slots, clustering and region views are all computed. Adding a community = a row with lat/lon. |
| 4 | **Six languages from day one** | EN, HE, RU, FR, DE, ES. Every user-facing string on every entity is translatable with a fallback chain. |
| 5 | **Hebrew mirrors the layout, not the map** | Chrome flips RTL; geography does not. Map-adjacent chrome is placed by where the map is empty, not by reading direction. |
| 6 | **`person` is a global entity** | A shaliach in Memphis 2003 may be Rosh Kollel in Chicago 2018. Surfacing that thread is a feature, not an accident. |
| 7 | **Two people-layers per community-year** | Rosh Kollel (multi-year tenure, shown *with his household*) and the shlichim cohort (~1 year rotations). The year screen is a yearbook page. |
| 8 | **The gap is the product** | A year with no photographs is shown, not hidden. "We know who was here" is the call to action. |

---

## Phases

### ✅ Phase 0 — Design (done)

- [x] Research Torah MiTzion; establish 1996 founding, four regions, shlichim model
- [x] Three design directions explored; A chosen
- [x] Schematic Jerusalem-centred projection, land stipple, arcs
- [x] Auto label placement (8 candidate slots, greedy, collision-free)
- [x] Screen-space clustering + drill-down that terminates
- [x] Hebrew RTL board proving the layout mirroring
- [x] Year/roster screen (Rosh Kollel + household + cohort + photos)
- [x] Design canvas published → `docs/canvas.html`

### ✅ Phase 1 — Live mockup (done)

- [x] Static site, hash routing (`#/`, `#/c/<id>/<year>`, `#/contribute`)
- [x] Map view with fly-to, clustering, zoom-out history
- [x] Community/year view with the year rail
- [x] Contribute page (form shell only)
- [x] All six languages switchable live; Cyrillic fallback face (PT Serif/PT Sans)
- [x] Torah MiTzion logo, reversed for the dark ground
- [x] Deployed → https://hagynwa.github.io/TMZ-site/

**Known limits of the mockup:** all data is invented and generated client-side;
no persistence; the contribute form does not submit; no auth; no back office.

### 🟨 Phase 2 — Backend and database ← **CURRENT**

Detailed plan: [`superpowers/plans/2026-09-03-backend-schema.md`](superpowers/plans/2026-09-03-backend-schema.md)

Live on a **shared** Supabase project (`xuoxkmwtdascazutoaxs`, ~46 tables from
other unrelated apps) — every object carries the `tmz_` prefix, confirmed
collision-free. `.env.supabase` (gitignored) holds the project ref, URL,
service-role key and a management-API access token. No `SUPABASE_DB_URL`
password was ever obtained or needed — migrations run via
`supabase db push --linked` using the access token; ad-hoc verification runs
through `https://api.supabase.com/v1/projects/<ref>/database/query`.

- [x] Schema: regions, communities, people, tenures, photos, events, moderation, users (10 migrations, all pushed)
- [x] Translation tables + fallback resolution (`tmz_community_name`, `tmz_region_name`, `tmz_person_name`)
- [x] Storage buckets (`tmz-photo-originals` private, `tmz-photo-public` public)
- [x] RLS policies — public read of approved/published, authenticated submit, staff (`tmz_is_staff()`) full access
- [x] Grants hardening (migration 10) — see incident note below
- [x] Reference seed applied (4 regions × 6 langs, 12 event types × 2 langs)
- [x] 5 pgTAP test files, 34 assertions, all passing on the live linked DB
- [x] `scripts/import-real.mjs` + `scripts/real-data.json` — the **real** 23 communities, 231 people, 236 tenures, taken from torahmitzion.org's own community pages (this replaced the 49 invented ones; `--prune` removed them)
- [x] API layer the front end reads instead of `data.js` — `docs/api.js` calls `tmz_map_payload` / `tmz_year_payload`; `data.js` survives only behind `?demo=1`
- [x] `scripts/import-translations.mjs` + `translations.json` / `people-translations.json` — see *Translations* below
- [x] `tmz_year_payload` returns each tenure's `id`, so a household groups under its own head rather than under whoever is Rosh Kollel (migration `20260904160001`)

**Incident, fixed same session:** this shared project carries a pre-existing
`ALTER DEFAULT PRIVILEGES` rule (from whichever app was set up first) that
grants **every** new public-schema table full `DELETE/INSERT/UPDATE/TRUNCATE`
for both `anon` and `authenticated`, regardless of what a migration itself
grants. Discovered via a live pgTAP assertion that unexpectedly passed with
"no exception" on an anon UPDATE. RLS was already filtering rows correctly
(confirmed: the update matched zero rows), but **`TRUNCATE` is not filtered by
row-level security at all** — any authenticated contributor could have run
`TRUNCATE tmz_photo`. Migration `20260903120010_grants_hardening.sql` revokes
the unwanted verbs back down to intent on every `tmz_` table and sets a
role-scoped `ALTER DEFAULT PRIVILEGES` so future `tmz_` tables in this session
don't reinherit it. The other apps' own tables and their default-privilege
rule were left untouched — out of scope and not this project's to fix.

### 🟨 Phase 3 — Back office (CMS) ← **CURRENT**

Static app at `/docs/admin/`, no build step. Talks to Supabase directly with
the anon key; RLS does the enforcement. `hagai.rettig@gmail.com` is auto-promoted
to `admin` on first sign-in via a trigger (migration 11); everyone else lands
as `contributor` and sees an "access pending" screen until an admin promotes
them.

- [x] Google OAuth (was already enabled on the shared project; added the GitHub Pages redirect URL to `uri_allow_list`)
- [x] First-run intake: "how did you connect to Torah MiTzion?" writes to `tmz_app_user`
- [x] Roles: contributor / translator / editor / admin, checked in shell
- [x] CRUD for communities (with per-locale translations and coverage indicators)
- [x] CRUD for people (with per-locale display names)
- [x] Translation coverage — six coloured cells per row, missing locales flagged
- [x] Moderation queue (approve / reject a pending photograph)
- [ ] Tenure editor on the person page (add/remove community assignments)
- [ ] Photo detail: caption, event type, people tagging
- [ ] Bulk translation view — "everything untranslated in Russian"

### 🟨 Phase 4 — Upload landing page ← **CURRENT**

Live at `#/contribute`. The browser prepares the image (preview, downscale over
2200px, dHash) and posts it to the `tmz-upload` edge function, which holds the
Gemini key, writes storage with the service role, and inserts the row. Nothing
in that path can publish a photograph.

**Deviation from the stated stack, on purpose:** this runs as a Supabase edge
function rather than on Railway. It is a short request living next to the
database and storage, with no long-lived process to justify a second deploy
target. Railway still earns its place in phase 5, where the WhatsApp webhook
has to stay up.

- [x] Public upload with metadata capture (community, year, people, occasion, contributor)
- [x] Gemini screening — nudity, violence, advertising, irrelevance; also guesses decade, setting, people count and event type to save the reviewer work
- [x] Duplicate detection — dHash client-side, Hamming distance in Postgres, caught before storage
- [x] Rate limiting — 20/hour per hashed IP
- [x] **Gemini key set** (shared with `gifted_app` — disconnecting one breaks the other). Model is `gemini-3.6-flash`: `gemini-2.5-flash` answers 404 for keys issued after its retirement, and the API's own error names the replacement.
- [x] Prompt calibrated against both ends — a grainy faded scan passes, an advertisement is refused with reasons. **This matters:** the first prompt refused a picture for not being a "real photograph", which would have rejected exactly the 1996-era scans and photocopies the archive most needs.
- [ ] Redis — deferred. The limiter is one Postgres function; swapping the body is the whole change, and a table is honest until there is traffic that needs faster.
- [ ] Image derivatives into `tmz-photo-public` on approval (originals stay private)

### 🟨 Phase 5 — WhatsApp collection agent

Also an edge function (`tmz-whatsapp`), for the same reason as the upload path:
HookMyApp forwards a webhook, so this is request/response, not a process that
needs to stay up. Deployed with `--no-verify-jwt` because HookMyApp does not
carry a Supabase JWT — the HMAC signature is the gate instead, and an unsigned
POST gets 401, a GET without the verify token gets 403. Both confirmed live.

- [x] Webhook receiver + HMAC verification over the raw bytes
- [x] Answers 200 immediately, works in a microtask — a slow Gemini call cannot trigger Meta's retry and duplicate a photograph
- [x] Gemini screens the image and parses the free-text reply in any language and any order
- [x] Conversation is thin on purpose: the photograph is accepted first, questions follow. Someone going through a shoebox sends five in a row.
- [x] Replies in EN/HE/RU; other locales fall back to English
- [x] Writes straight into the same moderation queue as the upload page
- [ ] **Blocked on a human step:** `hookmyapp login` and `hookmyapp channels connect whatsapp` both open a browser flow that cannot be automated. After connecting, set `WEBHOOK_HMAC_SECRET`, `VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` as function secrets and point the channel webhook at `https://xuoxkmwtdascazutoaxs.supabase.co/functions/v1/tmz-whatsapp`. Until then the function refuses everything, which is the correct default.

### 🟨 Phase 6 — Campaign dashboard

- [x] Coverage grid — every community × every year it was open, one cell each. 903 cells, all empty today; that is the campaign's real starting line.
- [x] Intake metrics by source and status, contributors and auto-rejections over a rolling window
- [ ] Per-community outreach targets and contributor leaderboard

---

## Open questions

| Question | Blocks | Status |
|----------|--------|--------|
| Does the Hebrew timeline run right-to-left (oldest on the right)? | Phase 3 UI | **Waiting on client** |
| Is there an official reversed/mono Torah MiTzion logo? | Polish | **Waiting on client** |
| Who moderates? One central team or per-community editors? | Phase 3 roles | **Waiting on client** |
| WhatsApp number — new or existing? | Phase 5 | **Waiting on client** |

---

## Translations

Six locales, resolved per field by a fallback chain (requested → `en` → any).
UI strings live in `docs/i18n.js` and are complete in all six. Entity names live
in `*_tr` tables and are now:

| Table | en | he | ru | fr | de | es |
|-------|----|----|----|----|----|-----|
| `tmz_region_tr` | 4 | 4 | 4 | 4 | 4 | 4 |
| `tmz_community_tr` | 23 | 23 | 23 | 23 | 23 | 23 |
| `tmz_event_type_tr` | 12 | 12 | 12 | 12 | 12 | 12 |
| `tmz_institution_tr` | 25 | 25 | 25 | — | — | — |
| `tmz_person_tr` | 231 | 231 | 9 | — | — | — |

The em-dashes are deliberate, not a backlog. **A Latin-script proper noun is not
translated between Latin-script locales** — a shaliach called Amichai Frei is
called Amichai Frei in French, and writing his name into `fr`, `de` and `es`
would create three copies that silently go stale the day the English spelling is
corrected. The fallback chain already returns the right string. Community names
and countries *are* filled in all six, because they are headline elements and a
half-empty row there reads as broken rather than as deliberate. Russian is filled
wherever the script genuinely changes.

Hebrew person names are the least like a translation: for the Israeli shlichim
the Hebrew is the **original** and the site's English is a transliteration, so
these restore a spelling rather than invent one. Twelve names could not be
recovered with confidence — mostly diaspora rabbis whose surname has no single
conventional Hebrew form — and are listed under `uncertain` in
`scripts/people-translations.json` for someone who knows the family to confirm.

Merged while importing: **Rabbi Binyamin Tabory z"l** existed twice, because
torahmitzion.org spells him both *Tabori* and *Tabory* on different pages. He is
the founding Rosh Kollel of Cleveland, 1994. The importer moves the duplicate's
tenures and deletes the empty row; the pair is recorded under `duplicates`.

Still open: `tmz_photo_tr` is empty, which is correct — no photograph has a
caption yet because no photograph has been approved yet.

## Environment notes

- The Supabase MCP server in this workspace **requires authentication** before its
  tools work. Authorize it via claude.ai connector settings or `claude mcp` in an
  interactive session; until then use the `supabase` CLI over Bash.
- GitHub: `hagynwa/TMZ-site`, public, Pages served from `/docs` on `master`.
- `.claude/launch.json` is gitignored — it points at a machine-local temp path.
