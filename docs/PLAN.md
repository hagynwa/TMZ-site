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
- [ ] `scripts/seed-communities.mjs` — port `docs/data.js`'s 49 placeholder communities in
- [ ] API layer the front end reads instead of `data.js` (`tmz_map_payload`, `tmz_year_payload` exist and are tested; front end not yet wired to them)

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

### ⬜ Phase 3 — Back office (CMS)

- [ ] Auth: Google OAuth + "how did you connect to Torah MiTzion?" on first sign-in
- [ ] Roles: admin, community editor, translator, viewer
- [ ] CRUD: communities, years, people, tenures, photos, events
- [ ] Translation coverage view — what is missing, per language
- [ ] Moderation queue (approve / reject / request detail)

### ⬜ Phase 4 — Upload landing page

- [ ] Public upload with metadata capture
- [ ] Gemini screening: nudity, ads, violence, off-topic
- [ ] Duplicate detection (perceptual hash)
- [ ] Redis rate limiting and job queue

### ⬜ Phase 5 — WhatsApp collection agent

- [ ] HookMyApp channel (`hookmyapp channels connect whatsapp`)
- [ ] Webhook receiver + HMAC verification
- [ ] Gemini conversational agent: screens, asks for community/year/people/event
- [ ] Six-language conversation
- [ ] Writes straight into the moderation queue

### ⬜ Phase 6 — Campaign dashboard

- [ ] Coverage grid — every community × every year, holes visible
- [ ] Intake metrics by source, language, community
- [ ] Contributor leaderboard; per-community outreach targets

---

## Open questions

| Question | Blocks | Status |
|----------|--------|--------|
| Real community list — how many, which, founding years, open/closed? | Seed data | **Waiting on client** |
| Does the Hebrew timeline run right-to-left (oldest on the right)? | Phase 3 UI | **Waiting on client** |
| Is there an official reversed/mono Torah MiTzion logo? | Polish | **Waiting on client** |
| Who moderates? One central team or per-community editors? | Phase 3 roles | **Waiting on client** |
| WhatsApp number — new or existing? | Phase 5 | **Waiting on client** |

---

## Environment notes

- The Supabase MCP server in this workspace **requires authentication** before its
  tools work. Authorize it via claude.ai connector settings or `claude mcp` in an
  interactive session; until then use the `supabase` CLI over Bash.
- GitHub: `hagynwa/TMZ-site`, public, Pages served from `/docs` on `master`.
- `.claude/launch.json` is gitignored — it points at a machine-local temp path.
