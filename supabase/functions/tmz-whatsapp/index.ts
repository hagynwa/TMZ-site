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

import { sanitize, UnsafeFile } from '../_shared/imagesafe.ts';
import { screen, type Verdict } from '../_shared/screen.ts';

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

/* The three dials on automatic publishing, all readable as secrets so they can
   be turned without a deploy. AUTO_PUBLISH=off is the stop button: screening
   still runs and still records its verdict, but nothing reaches the site. */
const AUTO_PUBLISH = (Deno.env.get('AUTO_PUBLISH') ?? 'on') !== 'off';
const MIN_CONFIDENCE = Number(Deno.env.get('MIN_CONFIDENCE') ?? '0.8');
const REQUIRE_PEOPLE = (Deno.env.get('REQUIRE_PEOPLE') ?? 'on') !== 'off';

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
  /* Test console only, and only ever set inside handleSim. Lets the publish,
     hold and reject branches be exercised without a model call — which is the
     difference between testing the pipeline and testing Gemini's quota. The
     live channel below cannot set it, so there is no path from a real WhatsApp
     message to a forced verdict. */
  forceVerdict?: 'publish' | 'hold' | 'reject';
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
    published: 'Thank you — it is on the site now. Send another whenever you like.',
    saved: 'Noted, thank you. Send another whenever you like.',
    rejected: 'Sorry — that image did not pass our automatic check, so it was not added.',
    dupe: 'We already hold that photograph. Thank you all the same.',
    hello: 'Hello, and thank you for helping build the Torah MiTzion 30 archive. Send a photograph and I will take it from there.',
    nophoto: 'Send a photograph whenever you are ready — I can take several in a row.'
  },
  he: {
    got: 'תודה — התמונה הועברה לצוות. מאיזו קהילה היא, ובאיזו שנה בערך?',
    published: 'תודה — התמונה כבר באתר. אפשר לשלוח עוד מתי שתרצו.',
    saved: 'נרשם, תודה. אפשר לשלוח עוד מתי שתרצו.',
    rejected: 'מצטערים — התמונה לא עברה את הבדיקה האוטומטית ולכן לא נוספה.',
    dupe: 'התמונה הזו כבר אצלנו. תודה בכל זאת.',
    hello: 'שלום, ותודה שאתם עוזרים לבנות את ארכיון תורה מציון 30. שלחו תמונה ואמשיך מכאן.',
    nophoto: 'שלחו תמונה מתי שנוח לכם — אפשר כמה ברצף.'
  },
  ru: {
    got: 'Спасибо — фотография передана нашей команде. Из какой она общины и примерно какого года?',
    published: 'Спасибо — фотография уже на сайте. Присылайте ещё в любое время.',
    saved: 'Записано, спасибо. Присылайте ещё в любое время.',
    rejected: 'Извините — изображение не прошло автоматическую проверку и не было добавлено.',
    dupe: 'Эта фотография у нас уже есть. Спасибо в любом случае.',
    hello: 'Здравствуйте, и спасибо, что помогаете собрать архив «Тора МиЦион 30». Пришлите фотографию, дальше я всё сделаю.',
    nophoto: 'Присылайте фотографию, когда будет удобно — можно несколько подряд.'
  },
  fr: {
    got: 'Merci — la photographie est transmise à notre équipe. De quelle communauté vient-elle, et de quelle année environ ?',
    published: 'Merci — elle est en ligne. Envoyez-en d’autres quand vous voulez.',
    saved: 'Noté, merci. Envoyez-en d’autres quand vous voulez.',
    rejected: 'Désolé — cette image n’a pas passé notre vérification automatique et n’a pas été ajoutée.',
    dupe: 'Nous avons déjà cette photographie. Merci quand même.',
    hello: 'Bonjour, et merci de nous aider à constituer les archives Torah MiTzion 30. Envoyez une photographie et je m’occupe du reste.',
    nophoto: 'Envoyez une photographie quand vous voulez — je peux en recevoir plusieurs à la suite.'
  },
  de: {
    got: 'Danke — das Foto liegt jetzt bei unserem Team. Aus welcher Gemeinde stammt es, und ungefähr aus welchem Jahr?',
    published: 'Danke — es ist jetzt auf der Website. Schicken Sie gerne weitere.',
    saved: 'Notiert, danke. Schicken Sie gerne weitere.',
    rejected: 'Leider hat dieses Bild unsere automatische Prüfung nicht bestanden und wurde nicht aufgenommen.',
    dupe: 'Dieses Foto haben wir bereits. Trotzdem vielen Dank.',
    hello: 'Hallo, und danke, dass Sie beim Aufbau des Torah-MiTzion-30-Archivs helfen. Schicken Sie ein Foto, den Rest übernehme ich.',
    nophoto: 'Schicken Sie ein Foto, wann immer Sie mögen — auch mehrere hintereinander.'
  },
  es: {
    got: 'Gracias — la fotografía ya está con nuestro equipo. ¿De qué comunidad es, y de qué año aproximadamente?',
    published: 'Gracias — ya está en el sitio. Envíe más cuando quiera.',
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
  // forceVerdict is deliberately absent here and cannot be reached from a webhook.
};

/* The test console's channel. The photograph arrives inline in the request and
   replies are collected rather than sent, so the browser can render the
   conversation. Nothing else about the handler changes. */
function simChannel(inline: { bytes: Uint8Array; mime: string } | null,
                    forceVerdict?: 'publish' | 'hold' | 'reject') {
  const replies: string[] = [];
  const trace: { step: string; detail: unknown }[] = [];
  const ch: Channel = {
    async fetchMedia() {
      if (!inline) throw new Error('no image in the simulated message');
      return inline;
    },
    async reply(_to, text) { replies.push(text); },
    trace: (step, detail) => { trace.push({ step, detail }); console.log('[sim]', step); },
    isTest: true,
    forceVerdict
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
    const ref = `wa:${body.from}`;
    /* Files first. SQL cannot delete from storage.objects — Supabase refuses
       it outright — so a reset that only removed rows left every test
       photograph still serving from its public URL, which is precisely the
       bug this console was built to catch. */
    const doomed = await pg(
      `/tmz_photo?select=storage_path,derived_path,public_path` +
      `&submitter_ref=like.${encodeURIComponent(ref + '%')}`) ?? [];
    let files = 0;
    for (const p of doomed) {
      for (const [bucket, key] of [
        ['tmz-photo-originals', p.storage_path],
        ['tmz-photo-originals', p.derived_path],
        ['tmz-photo-public', p.public_path]
      ] as [string, string | null][]) {
        if (!key) continue;
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, {
          method: 'DELETE',
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
        });
        if (r.ok) files++;
      }
    }
    const [row] = await rpc('tmz_sim_reset', { p_ref: ref });
    return json({ reset: { ...(row ?? { photos: 0, submissions: 0 }), files } });
  }

  const inline = body.type === 'image' && body.image?.data
    ? { bytes: b64ToBytes(body.image.data), mime: body.image.mime ?? 'image/jpeg' }
    : null;
  if (body.type === 'image' && !inline) return json({ error: 'image.data is required' }, 400);

  const force = ['publish', 'hold', 'reject'].includes(body.force_verdict)
    ? body.force_verdict as 'publish' | 'hold' | 'reject' : undefined;
  const { ch, replies, trace } = simChannel(inline, force);
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

    /* Two ways this can fall back to a default, and both used to default to
       English: the model returning something unparseable, and the call failing
       outright. The script the sender typed in survives either. */
    const comms = await communityList();
    const local = parseLocally(text, comms);
    let det: any = { language: scriptOf(text), ...local };
    if (GEMINI_KEY) {
      try {
        const m = await parseDetails(text, comms);
        /* Plain matching wins where it found something: it read the actual
           words, and it cannot hallucinate a community that was never named. */
        det = { ...m, ...Object.fromEntries(Object.entries(local).filter(([, v]) => v != null)) };
      } catch (e) { console.error(e); ch.trace('parse failed', { error: String(e) }); }
    }
    const lang = det.language ?? scriptOf(text);
    ch.trace('parsed', det);

    /* Whatever they name here travels with them, so the next eleven pictures
       out of the same shoebox place themselves. */
    let communityId: string | null = null;
    if (det.community_slug) {
      const c = await pg(`/tmz_community?select=id&slug=eq.${encodeURIComponent(det.community_slug)}`);
      communityId = c?.[0]?.id ?? null;
    }
    await remember(waId, {
      lang, is_test: ch.isTest,
      ...(communityId ? { community_id: communityId } : {}),
      ...(det.year ? { year: det.year } : {})
    });

    // Attach the answer to whatever they last sent, if anything is waiting.
    const recent = await pg(
      `/tmz_photo?select=id,community_id,year,submitter_ref&submitter_ref=like.${encodeURIComponent(waId + '%')}` +
      `&status=eq.pending&order=created_at.desc&limit=1`
    );

    if (recent?.length && det.is_answer !== false) {
      const patch: Record<string, unknown> = {};
      if (det.year && !recent[0].year) patch.year = det.year;
      if (communityId && !recent[0].community_id) patch.community_id = communityId;
      const note = [det.people, det.event_note].filter(Boolean).join(' · ');
      if (note) patch.submitter_ref = `${recent[0].submitter_ref ?? waId} · ${note}`;
      if (Object.keys(patch).length) {
        await pg(`/tmz_photo?id=eq.${recent[0].id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      }
      ch.trace('attached', { photo_id: recent[0].id, patch });

      /* The answer is what a held photograph was waiting for. Screening has
         already decided; publishIfReady will refuse anything it did not clear,
         so an answer can place a photograph but never approve one. */
      const live = await publishIfReady(recent[0].id, ch);
      ch.trace(live ? 'published' : 'still held', { photo_id: recent[0].id });
      await ch.reply(from, say(lang, live ? 'published' : 'saved'));
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
  /* The whole automatic path lives below. It publishes without anyone looking
     first, so every branch is written to fail towards NOT publishing: an
     unreadable file, a screener that will not answer, a confidence below the
     line, a picture with nobody in it — each of those holds the photograph
     rather than letting it through. The only route to the public bucket is a
     picture two independent passes agreed on, that we re-encoded ourselves,
     and whose community and year we know. */

  const contact = await contactOf(waId);
  if (contact?.blocked_until && new Date(contact.blocked_until) > new Date()) {
    ch.trace('blocked', { until: contact.blocked_until, strikes: contact.strikes });
    return;
  }

  const allowed = await rpc('tmz_rate_take', {
    p_bucket: `wa:${from}`, p_limit: 40, p_window_seconds: 3600
  });
  if (allowed === false) { ch.trace('rate limited', { bucket: `wa:${from}` }); return; }

  const caption = msg.image?.caption ?? '';
  const lang = caption && scriptOf(caption) !== 'en' ? scriptOf(caption) : await recallLang(waId);
  await remember(waId, {
    lang, is_test: ch.isTest,
    display_name: value?.contacts?.[0]?.profile?.name ?? null
  });

  let clean;
  try {
    const { bytes, mime } = await ch.fetchMedia(msg.image.id);
    ch.trace('fetched', { bytes: bytes.length, declared_mime: mime });
    clean = await sanitize(bytes);
    ch.trace('sanitised', {
      kind: clean.kind, out: `${clean.width}x${clean.height}`, resized: clean.resized,
      phash: clean.phash, archive_bytes: clean.archiveBytes.length,
      public_bytes: clean.publicBytes.length
    });
  } catch (e) {
    /* A file that will not survive being redrawn never reaches the model, the
       storage bucket or the database. It is the cheapest refusal there is, and
       the one that stops the whole class of "image" that is really something
       else. */
    const why = e instanceof UnsafeFile ? e.message : String(e);
    ch.trace('refused at the door', { why });
    await strike(waId, ch.isTest);
    await ch.reply(from, say(lang, 'rejected'));
    return;
  }

  /* The same photograph arriving twice — forwarded round a family, or sent
     again because the first reply was missed — is common enough that it has to
     be cheap. The hash is of the decoded pixels, so a re-compressed copy still
     collides. */
  const dupe = await rpc('tmz_find_duplicate', { p_hash: clean.phash, p_max_distance: 4 })
    .catch(() => null);
  if (Array.isArray(dupe) ? dupe.length > 0 : Boolean(dupe)) {
    ch.trace('duplicate', { of: dupe });
    await ch.reply(from, say(lang, 'dupe'));
    return;
  }

  // ---- screening, which is the gate ----
  let verdict: Verdict;
  if (ch.forceVerdict) {
    /* Two synthetic passes, so a forced run writes the same THREE moderation
       rows a real one does. Without them the console exercised a one-row
       insert and missed PGRST102 entirely — which is exactly how that bug
       survived until a real screening ran. */
    verdict = {
      decision: ch.forceVerdict, confidence: 1, facts: {}, scores: {},
      passes: [{ pass: 'assess', raw: null }, { pass: 'challenge', raw: null }],
      reasons: ['VERDICT FORCED BY THE TEST CONSOLE — no model looked at this picture']
    };
    ch.trace('screening SKIPPED (forced)', { decision: ch.forceVerdict });
  } else if (!GEMINI_KEY) {
    verdict = holdBecause('no screening key configured');
  } else {
    try {
      verdict = await screen(toBase64(clean.archiveBytes), 'image/jpeg', {
        model: GEMINI_MODEL, key: GEMINI_KEY,
        minConfidence: MIN_CONFIDENCE, requirePeople: REQUIRE_PEOPLE
      });
    } catch (e) {
      /* Fail closed. The old behaviour — accept it, let a person decide — was
         right when a person was going to decide. With nobody downstream,
         "the screener is unavailable" has to mean "not published", or an
         outage becomes an open door. */
      ch.trace('screening unavailable', { error: String(e).slice(0, 300) });
      verdict = holdBecause(`screening unavailable: ${String(e).slice(0, 200)}`);
    }
  }
  if (!AUTO_PUBLISH && verdict.decision === 'publish') {
    verdict = { ...verdict, decision: 'hold',
                reasons: ['auto-publish is switched off', ...verdict.reasons] };
  }
  ch.trace('screened', {
    decision: verdict.decision, confidence: verdict.confidence,
    reasons: verdict.reasons, scores: verdict.scores, facts: verdict.facts
  });

  // ---- record it ----
  const [submission] = await pg('/tmz_submission', {
    method: 'POST', prefer: 'return=representation',
    body: JSON.stringify([{
      contributor_name: value?.contacts?.[0]?.profile?.name ?? null,
      contributor_note: caption || null,
      source: 'whatsapp', ip_hash: waId, consented: true, is_test: ch.isTest, lang
    }])
  });

  const key = `${new Date().getFullYear()}/wa-${submission.id}.jpg`;
  const derivedKey = `derived/${key}`;
  await putObject('tmz-photo-originals', key, clean.archiveBytes);
  await putObject('tmz-photo-originals', derivedKey, clean.publicBytes);

  /* Community and year come from the caption first, then from what this sender
     already told us. Someone emptying a shoebox says "Memphis, 2003" once. */
  const placed = await placeFrom(caption, contact, ch);

  const [photo] = await pg('/tmz_photo', {
    method: 'POST', prefer: 'return=representation',
    body: JSON.stringify([{
      storage_path: key, derived_path: derivedKey,
      width: clean.width, height: clean.height, bytes: clean.archiveBytes.length,
      phash: clean.phash,
      community_id: placed.community_id, year: placed.year,
      event_type_id: verdict.facts.event_type || null,
      venue: verdict.facts.setting || null,
      status: verdict.decision === 'reject' ? 'rejected' : 'pending',
      agent_decision: verdict.decision,
      source: 'whatsapp', submission_id: submission.id, submitter_ref: waId
    }])
  });

  await pg('/tmz_moderation', {
    method: 'POST',
    /* Every object in a PostgREST bulk insert must carry the SAME KEYS — it
       builds one INSERT from the first row's shape and rejects the rest with
       "All object keys must match". The per-pass rows had no `decision` and
       the final row did, so the whole insert failed the moment real screening
       produced passes to record. It stayed hidden while the model was over
       quota, because then there are no passes and the array has one row. */
    body: JSON.stringify([
      ...verdict.passes.map(p => ({
        photo_id: photo.id, model: GEMINI_MODEL, pass: p.pass,
        verdict: verdict.decision === 'reject' ? 'rejected' : 'pending',
        decision: null,
        scores: verdict.scores ?? {}, reasons: verdict.reasons ?? []
      })),
      {
        photo_id: photo.id, model: ch.forceVerdict ? 'forced (test console)' : GEMINI_MODEL,
        pass: 'final',
        verdict: verdict.decision === 'reject' ? 'rejected' : 'pending',
        decision: verdict.decision,
        scores: verdict.scores ?? {}, reasons: verdict.reasons ?? []
      }
    ])
  });

  if (verdict.decision === 'reject') {
    ch.trace('rejected', { photo_id: photo.id, reasons: verdict.reasons });
    await strike(waId, ch.isTest);
    await ch.reply(from, say(lang, 'rejected'));
    return;
  }

  const live = await publishIfReady(photo.id, ch);
  ch.trace(live ? 'published' : 'held', {
    photo_id: photo.id, community_id: placed.community_id, year: placed.year,
    decision: verdict.decision
  });
  await ch.reply(from, say(lang, live ? 'published' : 'got'));
}

/* ---- placement ----------------------------------------------------------- */

async function placeFrom(caption: string, contact: any, ch: Channel) {
  let community_id = contact?.community_id ?? null;
  let year = contact?.year ?? null;
  if (!caption) return { community_id, year };

  const comms = await communityList();
  const slugToId = async (slug: string) => {
    const c = await pg(`/tmz_community?select=id&slug=eq.${encodeURIComponent(slug)}`);
    return c?.[0]?.id ?? null;
  };

  const local = parseLocally(caption, comms);
  if (local.year) year = local.year;
  if (local.community_slug) community_id = (await slugToId(local.community_slug)) ?? community_id;
  ch.trace('caption read locally', local);

  /* The model is only asked about what plain matching could not settle, which
     keeps a photograph placeable when the quota is gone. */
  if (GEMINI_KEY && (!year || !community_id)) {
    try {
      const det = await parseDetails(caption, comms);
      ch.trace('caption', det);
      if (!year && det.year) year = det.year;
      if (!community_id && det.community_slug) {
        community_id = (await slugToId(det.community_slug)) ?? community_id;
      }
    } catch (e) { ch.trace('caption parse failed', { error: String(e).slice(0, 200) }); }
  }
  return { community_id, year };
}

async function communityList() {
  const comms = await pg('/tmz_community?select=slug,tmz_community_tr(lang,name)&limit=200');
  return (comms ?? []).map((c: any) => ({
    slug: c.slug,
    name: (c.tmz_community_tr?.find((t: any) => t.lang === 'en') ?? c.tmz_community_tr?.[0])?.name ?? c.slug,
    /* Every rendering we hold. A caption reading "ממפיס 2003" places itself
       without a model call precisely because the translations exist. */
    names: (c.tmz_community_tr ?? []).map((t: any) => t.name).filter(Boolean)
  }));
}

/* The common caption is "Memphis, 2003" and it does not need a language model
   to read. This runs first, costs nothing, and works when the model is
   unavailable — which is exactly when a photograph would otherwise sit
   unplaced and unpublished forever. */
function parseLocally(text: string, comms: { slug: string; names?: string[]; name: string }[]) {
  const out: { community_slug: string | null; year: number | null } =
    { community_slug: null, year: null };
  if (!text) return out;

  const years = [...text.matchAll(/\b(19[9]\d|20[0-4]\d)\b/g)].map(m => Number(m[1]))
    .filter(y => y >= 1990 && y <= 2030);
  if (years.length === 1) out.year = years[0];
  /* A range like "2003-2004" is the school year the archive already thinks in;
     take the first, which is how every tenure in the database is keyed. */
  else if (years.length > 1 && years[1] - years[0] === 1) out.year = years[0];

  const hay = text.toLowerCase();
  let best: { slug: string; len: number } | null = null;
  for (const c of comms) {
    for (const n of [...(c.names ?? []), c.name, c.slug]) {
      const needle = String(n).toLowerCase().trim();
      /* Longest match wins, so "Kansas City" is not shadowed by a shorter name
         that happens to be a substring of the same caption. */
      if (needle.length >= 4 && hay.includes(needle) && (!best || needle.length > best.len)) {
        best = { slug: c.slug, len: needle.length };
      }
    }
  }
  if (best) out.community_slug = best.slug;
  return out;
}

/* The single door to the public bucket. Everything that publishes goes through
   here, so the conditions are stated once: screening said publish, the
   photograph has somewhere to appear, and it is not already up. */
async function publishIfReady(photoId: string, ch: Channel) {
  const rows = await pg(
    `/tmz_photo?select=id,community_id,year,derived_path,storage_path,public_path,agent_decision,status` +
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
  if (!res.ok) {
    ch.trace('publish failed', { status: res.status, body: (await res.text()).slice(0, 200) });
    return false;
  }

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

/* ---- contacts and abuse -------------------------------------------------- */

async function contactOf(ref: string) {
  try {
    const rows = await pg(`/tmz_wa_contact?select=*&ref=eq.${encodeURIComponent(ref)}`);
    return rows?.[0] ?? null;
  } catch { return null; }
}

/* Nobody reviews these decisions, so the only thing standing between a
   determined sender and an unlucky screening result is refusing to keep
   looking at their pictures. Three refusals buys a day of silence. */
async function strike(ref: string, isTest: boolean) {
  try {
    const c = await contactOf(ref);
    const strikes = (c?.strikes ?? 0) + 1;
    const blocked_until = strikes >= 3
      ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      : (c?.blocked_until ?? null);
    await remember(ref, { strikes, blocked_until, is_test: isTest });
  } catch (e) { console.error('strike', e); }
}

async function putObject(bucket: string, key: string, bytes: Uint8Array) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${key}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: bytes
  });
  if (!res.ok) throw new Error(`storage ${bucket}/${key} → ${res.status} ${await res.text()}`);
}

const holdBecause = (why: string): Verdict => ({
  decision: 'hold', reasons: [why], confidence: 0, facts: {}, scores: {}, passes: []
});
