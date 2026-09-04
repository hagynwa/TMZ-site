/* WhatsApp intake.
 *
 * HookMyApp forwards Meta's webhook body here verbatim, signed with the
 * channel's HMAC secret. This function verifies that signature, keeps a short
 * conversation with the sender in their own language, and pushes photographs
 * into the same moderation queue the upload page uses.
 *
 * The conversation is deliberately thin: a photograph is accepted immediately
 * and the questions come afterwards. Someone digging through a shoebox will
 * send five pictures in a row; making them answer four questions before the
 * first one is accepted is how you lose the other four.
 *
 * A second entry point (?sim=1, gated by SIM_TOKEN) exists so the conversation
 * can be exercised from a browser before the organisation's WhatsApp number is
 * connected. It swaps the two transport edges — where a photograph comes from,
 * where a reply goes — and NOTHING else. Screening, parsing, deduplication,
 * rate limiting and every database write are the same lines of code the real
 * webhook runs, because a simulator that reimplements the agent tests the
 * simulator.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash';
const HMAC_SECRET = Deno.env.get('WEBHOOK_HMAC_SECRET') ?? '';
const VERIFY_TOKEN = Deno.env.get('VERIFY_TOKEN') ?? '';
const GRAPH_URL = Deno.env.get('META_GRAPH_API_URL') ?? 'https://gateway.hookmyapp.com/meta/v22.0';
const WA_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN') ?? '';
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
/* Unset means the test console is off. That is the right default for a
   function that writes to the real archive. */
const SIM_TOKEN = Deno.env.get('SIM_TOKEN') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tmz-sim-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

// ---- database --------------------------------------------------------------

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

// ---- signature -------------------------------------------------------------

/* HookMyApp re-signs every forwarded webhook with the channel's HMAC secret.
   Verify over the bytes as received — parsing and re-serialising first is the
   classic way to break this. */
async function verifySignature(raw: string, header: string | null) {
  if (!HMAC_SECRET) return { ok: false, why: 'WEBHOOK_HMAC_SECRET not configured' };
  if (!header) return { ok: false, why: 'missing X-HookMyApp-Signature-256' };

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  const expected = `sha256=${hex}`;

  // constant-time compare
  if (expected.length !== header.length) return { ok: false, why: 'signature length mismatch' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0 ? { ok: true, why: '' } : { ok: false, why: 'signature mismatch' };
}

// ---- the channel -----------------------------------------------------------

/* Everything the handler needs from the outside world. The real webhook binds
   this to Meta's Graph API; the test console binds it to the request body and
   an array. The handler cannot tell the difference, which is the point. */
interface Channel {
  fetchMedia(ref: string): Promise<{ bytes: Uint8Array; mime: string }>;
  reply(to: string, text: string): Promise<void>;
  trace(step: string, detail: unknown): void;
  isTest: boolean;
}

async function reply(to: string, text: string) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.log(`[no channel configured] would reply to ${to}: ${text}`);
    return;
  }
  const res = await fetch(`${GRAPH_URL}/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'text',
      text: { body: text, preview_url: false }
    })
  });
  if (!res.ok) console.error('reply failed', res.status, await res.text());
}

/* Spreading a multi-megabyte Uint8Array into String.fromCharCode overflows the
   call stack — which is exactly the size a phone camera produces. Chunk it. */
function toBase64(bytes: Uint8Array) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

async function fetchMedia(mediaId: string) {
  const meta = await fetch(`${GRAPH_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` }
  });
  if (!meta.ok) throw new Error(`media lookup ${meta.status}`);
  const { url, mime_type } = await meta.json();
  const bin = await fetch(url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  if (!bin.ok) throw new Error(`media download ${bin.status}`);
  return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: mime_type as string };
}

// ---- Gemini ----------------------------------------------------------------

const SCREEN_PROMPT = `You are screening a photograph sent to the Torah MiTzion 30th anniversary
archive over WhatsApp. Torah MiTzion runs religious-Zionist kollels in Jewish
communities worldwide; photographs show community events, Torah study, shlichim,
families and everyday life across 1996-2026.

Return ONLY JSON: {"publishable":boolean,"reasons":string[],
"scores":{"sexual":number,"violence":number,"advertising":number,"unrelated":number},
"guess":{"decade":string|null,"people_count":number|null,"setting":string|null,
"event_type":string|null,"description":string}}

Set publishable FALSE only for nudity or sexual content, graphic violence, an
advertisement or promotional graphic, a screenshot, or a meme. Set it TRUE for
everything else — including scans of old prints, photocopies, faded or grainy
film, damaged pictures, pictures of documents, and anything whose connection to
Torah MiTzion you cannot tell. You filter only what must never reach a human
reviewer; you do not judge quality, medium or belonging. When uncertain, TRUE.
event_type is one of simchat_torah, shabbaton, morning_seder, yom_haatzmaut,
chanukah, purim, opening_night, melave_malka, shavuot, farewell, chavruta,
youth — or null.`;

async function gemini(parts: unknown[], jsonOut = true) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: jsonOut
          ? { temperature: 0, responseMimeType: 'application/json' }
          : { temperature: 0.4 }
      })
    }
  );
  if (!res.ok) throw new Error(`gemini ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/* Reads whatever the sender typed and pulls out the details we need. Free text,
   any language, in whatever order they felt like — "Memphis 2003, that's my
   father on the left" has to land as community + year + a note. */
async function parseDetails(text: string, communities: { slug: string; name: string }[]) {
  const list = communities.map(c => `${c.slug}=${c.name}`).join(', ');
  const out = await gemini([{
    text: `Extract details from a WhatsApp message about an old photograph.
Known community slugs: ${list}

Message: """${text}"""

Return ONLY JSON:
{"community_slug":string|null,"year":number|null,"people":string|null,
 "event_note":string|null,"language":string,"is_answer":boolean}

community_slug must be one of the slugs above or null. year is 1996-2026 or
null. people is whoever they named. event_note is the occasion if mentioned.
language is the ISO code of the language the message is WRITTEN in — judge it
from the words themselves, not from the topic. "Bonjour" is fr, "Hallo" is de,
"Hola" is es. Only use en if the words really are English.
is_answer is false if the message is unrelated small talk.`
  }]);
  let det: any;
  try { det = JSON.parse(out); } catch { det = {}; }
  /* The script someone types in settles the question the model keeps getting
     wrong: asked about "שלום" it answers English. Hebrew and Cyrillic letters
     are not a hint, they are the answer, so they win. Latin script really is
     ambiguous between en/fr/de/es, and there the model's guess stands. */
  const script = scriptOf(text);
  if (script !== 'en' || !det.language) det.language = script;
  return det;
}

/* The sender's own row, written on the first message of any kind — which is
   what lets a greeting in Hebrew decide the language of the photograph that
   follows it, before any submission exists. */
async function remember(ref: string, patch: Record<string, unknown>) {
  try {
    await pg('/tmz_wa_contact?on_conflict=ref', {
      method: 'POST', prefer: 'resolution=merge-duplicates',
      body: JSON.stringify([{ ref, last_seen: new Date().toISOString(), ...patch }])
    });
  } catch (e) { console.error('remember', e); }
}

async function recallLang(ref: string) {
  try {
    const rows = await pg(`/tmz_wa_contact?select=lang&ref=eq.${encodeURIComponent(ref)}`);
    return rows?.[0]?.lang ?? 'en';
  } catch { return 'en'; }
}

function scriptOf(text: string) {
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  return 'en';
}

const SAY: Record<string, Record<string, string>> = {
  en: {
    got: 'Thank you — that is now with our team. Which community is it from, and roughly which year?',
    saved: 'Noted, thank you. Send another whenever you like.',
    rejected: 'Sorry — that image did not pass our automatic check, so it was not added.',
    dupe: 'We already hold that photograph. Thank you all the same.',
    hello: 'Hello, and thank you for helping build the Torah MiTzion 30 archive. Send a photograph and I will take it from there.',
    nophoto: 'Send a photograph whenever you are ready — I can take several in a row.'
  },
  he: {
    got: 'תודה — התמונה הועברה לצוות. מאיזו קהילה היא, ובאיזו שנה בערך?',
    saved: 'נרשם, תודה. אפשר לשלוח עוד מתי שתרצו.',
    rejected: 'מצטערים — התמונה לא עברה את הבדיקה האוטומטית ולכן לא נוספה.',
    dupe: 'התמונה הזו כבר אצלנו. תודה בכל זאת.',
    hello: 'שלום, ותודה שאתם עוזרים לבנות את ארכיון תורה מציון 30. שלחו תמונה ואמשיך מכאן.',
    nophoto: 'שלחו תמונה מתי שנוח לכם — אפשר כמה ברצף.'
  },
  ru: {
    got: 'Спасибо — фотография передана нашей команде. Из какой она общины и примерно какого года?',
    saved: 'Записано, спасибо. Присылайте ещё в любое время.',
    rejected: 'Извините — изображение не прошло автоматическую проверку и не было добавлено.',
    dupe: 'Эта фотография у нас уже есть. Спасибо в любом случае.',
    hello: 'Здравствуйте, и спасибо, что помогаете собрать архив «Тора МиЦион 30». Пришлите фотографию, дальше я всё сделаю.',
    nophoto: 'Присылайте фотографию, когда будет удобно — можно несколько подряд.'
  },
  fr: {
    got: 'Merci — la photographie est transmise à notre équipe. De quelle communauté vient-elle, et de quelle année environ ?',
    saved: 'Noté, merci. Envoyez-en d’autres quand vous voulez.',
    rejected: 'Désolé — cette image n’a pas passé notre vérification automatique et n’a pas été ajoutée.',
    dupe: 'Nous avons déjà cette photographie. Merci quand même.',
    hello: 'Bonjour, et merci de nous aider à constituer les archives Torah MiTzion 30. Envoyez une photographie et je m’occupe du reste.',
    nophoto: 'Envoyez une photographie quand vous voulez — je peux en recevoir plusieurs à la suite.'
  },
  de: {
    got: 'Danke — das Foto liegt jetzt bei unserem Team. Aus welcher Gemeinde stammt es, und ungefähr aus welchem Jahr?',
    saved: 'Notiert, danke. Schicken Sie gerne weitere.',
    rejected: 'Leider hat dieses Bild unsere automatische Prüfung nicht bestanden und wurde nicht aufgenommen.',
    dupe: 'Dieses Foto haben wir bereits. Trotzdem vielen Dank.',
    hello: 'Hallo, und danke, dass Sie beim Aufbau des Torah-MiTzion-30-Archivs helfen. Schicken Sie ein Foto, den Rest übernehme ich.',
    nophoto: 'Schicken Sie ein Foto, wann immer Sie mögen — auch mehrere hintereinander.'
  },
  es: {
    got: 'Gracias — la fotografía ya está con nuestro equipo. ¿De qué comunidad es, y de qué año aproximadamente?',
    saved: 'Anotado, gracias. Envíe más cuando quiera.',
    rejected: 'Lo sentimos — esa imagen no pasó nuestra verificación automática y no fue añadida.',
    dupe: 'Ya tenemos esa fotografía. Gracias de todos modos.',
    hello: 'Hola, y gracias por ayudarnos a construir el archivo Torah MiTzion 30. Envíe una fotografía y yo me encargo del resto.',
    nophoto: 'Envíe una fotografía cuando le venga bien — puedo recibir varias seguidas.'
  }
};
const say = (lang: string, key: string) => (SAY[lang] ?? SAY.en)[key] ?? SAY.en[key];

// ---- handler ---------------------------------------------------------------

/* The real channel: photographs come from Meta, replies go to Meta. */
const liveChannel: Channel = {
  fetchMedia,
  reply,
  trace: (step, detail) => console.log(step, JSON.stringify(detail)),
  isTest: false
};

/* The test console's channel. The photograph arrives inline in the request and
   replies are collected rather than sent, so the browser can render the
   conversation. Nothing else about the handler changes. */
function simChannel(inline: { bytes: Uint8Array; mime: string } | null) {
  const replies: string[] = [];
  const trace: { step: string; detail: unknown }[] = [];
  const ch: Channel = {
    async fetchMedia() {
      if (!inline) throw new Error('no image in the simulated message');
      return inline;
    },
    async reply(_to, text) { replies.push(text); },
    trace: (step, detail) => { trace.push({ step, detail }); console.log('[sim]', step); },
    isTest: true
  };
  return { ch, replies, trace };
}

function b64ToBytes(b64: string) {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

/* Wraps a simulated message in the exact envelope Meta sends, so the handler
   reads it through the same accessors as a real one. If Meta's shape changes,
   the console breaks too — which is correct: it is supposed to be a mirror. */
function metaEnvelope(m: any) {
  const msg: any = { from: m.from, id: `sim.${crypto.randomUUID()}`, type: m.type };
  if (m.type === 'image') msg.image = { id: 'sim', caption: m.caption ?? undefined };
  else msg.text = { body: m.text ?? '' };
  return {
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: m.name ?? 'Test sender' }, wa_id: m.from }],
      messages: [msg]
    } }] }]
  };
}

async function handleSim(req: Request, url: URL) {
  if (!SIM_TOKEN) return json({ error: 'The test console is not enabled (SIM_TOKEN is unset).' }, 503);
  const given = req.headers.get('x-tmz-sim-token') ?? '';
  /* Constant-time-ish: the token is not a signature, but there is no reason to
     leak its length either. */
  if (given.length !== SIM_TOKEN.length) return json({ error: 'bad token' }, 401);
  let diff = 0;
  for (let i = 0; i < SIM_TOKEN.length; i++) diff |= given.charCodeAt(i) ^ SIM_TOKEN.charCodeAt(i);
  if (diff !== 0) return json({ error: 'bad token' }, 401);

  const body = await req.json().catch(() => null) as any;
  if (!body?.from) return json({ error: 'from is required' }, 400);

  if (url.searchParams.get('sim') === 'reset') {
    const [row] = await rpc('tmz_sim_reset', { p_ref: `wa:${body.from}` });
    return json({ reset: row ?? { photos: 0, submissions: 0 } });
  }

  const inline = body.type === 'image' && body.image?.data
    ? { bytes: b64ToBytes(body.image.data), mime: body.image.mime ?? 'image/jpeg' }
    : null;
  if (body.type === 'image' && !inline) return json({ error: 'image.data is required' }, 400);

  const { ch, replies, trace } = simChannel(inline);
  try {
    /* Awaited, not queued: the console needs the answer in the response. The
       real webhook must still return 200 immediately or Meta retries. */
    await handle(metaEnvelope(body), ch);
  } catch (e) {
    return json({ replies, trace, error: String(e) }, 200);
  }
  return json({ replies, trace });
}

Deno.serve(async req => {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (url.searchParams.has('sim') && req.method === 'POST') return handleSim(req, url);

  // Meta's verification handshake
  if (req.method === 'GET') {
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const raw = await req.text();
  const check = await verifySignature(raw, req.headers.get('X-HookMyApp-Signature-256'));
  if (!check.ok) {
    console.error('rejected webhook:', check.why);
    return new Response('bad signature', { status: 401 });
  }

  // Always 200 quickly; Meta retries anything else, and a retry storm on a
  // slow Gemini call would duplicate photographs.
  const body = JSON.parse(raw);
  queueMicrotask(() => handle(body, liveChannel).catch(e => console.error('handler', e)));
  return new Response('ok', { status: 200 });
});

async function handle(body: any, ch: Channel) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return;

  const from = msg.from as string;
  const waId = `wa:${from}`;
  ch.trace('received', { type: msg.type, from });

  if (msg.type === 'text') {
    const text = msg.text?.body ?? '';
    const comms = await pg('/tmz_community?select=slug,tmz_community_tr(lang,name)&limit=200');
    const flat = (comms ?? []).map((c: any) => ({
      slug: c.slug,
      name: (c.tmz_community_tr?.find((t: any) => t.lang === 'en') ?? c.tmz_community_tr?.[0])?.name ?? c.slug
    }));

    /* Two ways this can fall back to a default, and both used to default to
       English: the model returning something unparseable, and the call failing
       outright. The script the sender typed in survives either. */
    let det: any = { language: scriptOf(text) };
    if (GEMINI_KEY) {
      try { det = await parseDetails(text, flat); }
      catch (e) { console.error(e); ch.trace('parse failed', { error: String(e) }); }
    }
    const lang = det.language ?? 'en';
    ch.trace('parsed', det);
    await remember(waId, { lang, is_test: ch.isTest });

    // Attach the answer to whatever they last sent, if anything is waiting.
    const recent = await pg(
      `/tmz_photo?select=id,community_id,year,submitter_ref&submitter_ref=like.${encodeURIComponent(waId + '%')}` +
      `&status=eq.pending&order=created_at.desc&limit=1`
    );

    if (recent?.length && det.is_answer !== false) {
      const patch: Record<string, unknown> = {};
      if (det.year && !recent[0].year) patch.year = det.year;
      if (det.community_slug && !recent[0].community_id) {
        const c = await pg(`/tmz_community?select=id&slug=eq.${encodeURIComponent(det.community_slug)}`);
        if (c?.[0]) patch.community_id = c[0].id;
      }
      const note = [det.people, det.event_note].filter(Boolean).join(' · ');
      if (note) patch.submitter_ref = `${recent[0].submitter_ref ?? waId} · ${note}`;
      if (Object.keys(patch).length) {
        await pg(`/tmz_photo?id=eq.${recent[0].id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      ch.trace('attached', { photo_id: recent[0].id, patch });
      await ch.reply(from, say(lang, 'saved'));
    } else {
      ch.trace('nothing waiting', { pending: recent?.length ?? 0 });
      await ch.reply(from, say(lang, text.length < 4 ? 'hello' : 'nophoto'));
    }
    return;
  }

  if (msg.type !== 'image') {
    await ch.reply(from, say('en', 'nophoto'));
    return;
  }

  // ---- an actual photograph ----
  const allowed = await rpc('tmz_rate_take', {
    p_bucket: `wa:${from}`, p_limit: 40, p_window_seconds: 3600
  });
  if (allowed === false) { ch.trace('rate limited', { bucket: `wa:${from}` }); return; }

  /* A photograph carries no text, so the language has to come from the caption
     or from whatever this sender was writing in last time. Answering someone in
     English because their picture had no words is a small rudeness the whole
     archive is built to avoid. */
  const caption = msg.image?.caption ?? '';
  const lang = caption && scriptOf(caption) !== 'en' ? scriptOf(caption) : await recallLang(waId);
  await remember(waId, {
    lang, is_test: ch.isTest,
    display_name: value?.contacts?.[0]?.profile?.name ?? null
  });

  try {
    const { bytes, mime } = await ch.fetchMedia(msg.image.id);
    const b64 = toBase64(bytes);

    let verdict: any = { publishable: true, reasons: ['screening skipped'], scores: {}, guess: {} };
    let model = 'none';
    if (GEMINI_KEY) {
      model = GEMINI_MODEL;
      try {
        verdict = JSON.parse(await gemini([
          { text: SCREEN_PROMPT }, { inline_data: { mime_type: mime, data: b64 } }
        ]));
      } catch (e) {
        console.error('screen', e);
        verdict = { publishable: true, reasons: ['screening unavailable'], scores: {}, guess: {} };
      }
    }
    ch.trace('screened', verdict);

    const [submission] = await pg('/tmz_submission', {
      method: 'POST', prefer: 'return=representation',
      body: JSON.stringify([{
        contributor_name: value?.contacts?.[0]?.profile?.name ?? null,
        contributor_note: caption || null,
        source: 'whatsapp', ip_hash: waId, consented: true, is_test: ch.isTest, lang
      }])
    });

    const ext = mime?.includes('png') ? 'png' : mime?.includes('webp') ? 'webp' : 'jpg';
    const key = `${new Date().getFullYear()}/wa-${submission.id}.${ext}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/tmz-photo-originals/${key}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
                 'Content-Type': mime, 'x-upsert': 'true' },
      body: bytes
    });
    if (!up.ok) throw new Error(`storage ${up.status}`);

    const g = verdict.guess ?? {};
    const [photo] = await pg('/tmz_photo', {
      method: 'POST', prefer: 'return=representation',
      body: JSON.stringify([{
        storage_path: key,
        bytes: bytes.length,
        event_type_id: g.event_type || null,
        venue: g.setting || null,
        status: verdict.publishable === false ? 'rejected' : 'pending',
        source: 'whatsapp',
        submission_id: submission.id,
        submitter_ref: waId
      }])
    });

    await pg('/tmz_moderation', {
      method: 'POST',
      body: JSON.stringify([{
        photo_id: photo.id, model,
        verdict: verdict.publishable === false ? 'rejected' : 'pending',
        scores: verdict.scores ?? {}, reasons: verdict.reasons ?? []
      }])
    });

    ch.trace('stored', { photo_id: photo.id, storage_path: key, status: photo.status });
    await ch.reply(from, say(lang, verdict.publishable === false ? 'rejected' : 'got'));
  } catch (e) {
    console.error('image handling', e);
    ch.trace('failed', { error: String(e) });
    throw e;
  }
}
