import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { measureImage } from '../reference-image/analyze.js';

/**
 * How a photo is used in a designed post. A product photographed on a plain backdrop ("seamless") is placed large on a page of that same backdrop colour, with its
 * edges feathered into it, so the product seems to stand on the page itself (the way a studio product shot is used in a menu or an ad). Any other photo (a place,
 * a job, a busy scene) is placed as a rounded card, cropped to the box with the subject kept in frame. A photo is never stretched, recoloured or redrawn.
 */
export type Photo = { image: import('@napi-rs/canvas').Image; width: number; height: number };
export type PhotoUse = { mode: 'seamless' | 'cutout' | 'card'; /** the colour of the plain backdrop at the top and at the bottom of the photo */ top: string; bottom: string; /** where the subject is, 0..1 from the left and the top */ focus: { x: number; y: number }; /** for a cut-out: the part of the picture the product fills (0..1) */ bbox?: { x: number; y: number; w: number; h: number }; why: string };

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export async function loadPhoto(bytes: Buffer): Promise<Photo | null> {
  const { loadImage } = await import('@napi-rs/canvas'); const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-post-'));
  try { const file = path.join(dir, 'p'); await writeFile(file, bytes, { mode: 0o600 }); const image = await loadImage(file); return { image, width: image.width, height: image.height }; } catch { return null; } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Reads the border of the photo: when all four sides are nearly one colour (or one gentle gradient), it is a studio shot on a plain backdrop. */
export async function readPhoto(photo: Photo, bytes: Buffer): Promise<PhotoUse> {
  const { createCanvas } = await import('@napi-rs/canvas'); const S = 120; const c = createCanvas(S, S); const x = c.getContext('2d'); x.drawImage(photo.image as never, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data; const at = (px: number, py: number) => { const i = (py * S + px) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const ring: number[][] = []; const band = 6; let clear = 0;
  for (let i = 0; i < S; i += 1) for (let k = 0; k < band; k += 1) { ring.push(at(i, k), at(i, S - 1 - k), at(k, i), at(S - 1 - k, i)); for (const [px, py] of [[i, k], [i, S - 1 - k], [k, i], [S - 1 - k, i]]) if (d[(py * S + px) * 4 + 3] < 200) clear += 1; }
  const mean = [0, 1, 2].map((ch) => ring.reduce((s, p) => s + p[ch], 0) / ring.length); const sd = Math.max(...[0, 1, 2].map((ch) => Math.sqrt(ring.reduce((s, p) => s + (p[ch] - mean[ch]) ** 2, 0) / ring.length)));
  const strip = (y0: number, y1: number) => { const px: number[][] = []; for (let yy = y0; yy < y1; yy += 1) for (let xx = 0; xx < S; xx += 1) px.push(at(xx, yy)); return [0, 1, 2].map((ch) => px.reduce((s, p) => s + p[ch], 0) / px.length); };
  const top = strip(0, band); const bottom = strip(S - band, S);
  let focus = { x: 0.5, y: 0.5 }; try { const { measures } = await measureImage(bytes); focus = { x: Math.min(0.8, Math.max(0.2, measures.subject.x)), y: Math.min(0.8, Math.max(0.2, measures.subject.y)) }; } catch { /* centred */ }
  if (clear / (ring.length) > 0.6) { let x0 = S; let y0 = S; let x1 = 0; let y1 = 0; for (let py = 0; py < S; py += 1) for (let px = 0; px < S; px += 1) if (d[(py * S + px) * 4 + 3] > 40) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); } const pad = 2; const bbox = { x: Math.max(0, x0 - pad) / S, y: Math.max(0, y0 - pad) / S, w: (Math.min(S, x1 + pad + 1) - Math.max(0, x0 - pad)) / S, h: (Math.min(S, y1 + pad + 1) - Math.max(0, y0 - pad)) / S }; return { mode: 'cutout', top: '#FFFFFF', bottom: '#FFFFFF', focus, bbox, why: 'the photo is a cut-out of the product with a clear background, so it stands on the page with a soft shadow' }; }
  const plain = sd < 16; return { mode: plain ? 'seamless' : 'card', top: hex(top[0], top[1], top[2]), bottom: hex(bottom[0], bottom[1], bottom[2]), focus, why: plain ? `the photo's four edges are one colour (spread ${Math.round(sd)}), so it is a product on a plain backdrop` : `the photo's edges are not one colour (spread ${Math.round(sd)}), so it is placed as a card` };
}

/**
 * How well a photo will work on social media, from the picture itself: sharp enough, well exposed with some contrast, and big enough to fill its place without being blown up.
 * A photo that scores low is never enlarged to fill the post, and a better one of the business's own photos is used when there is one.
 */
export type PhotoQuality = { score: number; width: number; height: number; sharpness: number; exposure: number; contrast: number; resolution: number; issues: string[] };
/** (pixels that are see-through, as in a cut-out, are left out of the measures) */
export async function photoQuality(photo: Photo): Promise<PhotoQuality> {
  const { createCanvas } = await import('@napi-rs/canvas'); const long = 256; const k = long / Math.max(photo.width, photo.height); const w = Math.max(16, Math.round(photo.width * k)); const h = Math.max(16, Math.round(photo.height * k));
  const c = createCanvas(w, h); const x = c.getContext('2d'); x.drawImage(photo.image as never, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; const g = new Float32Array(w * h); let sum = 0; let clipLo = 0; let clipHi = 0; let seen = 0;
  for (let i = 0; i < w * h; i += 1) { const v = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]); g[i] = v; if (d[i * 4 + 3] < 128) continue; seen += 1; sum += v; if (v < 8) clipLo += 1; if (v > 247) clipHi += 1; }
  seen = Math.max(1, seen); const mean = sum / seen; let varSum = 0; for (let i = 0; i < w * h; i += 1) if (d[i * 4 + 3] >= 128) varSum += (g[i] - mean) ** 2; const std = Math.sqrt(varSum / seen);
  let lap = 0; let n = 0; for (let yy = 1; yy < h - 1; yy += 1) for (let xx = 1; xx < w - 1; xx += 1) { const i = yy * w + xx; if (d[i * 4 + 3] < 128) continue; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; lap += l * l; n += 1; } const lapVar = lap / Math.max(1, n);
  const clamp = (v: number) => Math.max(0, Math.min(1, v)); const sharpness = clamp((Math.sqrt(lapVar) - 4) / 20); const clipped = (clipLo + clipHi) / seen;
  const exposure = clamp(1 - Math.abs(mean - 125) / 125) * clamp(1 - clipped * 3); const contrast = clamp((std - 18) / 40); const resolution = clamp((Math.min(photo.width, photo.height) - 380) / 700);
  const issues: string[] = []; if (sharpness < 0.3) issues.push('soft or blurry'); if (mean < 55) issues.push('too dark'); else if (mean > 215) issues.push('too bright'); if (std < 22) issues.push('flat, low contrast'); if (resolution < 0.2) issues.push('low resolution');
  return { score: Math.round((0.34 * sharpness + 0.26 * exposure + 0.14 * contrast + 0.26 * resolution) * 100) / 100, width: photo.width, height: photo.height, sharpness: Math.round(sharpness * 100) / 100, exposure: Math.round(exposure * 100) / 100, contrast: Math.round(contrast * 100) / 100, resolution: Math.round(resolution * 100) / 100, issues };
}
