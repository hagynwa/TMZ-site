# Runbook — standing the archive up on Torah MiTzion's own accounts

Commands to run, in order. Companion to [`MIGRATION.md`](MIGRATION.md), which
explains *why*; this is only *what to type*.

**Done already:** the code is in
[`Torah-Mitzion/archive`](https://github.com/Torah-Mitzion/archive) and GitHub
Pages serves it at <https://torah-mitzion.github.io/archive/>. It still reads
the old shared Supabase project — step 4 is what changes that.

---

## 1. Create the Supabase project

New project in Torah MiTzion's own organisation, **free plan**, region
`eu-central-1`. Save the database password it shows once.

Then collect three values from the dashboard:

| Value | Where |
|---|---|
| Project Ref | in the URL: `supabase.com/dashboard/project/<REF>` |
| `anon` key | Project Settings → API Keys |
| `service_role` key | same page — **secret, never committed** |

And one personal access token from <https://supabase.com/dashboard/account/tokens>
(`sbp_…`), which is what the CLI authenticates with.

## 2. Point the tooling at it

```bash
cd C:\Users\rettig_h\TMZ_site
```

Rewrite `.env.supabase` (it is gitignored and never leaves the machine):

```
SUPABASE_PROJECT_REF=<REF>
SUPABASE_URL=https://<REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_ACCESS_TOKEN=sbp_<personal token>
```

## 3. Schema and data

```bash
./node_modules/.bin/supabase link --project-ref <REF>
```

```bash
./node_modules/.bin/supabase db push --linked
```

Seventeen migrations. They create the tables, the RLS policies, the two storage
buckets and the payload functions. Then the real communities, people and
tenures:

```bash
node scripts/import-real.mjs
```

Expect `communities: 23 · people: 231 · tenures: 236`. No photographs — there
are none yet, which is why this migration is cheap.

## 4. Repoint the site at the new project

Three files carry the project's identity. Both values are public by design —
RLS is what enforces access — so they are committed.

```bash
node scripts/repoint.mjs <REF> <anon key>
```

```bash
git add -A && git commit -m "Point the site at Torah MiTzion's own project" && git push tmz master
```

## 5. Google sign-in for the back office

In Supabase → Authentication → Providers → Google, paste a Google OAuth client
ID and secret, then add the redirect URLs:

```
https://torah-mitzion.github.io/archive/admin/
https://<subdomain>.torahmitzion.org/admin/
```

First person to sign in stays a `contributor`. Promote them:

```sql
update tmz_app_user set role = 'admin' where id = '<their auth.users id>';
```

## 6. Secrets for the edge functions

```bash
./node_modules/.bin/supabase secrets set --project-ref <REF> \
  GEMINI_API_KEY=<key with billing enabled> \
  TMZ_IP_SALT=$(openssl rand -hex 32) \
  SIM_TOKEN=$(openssl rand -base64 24 | tr -d '=+/') \
  HEYY_WEBHOOK_SECRET=$(openssl rand -base64 24 | tr -d '=+/') \
  HEYY_API_TOKEN=<from app.heyy.io/settings/api-keys> \
  HEYY_CHANNEL_ID=<the WhatsApp channel's id in Heyy> \
  AUTO_PUBLISH=off
```

**`AUTO_PUBLISH=off` deliberately.** Screening still runs and still records
every verdict; nothing reaches the site. Watch what it *would* have done for a
week, then set it to `on`. With no approval step, a photograph the agent refuses
is refused for good — so the dials want setting before the campaign, not during.

```bash
./node_modules/.bin/supabase functions deploy tmz-upload   --use-api --no-verify-jwt --project-ref <REF>
./node_modules/.bin/supabase functions deploy tmz-whatsapp --use-api --no-verify-jwt --project-ref <REF>
```

## 7. Connect Heyy

In Heyy → Settings → Webhooks → Create webhook, subscribed to
**`message.received`**:

```
https://<REF>.supabase.co/functions/v1/tmz-whatsapp?heyy=<HEYY_WEBHOOK_SECRET>
```

Then check it, without touching the real number:

```bash
node scripts/heyy-check.mjs
```

It posts a Heyy-shaped event, confirms a wrong secret is refused, and confirms
a real one is accepted and placed.

## 8. Subdomain

Add one DNS record at whoever hosts `torahmitzion.org`:

```
archive   CNAME   torah-mitzion.github.io.
```

Then in the repo's Settings → Pages → Custom domain, enter
`archive.torahmitzion.org` and tick Enforce HTTPS once the certificate issues
(minutes to an hour).

## 9. Before telling anybody the number

```bash
node scripts/smoke.mjs
```

Ten photographs through both doors, checking each lands where expected. Then
send a dozen of the organisation's **own** photographs through
`/sim/` and read the verdicts — that is the calibration pass, and it is the
part that cannot be skipped.

---

## What to keep out of git

`.env.supabase` is gitignored and must stay that way. It holds the service-role
key, which bypasses every RLS policy in the project. The `anon` key in
`docs/api.js` is a different thing and is meant to be public.
