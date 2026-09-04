/* Turning a stranger's file into something safe to serve.
 *
 * The archive publishes without a human looking first, which means the bytes a
 * stranger sends must never be the bytes a visitor downloads. Everything here
 * exists to guarantee that: the file is identified by its own contents rather
 * than its claimed type, its dimensions are read before it is decoded, and the
 * image that reaches the public bucket is one we encoded ourselves from raw
 * pixels. A polyglot JPEG carrying HTML, an SVG with a script in it, EXIF with
 * a payload or a home address in it — none of it survives being redrawn.
 */

import { decode, Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';

/* Roughly a phone photograph at full resolution. Anything larger is either a
   mistake or an attempt, and neither is worth decoding. */
export const MAX_BYTES = 12 * 1024 * 1024;
/* 40 megapixels. A 20000x20000 PNG is 60 KB on the wire and 1.6 GB decoded;
   this is the only line of defence against that, and it has to run before the
   decoder does. */
export const MAX_PIXELS = 40_000_000;
/* What the site actually serves. Nobody needs more, and it caps what a
   re-encode can cost. A phone photograph arrives at 3-4 MB and leaves at a
   few hundred KB; an already-small image can come out slightly larger, which
   is the price of not serving anyone else's bytes. */
export const PUBLIC_EDGE = 1600;
export const PUBLIC_QUALITY = 80;

export type Sniffed = 'jpeg' | 'png' | 'webp' | 'gif';

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  sig.every((v, i) => b[at + i] === v);

/* The declared MIME type is a claim by the sender. This is the file saying
   what it is. Anything not on this list — SVG above all, which is a document
   that can carry script, not an image — never reaches the decoder. */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length < 12) return null;
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp';
  return null;
}

/* Dimensions straight out of the header, so a decompression bomb is refused
   before anything allocates for it. Returns null when the header cannot be
   read, which is itself a reason to refuse the file. */
export function dimensions(b: Uint8Array, kind: Sniffed): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (kind === 'png') {
      // IHDR is always the first chunk, at a fixed offset.
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    }
    if (kind === 'gif') {
      return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    }
    if (kind === 'webp') {
      const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (tag === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
      if (tag === 'VP8L') {
        const bits = dv.getUint32(21, true);
        return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (tag === 'VP8X') {
        const rd = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + 1;
        return { w: rd(24), h: rd(27) };
      }
      return null;
    }
    // JPEG: walk the segment chain to the frame header. Cheap — it is all
    // length-prefixed, so nothing is parsed but the markers themselves.
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = dv.getUint16(i + 2);
      // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) };
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  } catch { return null; }
}

export class UnsafeFile extends Error {}

export interface Clean {
  /** Re-encoded JPEG, the only bytes that ever reach the public bucket. */
  publicBytes: Uint8Array;
  /** The re-encoded original-resolution image, for the private archive copy. */
  archiveBytes: Uint8Array;
  width: number;
  height: number;
  kind: Sniffed;
  /** 64-bit dHash as hex, for spotting the same photograph arriving twice. */
  phash: string;
  /** True when the picture had to be shrunk to fit PUBLIC_EDGE. */
  resized: boolean;
}

/* The whole defence in one call. Throws UnsafeFile with a plain reason if the
   file should not be touched at all; the reason is safe to log but is never
   shown to the sender verbatim. */
export async function sanitize(bytes: Uint8Array): Promise<Clean> {
  if (bytes.length === 0) throw new UnsafeFile('empty file');
  if (bytes.length > MAX_BYTES) throw new UnsafeFile(`too large (${bytes.length} bytes)`);

  const kind = sniff(bytes);
  if (!kind) throw new UnsafeFile('not a JPEG, PNG, WebP or GIF');

  const dim = dimensions(bytes, kind);
  if (!dim) throw new UnsafeFile('unreadable image header');
  if (dim.w < 40 || dim.h < 40) throw new UnsafeFile(`too small (${dim.w}x${dim.h})`);
  if (dim.w * dim.h > MAX_PIXELS) throw new UnsafeFile(`too many pixels (${dim.w}x${dim.h})`);

  let img: Image;
  try {
    const decoded = await decode(bytes);
    // An animation is a container of frames; take the first and drop the rest.
    img = (decoded as { width: number }).width !== undefined && decoded instanceof Image
      ? decoded
      : ((decoded as unknown as Image[])[0] as Image);
  } catch (e) {
    throw new UnsafeFile(`decode failed: ${e instanceof Error ? e.message : e}`);
  }
  if (!img || !img.width || !img.height) throw new UnsafeFile('decoded to nothing');

  const phash = dhash(img);

  /* Re-encoded from the decoded pixels. This is the step that makes the file
     safe: whatever was hiding in the container is not in the bitmap, and the
     bitmap is all that survives. */
  const archiveBytes = await img.encodeJPEG(92);

  const scale = Math.min(1, PUBLIC_EDGE / Math.max(img.width, img.height));
  const pub = scale < 1
    ? img.clone().resize(Math.round(img.width * scale), Math.round(img.height * scale))
    : img;
  const publicBytes = await pub.encodeJPEG(PUBLIC_QUALITY);

  return {
    publicBytes, archiveBytes,
    width: pub.width, height: pub.height,
    kind, phash, resized: scale < 1
  };
}

/* dHash: shrink to 9x8 greyscale and record whether each pixel is brighter
   than the one to its right. The same 64 bits the contribute page computes in
   the browser, so a photograph sent by both routes collides. */
export function dhash(img: Image): string {
  const small = img.clone().resize(9, 8);
  const px = small.bitmap; // RGBA
  let hex = '', bits = 0, acc = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const a = (y * 9 + x) * 4, b = (y * 9 + x + 1) * 4;
      const la = px[a] * 0.299 + px[a + 1] * 0.587 + px[a + 2] * 0.114;
      const lb = px[b] * 0.299 + px[b + 1] * 0.587 + px[b + 2] * 0.114;
      acc = (acc << 1) | (la > lb ? 1 : 0);
      if (++bits === 4) { hex += acc.toString(16); bits = 0; acc = 0; }
    }
  }
  return hex;
}
