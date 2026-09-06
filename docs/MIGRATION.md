# Handover — moving the archive onto Torah MiTzion's own infrastructure

Written 2026-09-04. Companion to [`PLAN.md`](PLAN.md), which describes what the
system *is*; this describes how it changes owner.

**The client-facing half of this document is
[`handover-tasks.html`](handover-tasks.html)** — the same migration written as
numbered tasks for someone non-technical, in Hebrew, with the costs and the
reasoning behind each account. Send them that; this file is for whoever does
the work.

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

**The database is shared.** The project (`xuoxkmwtdascazutoaxs`) also runs
unrelated applications, and carries a pre-existing `ALTER DEFAULT PRIVILEGES`
granting every new public-schema table full DELETE/INSERT/UPDATE/**TRUNCATE** to
`anon` and `authenticated`. Migration 10 revokes it for the `tmz_` tables, but
the hazard belongs to the project, and the next table anyone adds there inherits
it again.

**The client's data is in a personal account.** The photographs of their
communities, the contributors' names and phone numbers, and the Google sign-ins
of their staff all sit behind personal credentials today.

---

## What it costs

| | Plan | Cost |
|---|---|---|
| **Supabase** | Free | **$0** |
| **WhatsApp provider** | Dualhook, Developer | **$12/mo** |
| **Gemini** | Paid tier | **~$1–5/mo** |
| **Meta message fees** | service conversations | **$0** |
| **GitHub Pages** | public repository | **$0** |
| **Domain** | subdomain of theirs | **$0** |

**About $15 a month.**

### Supabase: free, with one number to watch

Free it is. The two limits that matter, both measured rather than assumed:

**Storage — 1 GB, which is about 464 photographs.** A 12-megapixel phone photo
costs **2.21 MB** across the three objects each one keeps: the 2560px master
(1.30 MB), the 1600px derivative (463 KB), and the published copy (463 KB).
Watch this figure in the Supabase dashboard; **at roughly 400 photographs it is
time to move to Pro**, where 100 GB holds about 46,000. Everything else on the
free plan is comfortable — the database itself is rows of text, and 500 MB holds
far more of those than the campaign will ever produce.

**A project with no traffic at all for a week is paused.** A public archive
linked from the organisation's own site normally gets enough traffic not to
qualify, so this is a risk rather than a certainty — but it is the failure mode
to recognise if the site is ever dark, and it is one click to resume.

Both are knobs, not walls: `ARCHIVE_EDGE` and `ARCHIVE_QUALITY` in
`_shared/imagesafe.ts` are the only two numbers deciding how many photographs
fit, and raising them on a paid plan is a one-line change.

### Gemini: paid, and the reason is not the quota

The free tier's ~1,000 requests a day is below one person emptying a shoebox,
and it has been returning `429` throughout development. But **the stronger
reason is that free-tier data may be used to improve Google's products.** These
are photographs of real families and children at community events. The paid
tier excludes that. Screening is two calls per photograph on a Flash model;
5,000 photographs is a few dollars in total.

---

## The WhatsApp provider

The brief specified HookMyApp. The requirement — a provider that handles Meta
onboarding, forwards Meta's raw webhook, and proxies the Graph API, so nobody
here holds Meta credentials — is right; the question was only who does it
cheapest.

| | Monthly | Per-message markup | Passthrough | Code change |
|---|---|---|---|---|
| **Dualhook** (Developer) | **$12** | none | direct Meta → our endpoint | two env vars |
| 360dialog | €49 | none | Graph-compatible gateway | two env vars |
| Twilio | $0 | $0.005 per message, inbound and outbound | **no** — its own payload shape | an adapter, ~150 lines |
| Direct to Meta | $0 | none | n/a | none — already supported |

### Check what the organisation already pays for, first

**Torah MiTzion already sends WhatsApp messages through some service.** If it
carries the three properties below, it costs nothing extra and there is no
second vendor to manage. Task 7 in the client list asks them five questions to
put to that provider; these are what the answers are being read for:

1. **Official WhatsApp Business API (Cloud API), not a WhatsApp Web bridge.**
   An unofficial bridge risks the number being banned and cannot be built on.
2. **API access with documentation**, not a UI-only broadcast console.
3. **Inbound webhook forwarding to an endpoint we specify.** *This is the one
   that usually fails.* Broadcast tools are built to send; many either never
   surface inbound messages over an API, or deliver them only into their own
   shared inbox. Without this there is nothing to build on.

A fourth answer matters even when all three pass: **the archive needs its own
number, not the one they broadcast from.** The agent replies automatically to
every message that arrives. On the number they use to reach communities, anyone
answering one of their announcements would get a reply about a photo archive.
Most providers add a second number to the same account cheaply or free.

### If it does not fit: Dualhook, $12/month

Same shape as HookMyApp: Embedded Signup for the onboarding, no per-message
markup, 14-day trial, and its own description of itself — *"for businesses
connecting WhatsApp assets they own or directly operate"* — is exactly this
case. A quarter of 360dialog's price.

360dialog is the fallback if a larger, longer-established vendor is wanted; the
integration is identical. Twilio is cheapest in absolute terms at this volume
but is not a passthrough — it normalises Meta's webhook into its own format and
would need an adapter, which is precisely the coupling worth avoiding.

**Meta's own message fees are zero here either way.** This agent only ever
*replies*, and a reply inside the 24-hour window a contributor opens is free
with no monthly cap — Meta removed the 1,000-service-conversation limit in
November 2024. The per-message fees introduced in July 2025 are for *template*
messages, which are business-initiated, which this never sends. Whatever the
provider costs, the messages themselves do not.

### Switching providers is configuration, not code

Every provider in this market signs the raw body with HMAC-SHA256 and sends it
as `sha256=<hex>`; they differ only in the header name and the secret. So all
three are environment variables:

| Variable | Dualhook / any forwarder | Direct to Meta |
|---|---|---|
| `META_GRAPH_API_URL` | the provider's gateway | `https://graph.facebook.com/v22.0` (default) |
| `WEBHOOK_SIGNATURE_HEADER` | whatever they document | `x-hub-signature-256` (default) |
| `META_APP_SECRET` | their channel secret | the Meta app's App Secret |

That is the whole of the vendor lock-in, and it is why choosing the $12 option
carries little risk: if Dualhook disappears, moving to 360dialog or straight to
Meta is three settings and no deploy.

**Confirm on the trial** which secret signs the webhook. Dualhook routes Meta's
notification directly to our endpoint rather than re-signing it, which suggests
Meta's own App Secret — in which case the defaults already work and only
`META_GRAPH_API_URL` changes.

---

## What has to move

**Five accounts, in this order.** Each blocks the next.

1. **Google account** — organisational (`archive@torahmitzion.org`), not a
   person's. Everything hangs off it: Supabase sign-in, Gemini billing, and the
   Google sign-in that lets staff into the back office. *Never a departing
   employee's personal account.*
2. **GitHub organisation** — the repository transfers into it, Pages serves from
   it.
3. **Supabase project** — free plan, region near the staff (`eu-central`).
4. **Google AI Studio / Gemini** — API key with billing enabled.
5. **Meta Business account + a provider** — the longest lead time, because
   Meta's business verification is manual and takes days. **Start it first even
   though it lands last.** A provider makes the *technical* connection trivial;
   it does not exempt anyone from Meta verifying the business. Read the existing
   provider's answers before opening an account anywhere new.

**The code.** Three files carry the project's identity: `docs/api.js`,
`docs/admin/config.js`, `docs/sim/index.html` — the project URL and the anon key,
both public by design; RLS is what enforces access.

**The database.** Sixteen migrations under `supabase/migrations/`, applied in
order with `supabase db push`. Then `scripts/import-real.mjs` repopulates
communities, people and tenures from `scripts/real-data.json`. No photographs to
move.

**The secrets**, set on the new Supabase project:

| Secret | Where it comes from |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio, billing enabled |
| `META_APP_SECRET` | the provider's dashboard (or the Meta app, going direct) |
| `META_GRAPH_API_URL` | the provider's gateway |
| `WEBHOOK_SIGNATURE_HEADER` | only if the provider uses its own header name |
| `VERIFY_TOKEN` | invented; typed into the webhook form to match |
| `WHATSAPP_ACCESS_TOKEN` | the provider's API key, or a Meta **System User** token — permanent. A Meta *developer* token expires in 24 hours and will strand the agent |
| `WHATSAPP_PHONE_NUMBER_ID` | the provider's dashboard |
| `TMZ_IP_SALT` | invented, any long random string |
| `SIM_TOKEN` | invented; only for the test console |
| `AUTO_PUBLISH` | `on`, or `off` to hold everything for review |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

---

## Order of operations

1. **Start Meta business verification.** Days of waiting; everything else is
   hours.
2. Google account → GitHub organisation → repository transferred.
3. Supabase project. Migrations pushed, real data imported, buckets created by
   migration 8.
4. Google OAuth: new client, redirect URLs for the Pages domain, into Supabase
   Auth. Promote the first admin.
5. Gemini key with billing. Set the secrets. Deploy both edge functions.
6. Re-point the three client files, push, confirm Pages serves.
7. Subdomain → DNS `CNAME` → GitHub Pages → HTTPS issues itself.
8. Read the existing provider's answers. Reuse it if it forwards inbound
   webhooks; otherwise open Dualhook. Either way a **separate number**, webhook
   pointed at `…/functions/v1/tmz-whatsapp`. Verify with the test console at
   `/sim/` **before** the number is given to anybody.
9. Ten photographs through both doors and check they land where expected.
10. **Only then** publish the number and the link.

---

## Cutover and rollback

There is nothing to cut over *from* — the current deployment has no photographs
and no audience. The old project is not switched off; it is simply never given
the new domain. Keep it a fortnight, then delete the `tmz_` tables from it,
which also removes the client's data from a shared project.

**Rollback** is: point the DNS record back, or remove it. The old site keeps
working throughout.

---

## Two things must not be carried over

**The current Gemini key is shared with another application.** Rotating or
removing it breaks the other one. The client's project gets its own; the
existing key is not handed over.

**`.env.supabase` is not part of the handover.** It holds service-role
credentials for a project the client will not own. Every value in it is
regenerated on their side.

---

## What stays open after the move

- **Two design questions never answered.** Does the Hebrew timeline run
  right-to-left, oldest on the right? Who moderates — one central team, or an
  editor per community?
- **The screener's calibration is unverified on real photographs.** Every branch
  was proven with the test console's forced verdict; the model's own judgement
  was never exercised, because the free-tier quota ran out. **On the client's
  paid key, put a dozen real photographs through `/sim/` before trusting
  automatic publishing** — and consider `AUTO_PUBLISH=off` for the first week,
  which still screens and records everything while a person watches what it
  *would* have done.
- **Photographs above 12 megapixels are refused**, with a message asking the
  sender to resend as a normal photo rather than a file. That ceiling is the
  edge worker's memory, measured: 4000×3000 completes, 4640×3480 does not. Both
  client paths shrink before sending and WhatsApp compresses on the way out, so
  it should be rare — but it is the one input this system turns away for a
  reason that has nothing to do with the photograph.
