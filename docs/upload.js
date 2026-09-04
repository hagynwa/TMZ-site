/* The contribute page's working parts. Everything that can be done in the
   browser happens here — preview, downscale, perceptual hash — and everything
   that cannot be trusted to a browser (screening, storage, the database) is
   left to the tmz-upload edge function. */

/* These plain scripts share one global scope, so the project's endpoint and
   anon key are declared once in api.js and reused here rather than repeated. */
const UPLOAD_URL = `${TMZ_SUPABASE_URL}/functions/v1/tmz-upload`;

/* dHash: shrink to 9x8 greyscale, then record whether each pixel is brighter
   than the one to its right. 64 bits that survive rescaling and recompression,
   which is what makes "the same photo sent twice by two routes" catchable. */
async function perceptualHash(img) {
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const grey = [];
  for (let i = 0; i < data.length; i += 4) {
    grey.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += grey[y * 9 + x] > grey[y * 9 + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/* Large phone photographs are mostly wasted bytes for this purpose: the archive
   wants a legible picture, and the screening model sees no more in 40 megapixels
   than in two. Anything over the threshold is re-encoded before it leaves. */
async function prepare(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('That file could not be read as an image.'));
    i.src = url;
  });

  const phash = await perceptualHash(img);
  const MAX = 2200;
  const needsResize = Math.max(img.width, img.height) > MAX || file.size > 4 * 1024 * 1024;

  let blob = file, mime = file.type;
  if (needsResize) {
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    mime = 'image/jpeg';
  }

  const base64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(new Error('That file could not be read.'));
    fr.readAsDataURL(blob);
  });

  URL.revokeObjectURL(url);
  return { base64, mime, phash, preview: img.src, width: img.width, height: img.height,
           bytes: blob.size, resized: needsResize };
}

async function submit(payload) {
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: TMZ_ANON_KEY,
      Authorization: `Bearer ${TMZ_ANON_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Upload failed (${res.status}).`);
  return body;
}

window.TMZUpload = { prepare, submit, perceptualHash };
