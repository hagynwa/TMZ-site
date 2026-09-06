# Handover — moving the archive onto Torah MiTzion's own infrastructure

Written 2026-09-04. Companion to [`PLAN.md`](PLAN.md), which describes what the
system *is*; this describes how it changes owner.

**The client-facing half of this document is
[`handover-tasks.html`](handover-tasks.html)** — the same migration written as
eight numbered tasks for someone non-technical, in Hebrew, with the costs and
the reasoning behind each account. Send them that; this file is for whoever
does the work.

---

## Do this before the campaign launches, not after

**The archive currently holds zero photographs.** Every community, person and
tenure is in the database — 23, 231 and 236 of them — but not one picture has
been collected yet.

That makes this the cheapest migration that will ever be possible. Nothing is in
the storage buckets. No public URL has been printed on a poster or sent to a
community. No contributor has been told a WhatsApp number.

Migrate after the campaign starts and the same job means moving thousands of
files between buckets, rewriting every `public_path`, and either keeping the old
project alive as a redirect or breaking every link anyone has shared. Do it now
and the entire data move is one SQL dump of about 500 rows.

---

## Why this is worth doing beyond "the client should own it"

Two things are wrong today that the move fixes by itself.

**The database is shared.** The project (`xuoxkmwtdascazutoaxs`) also runs
unrelated applications. That project carries a pre-existing
`ALTER DEFAULT PRIVILEGES` granting every new public-schema table full
DELETE/INSERT/UPDATE/**TRUNCATE** to `anon` and `authenticated` — migration 10
revokes it for the `tmz_` tables, but the hazard is a property of the project,
and the next table anyone adds there inherits it again.

**The client's data is in a personal account.** The photographs of their
communities, the contributors' names and phone numbers, and the Google sign-ins
of their staff all sit behind personal credentials today.

---

## Where the free tier is enough, and where it is a trap

| | Free tier verdict | Recommendation | Cost |
|---|---|---|---|
| **Supabase** | **Trap.** Free projects are **paused after one week of inactivity** — an archive between campaign pushes goes quiet, and the site goes dark with it. 500 MB database, 1 GB file storage: roughly 300–500 photographs at the two copies each one keeps. | **Pro from day one.** Never paused, 8 GB database, 100 GB storage, daily backups. Storage past 100 GB is $0.021/GB. | **$25/mo** |
| **Gemini** | **Trap, for two reasons.** The quota (5–15 requests/min, ~1,000/day) is below one person emptying a shoebox — this has been returning `429` all day during testing. And on the free tier **your data may be used to improve Google's products**: these are photographs of real families and children at community events. | **Paid tier, card on file.** Screening is two calls per photograph on a Flash model; 5,000 photographs is a few dollars total. | **~$1–5/mo** |
| **Meta WhatsApp** | **Genuinely free, and not a trap.** This agent only ever *replies*. Replies inside the 24-hour window a contributor opens are **free with no monthly cap** — Meta removed the old 1,000-service-conversation limit in November 2024. The per-message fees introduced in July 2025 apply to *template* messages, which are business-initiated, which this never sends. | Direct to Meta. No messaging provider. Expect Meta to ask for a payment method on the business account anyway; the bill should stay at zero. | **$0** |
| **GitHub** | **Enough.** A public repository gets Pages and a custom domain free, forever. | Free — unless the client requires the source be private, which needs a paid plan for Pages. | **$0** |
| **Domain** | — | A subdomain of the domain they already own. No registrar, no renewal, no new bill. | **$0** |

**Total: $25/month plus a few dollars of Gemini.**

---

## HookMyApp is not needed, and has been removed

The brief specified HookMyApp for WhatsApp. It is a forwarding service: it holds
the Meta credentials, receives Meta's webhook, re-signs it with its own secret
and forwards it on.

Every byte it forwards is Meta's own Graph API. The message envelope this code
parses, the media endpoints it fetches from, the send call it makes — all of it
was always Meta's. The service was a paid hop in front of a free API.

**The change, in full:**

| | Through a forwarder | Direct to Meta |
|---|---|---|
| Endpoint | the forwarder's gateway | `https://graph.facebook.com/v22.0` |
| Signature header | its own | `X-Hub-Signature-256` |
| Signing secret | its channel secret | the Meta app's **App Secret** |

That is the entire difference, and it is **already implemented** — the function
accepts either header and reads `META_APP_SECRET`, falling back to the old
variable so an existing channel would keep working. `META_GRAPH_API_URL` now
defaults to Meta.

What the forwarder was actually selling was **Embedded Signup** — the one-click
flow that spares you creating a Meta app and passing review. Going direct means
doing that once, by hand, and the client task list walks through it. It is an
afternoon, not a project, and it is the last time anyone touches it.

*If the client later wants a provider anyway* — for a shared team inbox, or
because nobody there wants to hold Meta credentials — any BSP that forwards the
raw webhook will work by setting `META_GRAPH_API_URL` and `WEBHOOK_HMAC_SECRET`.
Nothing else in the code cares.

---

## What has to move

**Five accounts, in this order.** Each one blocks the next.

1. **Google account** — an organisational one (`archive@torahmitzion.org` or
   similar), not a person's. Everything else hangs off it: Supabase sign-in,
   Gemini billing, and the Google sign-in that lets staff into the back office.
   *Never a departing employee's personal account.*
2. **GitHub organisation** — the repository transfers into it, Pages serves from
   it.
3. **Supabase project** — on Pro, in a region near the communities (`eu-central`
   or `us-east`; the map is worldwide but the staff are not).
4. **Google AI Studio / Gemini** — API key with billing enabled.
5. **Meta Business + WhatsApp** — the longest lead time, because business
   verification can take days. **Start it first even though it lands last.**

**The code.** Three files carry the project's identity and must be re-pointed:
`docs/api.js`, `docs/admin/config.js`, `docs/sim/index.html` (the project URL and
the anon key — both are public by design; RLS is what enforces access).

**The database.** Twelve migrations under `supabase/migrations/`, applied in
order to the new project with `supabase db push`. Then `scripts/import-real.mjs`
repopulates communities, people and tenures from `scripts/real-data.json`.
No photographs to move.

**The secrets.** Set on the new Supabase project:

| Secret | Where it comes from |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio, billing enabled |
| `META_APP_SECRET` | Meta app → Settings → Basic |
| `VERIFY_TOKEN` | invented; typed into Meta's webhook form to match |
| `WHATSAPP_ACCESS_TOKEN` | Meta **System User** token — permanent. A developer token expires in 24 hours and will strand the agent |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta → WhatsApp → API Setup |
| `TMZ_IP_SALT` | invented, any long random string |
| `SIM_TOKEN` | invented; only for the test console |
| `AUTO_PUBLISH` | `on`, or `off` to hold everything for review |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

---

## Order of operations

1. **Start Meta business verification.** Days of waiting; everything else is
   hours. Begin here even though the WhatsApp number connects last.
2. Google account → GitHub organisation → repository transferred.
3. Supabase project on Pro. Migrations pushed, real data imported, buckets
   created by migration 8.
4. Google OAuth: new client, redirect URLs for the Pages domain, into Supabase
   Auth. Promote the first admin.
5. Gemini key with billing. Set the secrets. Deploy both edge functions.
6. Re-point the three client files, push, confirm Pages serves.
7. Subdomain → DNS `CNAME` → GitHub Pages → HTTPS certificate issues itself.
8. WhatsApp number, webhook, System User token. Verify with the test console
   at `/sim/` **before** the number is given to anybody.
9. Ten photographs through both doors — the upload page and WhatsApp — and check
   they land where expected.
10. **Only then** publish the number and the link.

---

## Cutover and rollback

There is nothing to cut over *from* — the current deployment has no
photographs and no audience. The old project is not switched off; it is simply
never given the new domain. Keep it a fortnight in case something was missed,
then delete the `tmz_` tables from it, which also removes the client's data from
a shared project.

**Rollback** is: point the DNS record back, or remove it. The old site keeps
working the whole time.

---

## Two things must not be carried over

**The current Gemini key is shared with another application.** Rotating or
removing it breaks the other one. The client's project gets its own key; the
existing key is not handed over.

**`.env.supabase` is not part of the handover.** It holds service-role
credentials for a project the client will not own. Every value in it is
regenerated on their side.

---

## What stays open after the move

Unchanged by migration, and still true:

- **Two design questions never answered.** Does the Hebrew timeline run
  right-to-left, oldest on the right? Who moderates — one central team, or an
  editor per community?
- **The screener's calibration is unverified on real photographs.** Every branch
  was proven with the test console's forced verdict; the model's own judgement
  was never exercised, because the free-tier quota ran out. **On the client's
  paid key, put a dozen real photographs through `/sim/` before trusting
  automatic publishing** — and consider running with `AUTO_PUBLISH=off` for the
  first week, which still screens and records everything while a person watches
  what it *would* have done.
