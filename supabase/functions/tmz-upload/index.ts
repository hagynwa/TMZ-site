/* Public photograph intake.
 *
 * The browser never touches storage or the database directly for this: it posts
 * the file here, and this function does the things a client cannot be trusted
 * with — sanitising the file, screening the image, rate limiting, duplicate
 * detection — before anything lands in the archive.
 *
 * This path used to be the weak one. It checked the MIME TYPE THE SENDER
 * DECLARED and then stored the sender's bytes verbatim, so a POST claiming
 * image/jpeg could put anything at all in the bucket, and a reviewer clicking
 * Approve would copy it to the public bucket untouched. It runs the same
 * _shared/imagesafe.ts and _shared/screen.ts as the WhatsApp agent now:
 * identified by its own magic bytes, re-encoded from decoded pixels, judged by
 * two independent passes. Closing one door while leaving the other open is not
 * a security posture.
 */

import { sanitize, UnsafeFile } from '../_shared/imagesafe.ts';
import { screen as screenImage, type Verdict } from '../_shared/screen.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const IP_SALT = Deno.env.get('TMZ_IP_SALT') ?? 'tmz-default-salt';

const MAX_BYTES = 12 * 1024 * 1024;
const UPLOADS_PER_HOUR = 20;
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash';

/* The same dials as the WhatsApp agent, read from the same secrets, because a
   contributor should not get a different answer for using a different door. */
const AUTO_PUBLISH = (Deno.env.get('AUTO_PUBLISH') ?? 'on') !== 'off';
const MIN_CONFIDENCE = Number(Deno.env.get('MIN_CONFIDENCE') ?? '0.8');
const REQUIRE_PEOPLE = (Deno.env.get('REQUIRE_PEOPLE') ?? 'on') !== 'off';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---- database helpers (service role, so RLS does not apply) ----------------

async function pg(path: string, init: RequestInit & { prefer?: string } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const rpc = (fn: string, args: unknown) =>
  pg(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

/* The single-pass screener that used to live here is gone: both intake
   routes share _shared/screen.ts, so there is one policy and one place to
   change it. */

// ---- handler ---------------------------------------------------------------

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json();
    const {
      file, mime, filename, phash,
      community_slug, year, people, event_note,
      contributor_name, contributor_email, contributor_note, consented
    } = body ?? {};

    if (!file || typeof file !== 'string') return json({ error: 'No file.' }, 400);
    if (!consented) return json({ error: 'Consent is required to publish.' }, 400);

    const bytes = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    if (bytes.length > MAX_BYTES) return json({ error: 'That file is larger than 12MB.' }, 413);

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const ipHash = await sha256(IP_SALT + ip);

    const allowed = await rpc('tmz_rate_take', {
      p_bucket: `upload:${ipHash}`, p_limit: UPLOADS_PER_HOUR, p_window_seconds: 3600
    });
    if (allowed === false) {
      return json({ error: `That is more than ${UPLOADS_PER_HOUR} uploads in an hour. Try again later.` }, 429);
    }

    /* Identified by its own contents, dimension-checked before decoding, then
       decoded and re-encoded by us. The declared `mime` is now only a hint for
       the error message. */
    let clean;
    try {
      clean = await sanitize(bytes);
    } catch (e) {
      if (e instanceof UnsafeFile) {
        console.log('refused at the door:', e.message);
        return json({
          error: 'That file could not be read as a photograph. JPEG, PNG, WebP and GIF are accepted.'
        }, 415);
      }
      throw e;
    }

    /* The hash the browser computed is a courtesy; this one is of the decoded
       pixels and is the one stored, so a re-compressed copy still collides. */
    const dupes = await rpc('tmz_find_duplicate', { p_hash: clean.phash, p_max_distance: 6 });
    if (Array.isArray(dupes) && dupes.length) {
      return json({
        duplicate: true,
        status: dupes[0].status,
        message: 'We already hold this photograph. Thank you all the same.'
      });
    }

    /* Two independent passes, neither of which sees a word the contributor
       typed. What they wrote places a photograph; it never clears one. */
    let verdict: Verdict;
    if (!GEMINI_KEY) {
      verdict = { decision: 'hold', reasons: ['no screening key configured'],
                  confidence: 0, facts: {}, scores: {}, passes: [] };
    } else {
      try {
        verdict = await screenImage(toBase64(clean.archiveBytes), 'image/jpeg', {
          model: GEMINI_MODEL, key: GEMINI_KEY,
          minConfidence: MIN_CONFIDENCE, requirePeople: REQUIRE_PEOPLE
        });
      } catch (e) {
        /* Fail closed, exactly as the WhatsApp path does. */
        console.error('screening unavailable', e);
        verdict = { decision: 'hold', reasons: [`screening unavailable: ${String(e).slice(0, 200)}`],
                    confidence: 0, facts: {}, scores: {}, passes: [] };
      }
    }
    if (!AUTO_PUBLISH && verdict.decision === 'publish') {
      verdict = { ...verdict, decision: 'hold',
                  reasons: ['auto-publish is switched off', ...verdict.reasons] };
    }
    const publishable = verdict.decision !== 'reject';

    // Resolve the community by slug; an unknown one is not fatal, a human can
    // place it later.
    let communityId: string | null = null;
    if (community_slug) {
      const rows = await pg(`/tmz_community?select=id&slug=eq.${encodeURIComponent(community_slug)}`);
      communityId = rows?.[0]?.id ?? null;
    }

    const [submission] = await pg('/tmz_submission', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify([{
        contributor_name: contributor_name || null,
        contributor_email: contributor_email || null,
        contributor_note: contributor_note || null,
        source: 'web',
        ip_hash: ipHash,
        consented: true
      }])
    });

    /* Always .jpg: what is stored is what we encoded, not what arrived. */
    const key = `${new Date().getFullYear()}/${submission.id}.jpg`;
    const derivedKey = `derived/${key}`;
    await putObject(key, clean.archiveBytes);
    await putObject(derivedKey, clean.publicBytes);

    const guess = verdict.facts ?? {};
    const [photo] = await pg('/tmz_photo', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify([{
        community_id: communityId,
        year: Number.isInteger(year) ? year : null,
        event_type_id: guess.event_type || null,
        venue: guess.setting || null,
        storage_path: key,
        derived_path: derivedKey,
        width: clean.width, height: clean.height,
        bytes: clean.archiveBytes.length,
        phash: clean.phash,
        status: publishable ? 'pending' : 'rejected',
        agent_decision: verdict.decision,
        source: 'web',
        submission_id: submission.id,
        submitter_ref: [contributor_name, people, event_note].filter(Boolean).join(' · ') || null
      }])
    });

    /* Every object in a PostgREST bulk insert must carry the SAME KEYS — it
       builds one INSERT from the first row's shape and rejects the rest with
       "All object keys must match". The per-pass rows had no `decision` and
       the final row did, so the whole insert failed the moment real screening
       produced passes to record. It stayed hidden while the model was over
       quota, because then there are no passes and the array has one row. */
    await pg('/tmz_moderation', {
      method: 'POST',
      body: JSON.stringify([
        ...verdict.passes.map(p => ({
          photo_id: photo.id, model: GEMINI_MODEL, pass: p.pass,
          verdict: publishable ? 'pending' : 'rejected',
          decision: null,
          scores: verdict.scores ?? {}, reasons: verdict.reasons ?? []
        })),
        {
          photo_id: photo.id, model: GEMINI_MODEL, pass: 'final',
          verdict: publishable ? 'pending' : 'rejected',
          decision: verdict.decision,
          scores: verdict.scores ?? {}, reasons: verdict.reasons ?? []
        }
      ])
    });

    /* The contributor named the community and the year on the form, so a
       cleared photograph usually has everywhere it needs to go and appears
       immediately. */
    const live = await publishIfReady(photo.id);

    return json({
      ok: true,
      accepted: publishable,
      published: live,
      photo_id: photo.id,
      description: (verdict.facts ?? {}).description ?? null,
      reasons: publishable ? [] : (verdict.reasons ?? []),
      message: !publishable
        ? 'Sorry — that image did not pass our automatic check, so it was not added.'
        : live
          ? 'Thank you. It is on the site now.'
          : 'Thank you. It is in the archive and will appear once we know where it belongs.'
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong handling that upload.' }, 500);
  }
});

/* ---- storage ------------------------------------------------------------- */

async function putObject(key: string, bytes: Uint8Array) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/tmz-photo-originals/${key}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'image/jpeg', 'x-upsert': 'true'
    },
    body: bytes
  });
  if (!res.ok) throw new Error(`storage ${key} → ${res.status} ${await res.text()}`);
}

/* Spreading a multi-megabyte Uint8Array into String.fromCharCode overflows the
   call stack, which is exactly the size a phone camera produces. Chunk it. */
function toBase64(bytes: Uint8Array) {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

/* The same single door to the public bucket the WhatsApp agent uses, and the
   same conditions: screening said publish, the photograph has somewhere to
   appear, and it is not already up. */
async function publishIfReady(photoId: string) {
  const rows = await pg(
    `/tmz_photo?select=id,community_id,year,derived_path,storage_path,public_path,agent_decision` +
    `&id=eq.${photoId}`);
  const p = rows?.[0];
  if (!p) return false;
  if (p.public_path) return true;
  if (p.agent_decision !== 'publish') return false;
  if (!p.community_id || !p.year) return false;
  if (!AUTO_PUBLISH) return false;

  const source = p.derived_path ?? p.storage_path;
  const dest = source.replace(/^derived\//, '');
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/copy`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucketId: 'tmz-photo-originals', sourceKey: source,
      destinationBucket: 'tmz-photo-public', destinationKey: dest
    })
  });
  if (!res.ok) { console.error('publish failed', res.status, await res.text()); return false; }

  await pg(`/tmz_photo?id=eq.${photoId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'approved', public_path: dest,
      published_by: 'agent', published_at: new Date().toISOString()
    })
  });
  await pg('/tmz_moderation', {
    method: 'POST',
    body: JSON.stringify([{
      photo_id: photoId, model: GEMINI_MODEL, pass: 'final', decision: 'published',
      verdict: 'approved', reasons: ['published automatically']
    }])
  });
  return true;
}
