/* Public photograph intake.
 *
 * The browser never touches storage or the database directly for this: it posts
 * the file here, and this function does the things a client cannot be trusted
 * with — screening the image with Gemini, rate limiting, duplicate detection —
 * before anything lands in the archive. Every photograph enters as 'pending';
 * nothing this function does can publish one.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const IP_SALT = Deno.env.get('TMZ_IP_SALT') ?? 'tmz-default-salt';

const MAX_BYTES = 12 * 1024 * 1024;
const UPLOADS_PER_HOUR = 20;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

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

// ---- Gemini screening ------------------------------------------------------

/* Two jobs in one call: decide whether the picture is publishable at all, and
   pull whatever metadata it can so a human has less to fill in. Returning
   structured JSON keeps the verdict machine-readable — free text would need
   parsing and would drift. */
const SCREEN_PROMPT = `You are screening a photograph submitted to the Torah MiTzion 30th
anniversary archive. Torah MiTzion runs religious-Zionist kollels (Torah learning
centres) in Jewish communities around the world. Photographs show community
events, Torah study, shlichim (young Israeli emissaries), families, holidays,
and everyday community life across 1996-2026.

Return ONLY a JSON object, no markdown fence, with exactly these keys:
{
  "publishable": boolean,
  "reasons": string[],
  "scores": {
    "sexual": number, "violence": number, "advertising": number,
    "unrelated": number, "low_quality": number
  },
  "guess": {
    "decade": string|null,
    "people_count": number|null,
    "setting": string|null,
    "event_type": string|null,
    "description": string
  }
}

Each score is 0.0-1.0 confidence that the problem is present.
Set "publishable" false if: it contains nudity or sexual content, graphic
violence, is an advertisement or promotional graphic, is a screenshot or meme,
or is clearly unrelated to Jewish community life.
Set it true for ordinary community, family, study, event and travel photographs
even if the quality is poor or the connection to Torah MiTzion is uncertain —
a human reviews everything afterwards; you are filtering what must never reach
them, not deciding what belongs.
"event_type" should be one of: simchat_torah, shabbaton, morning_seder,
yom_haatzmaut, chanukah, purim, opening_night, melave_malka, shavuot,
farewell, chavruta, youth — or null if unclear.
"description" is one plain sentence in English.`;

async function screen(base64: string, mime: string) {
  if (!GEMINI_KEY) {
    return {
      ok: true,
      verdict: {
        publishable: true,
        reasons: ['screening skipped: no GEMINI_API_KEY configured'],
        scores: {},
        guess: { description: '' }
      },
      model: 'none'
    };
  }

  const model = 'gemini-2.5-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: SCREEN_PROMPT },
            { inline_data: { mime_type: mime, data: base64 } }
          ]
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    }
  );

  if (!res.ok) {
    // A screening outage must not silently admit everything, nor lose the
    // submission: hold it for a human instead.
    return {
      ok: false,
      verdict: {
        publishable: true,
        reasons: [`screening unavailable (${res.status})`],
        scores: {},
        guess: { description: '' }
      },
      model
    };
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  try {
    return { ok: true, verdict: JSON.parse(text), model };
  } catch {
    return {
      ok: false,
      verdict: { publishable: true, reasons: ['screening returned unparseable output'], scores: {}, guess: { description: '' } },
      model
    };
  }
}

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
    if (!ALLOWED.includes(mime)) return json({ error: 'Unsupported image type.' }, 415);
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

    // Already have it? Say so rather than collecting the same picture twice.
    if (phash) {
      const dupes = await rpc('tmz_find_duplicate', { p_hash: phash, p_max_distance: 8 });
      if (Array.isArray(dupes) && dupes.length) {
        return json({
          duplicate: true,
          status: dupes[0].status,
          message: 'We already hold this photograph. Thank you all the same.'
        });
      }
    }

    const screened = await screen(file, mime);
    const v = screened.verdict ?? {};
    const publishable = v.publishable !== false;

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

    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp'
              : mime === 'image/heic' ? 'heic' : 'jpg';
    const key = `${new Date().getFullYear()}/${submission.id}.${ext}`;

    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/tmz-photo-originals/${key}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': mime,
        'x-upsert': 'true'
      },
      body: bytes
    });
    if (!up.ok) throw new Error(`storage → ${up.status} ${await up.text()}`);

    const guess = v.guess ?? {};
    const [photo] = await pg('/tmz_photo', {
      method: 'POST',
      prefer: 'return=representation',
      body: JSON.stringify([{
        community_id: communityId,
        year: Number.isInteger(year) ? year : null,
        event_type_id: guess.event_type || null,
        venue: guess.setting || null,
        storage_path: key,
        bytes: bytes.length,
        phash: phash || null,
        // Rejected by the model never reaches a human queue; everything else
        // waits for review. Nothing here can approve a photograph.
        status: publishable ? 'pending' : 'rejected',
        source: 'web',
        submission_id: submission.id,
        submitter_ref: [contributor_name, people, event_note].filter(Boolean).join(' · ') || null
      }])
    });

    await pg('/tmz_moderation', {
      method: 'POST',
      body: JSON.stringify([{
        photo_id: photo.id,
        model: screened.model,
        verdict: publishable ? 'pending' : 'rejected',
        scores: v.scores ?? {},
        reasons: v.reasons ?? []
      }])
    });

    return json({
      ok: true,
      accepted: publishable,
      photo_id: photo.id,
      description: guess.description ?? null,
      reasons: publishable ? [] : (v.reasons ?? []),
      message: publishable
        ? 'Thank you. A member of the team will review it shortly.'
        : 'That image did not pass our automatic check, so it was not added.'
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong handling that upload.' }, 500);
  }
});
