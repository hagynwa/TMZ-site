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
| **WhatsApp provider** | Heyy — already theirs | **$0 extra** |
| **Gemini** | Paid tier | **~$1–5/mo** |
| **Meta message fees** | service conversations | **$0** |
| **GitHub Pages** | public repository | **$0** |
| **Domain** | subdomain of theirs | **$0** |

**About $1–5 a month**, all of it Gemini. Heyy is already paid for and forwards
inbound messages, which was the question that decided it.

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

## The WhatsApp provider — Heyy, the one they already have

**Settled: Torah MiTzion's own provider, [heyy.io](https://heyy.io).** No second
vendor, no extra bill. The adapter is written, deployed and tested.

It is **not** a Meta passthrough — it delivers its own event shape and takes its
own send call — so it needed the ~150 lines the plan predicted for that case.
That work lives in `heyyChannel` and `metaEnvelopeFromHeyy`: Heyy's event is
rewritten into the envelope Meta sends, so one handler serves both providers and
neither gets a private code path to rot in.

| | Heyy | Meta direct (still supported) |
|---|---|---|
| Inbound | `message.received` → `?heyy=<secret>` | Meta webhook → `X-Hub-Signature-256` |
| Photograph | `content.attachments[].file.url` | a media id fetched from the Graph API |
| Reply | `POST /v2/{channelId}/whatsapp_messages/send` | `POST /{phoneNumberId}/messages` |
| Auth | `Authorization: Bearer <API token>` | a System User token |

**One security caveat worth raising with Heyy.** They document no webhook
signature, so the URL carries the proof instead — Heyy is given
`…/tmz-whatsapp?heyy=<secret>` and anything without it gets 403. That is weaker
than an HMAC over the body: the secret travels in the URL and lands in their
request logs. **Ask their support whether a signing secret exists.** If one
does, `WEBHOOK_SIGNATURE_HEADER` and `META_APP_SECRET` already handle it and the
query-string gate can go.

**A separate number, still.** The agent replies automatically to everything that
arrives. On the number Torah MiTzion broadcasts from, anyone answering one of
their announcements would get a reply about a photo archive.

**Meta's own message fees remain zero.** This agent only ever *replies*, and a
reply inside the 24-hour window a contributor opens is free with no monthly cap.

### Switching providers is still configuration

`META_GRAPH_API_URL`, `WEBHOOK_SIGNATURE_HEADER` and `META_APP_SECRET` drive the
Meta-shaped path; `HEYY_*` drives this one. Both are live in the same function,
so moving between them is environment variables and no deploy.

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

- **The screener now runs end to end, and its calibration is partly measured.**
  A photograph with a person in it publishes (confidence 0.85–0.88); one with
  nobody in it is refused with a message about what the archive collects. What
  the measurement also showed:

  - `MIN_CONFIDENCE` was defaulted to 0.8, which sits *inside* the range benign
    photographs produce — 0.75, 0.85, 0.88 observed — so it was refusing good
    material at the low end of normal. It is 0.6 now. That number is a backstop
    for a model that is lost, not a safety signal: the model's confidence is
    about the *picture*, not about harm.
  - **The harm scores come back a flat 25 for everything** on benign images —
    sexual, violence, advertising, screenshot, private_document, all 25. The
    independent score ceilings therefore never fire, and the safety that is
    actually working is `safe_to_publish` plus the challenge pass. Worth
    watching whether a genuinely problematic image moves those numbers; if it
    does not, the ceilings are decoration and should be replaced with something
    that bites.

  **Still: put a dozen of the organisation's own photographs through `/sim/`
  before the number is published.** With no approval step, a photograph the
  agent refuses is refused for good, so the dials want setting before the
  campaign rather than during it. `AUTO_PUBLISH=off` for the first week screens
  and records everything while a person watches what it *would* have done.
- **Photographs above 12 megapixels are refused**, with a message asking the
  sender to resend as a normal photo rather than a file. That ceiling is the
  edge worker's memory, measured: 4000×3000 completes, 4640×3480 does not. Both
  client paths shrink before sending and WhatsApp compresses on the way out, so
  it should be rare — but it is the one input this system turns away for a
  reason that has nothing to do with the photograph.
