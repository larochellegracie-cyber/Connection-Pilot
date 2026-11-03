import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ReferenceProblem } from '../reference/shared.js';
import { colourRoles, type ColourRoles } from '../reference/colour.js';
import { printFromRgba, type LogoPosition, type LogoPrint } from '../reference/logo.js';

/**
 * Measures a reference image the owner uploaded: its shape and size, brightness, contrast, colours, where the busy and calm parts are, whether it is a
 * photograph or a drawn graphic, and what its background is made of. This is plain measuring (free, on this server). What the design looks like in words
 * (layout, type, mood) is described separately from the picture itself (see style.ts). Nothing of the reference's words, logos or content is kept.
 */
export type Palette = { hex: string; share: number };
export type ImageMeasures = {
  width: number; height: number; aspectRatio: string; orientation: 'square' | 'portrait' | 'landscape';
  brightness: number; contrast: number; saturation: number;
  palette: Palette[]; background: string; accent: string;
  /** luminance (0 to 1) and detail (0 to 1) of each of the nine parts of the picture, row by row */ grid: Array<{ luminance: number; detail: number }>;
  /** where the main subject is, from where the detail is: centre of the detail as 0..1 from the left and top */ subject: { x: number; y: number; spread: number };
  placement: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'full_bleed';
  /** the calmest third of the picture, where text sits easily */ calmest: 'top' | 'middle' | 'bottom';
  photographic: boolean; backgroundKind: 'solid' | 'gradient' | 'photo';
  /** the colours by role (backdrop, floor, light, hero, accent, text), measured from the picture */ roles?: ColourRoles;
  /** for a split layout: the colours of the half that holds the words */ pageRoles?: ColourRoles;
  /** where the light comes from and how hard the shadows are, from the picture's own brightness */ lighting?: Lighting;
};
export type Lighting = { direction: 'left' | 'right' | 'top' | 'front' | 'even'; softness: 'soft' | 'medium' | 'hard'; shadows: 'none' | 'light' | 'strong'; temperature: 'warm' | 'neutral' | 'cool'; contrastRatio: number };

/** Where the light falls and how strong the shadows are, from the brightness of the sides, the top and the bottom of the picture. */
export function measureLighting(rgba: ArrayLike<number>, side: number, roles: ColourRoles): Lighting {
  const l = (x: number, y: number) => { const i = (y * side + x) * 4; return (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) / 255; };
  const mean = (x0: number, x1: number, y0: number, y1: number) => { let t = 0; let n = 0; for (let y = Math.floor(y0 * side); y < Math.ceil(y1 * side); y += 1) for (let x = Math.floor(x0 * side); x < Math.ceil(x1 * side); x += 1) { t += l(x, y); n += 1; } return n ? t / n : 0; };
  const left = mean(0, 0.33, 0.2, 0.8); const right = mean(0.67, 1, 0.2, 0.8); const top = mean(0.2, 0.8, 0, 0.33); const bottom = mean(0.2, 0.8, 0.67, 1);
  const side2 = Math.abs(left - right); const vert = top - bottom;
  const direction = side2 > 0.08 && side2 >= Math.abs(vert) ? (left > right ? 'left' : 'right') : vert > 0.08 ? 'top' : Math.abs(vert) <= 0.04 && side2 <= 0.04 ? 'even' : 'front';
  // the darkest and the lightest 5% of the picture: a wide gap with dark patches near the light is hard light with shadows
  const all: number[] = []; for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) all.push(l(x, y)); all.sort((a, b) => a - b);
  const lo = all[Math.floor(all.length * 0.05)] ?? 0; const hi = all[Math.floor(all.length * 0.95)] ?? 1; const ratio = (hi + 0.05) / (lo + 0.05);
  // sharp steps between neighbours mean hard edges (hard light); smooth ones mean soft light
  let steps = 0; let count = 0; for (let y = 0; y < side - 1; y += 1) for (let x = 0; x < side - 1; x += 1) { steps += Math.abs(l(x, y) - l(x + 1, y)) + Math.abs(l(x, y) - l(x, y + 1)); count += 2; }
  const edge = count ? steps / count : 0;
  return { direction, softness: edge > 0.07 ? 'hard' : edge > 0.035 ? 'medium' : 'soft', shadows: ratio > 6 ? 'strong' : ratio > 2.6 ? 'light' : 'none', temperature: roles.temperature, contrastRatio: Math.round(ratio * 10) / 10 };
}

export const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;
const SIDE = 64;

/** PNG, JPEG or WebP by their first bytes (whatever the file is called). */
export function imageType(bytes: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (bytes.length < 16) return null;
  if (bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}
export const looksLikeImage = (bytes: Buffer) => imageType(bytes) !== null;

const RATIOS: Array<[string, number]> = [['1:1', 1], ['4:5', 0.8], ['3:4', 0.75], ['2:3', 0.667], ['9:16', 0.5625], ['5:4', 1.25], ['4:3', 1.333], ['3:2', 1.5], ['16:9', 1.778]];
export function aspectLabel(width: number, height: number): string {
  const r = width / height;
  return RATIOS.reduce((best, item) => (Math.abs(item[1] - r) < Math.abs(best[1] - r) ? item : best))[0];
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = (r: number, g: number, b: number) => { const max = Math.max(r, g, b); const min = Math.min(r, g, b); return max === 0 ? 0 : (max - min) / max; };

/** The measurements from a small RGBA picture (SIDE by SIDE). Exported so they can be tested without an image library. */
export function measurePixels(rgba: Uint8ClampedArray | Buffer, side: number, width: number, height: number): ImageMeasures {
  const n = side * side; const L = new Float32Array(n); let sum = 0; let satSum = 0;
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>(); const colours = new Set<string>();
  for (let i = 0; i < n; i += 1) {
    const r = rgba[i * 4]; const g = rgba[i * 4 + 1]; const b = rgba[i * 4 + 2];
    L[i] = lum(r, g, b); sum += L[i]; satSum += sat(r, g, b);
    const key = `${r >> 5}${g >> 5}${b >> 5}`; colours.add(`${r >> 3},${g >> 3},${b >> 3}`);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }; bucket.n += 1; bucket.r += r; bucket.g += g; bucket.b += b; buckets.set(key, bucket);
  }
  const mean = sum / n; let variance = 0; for (let i = 0; i < n; i += 1) variance += (L[i] - mean) ** 2;
  // detail: how much the picture changes from one small step to the next
  const D = new Float32Array(n);
  for (let y = 0; y < side - 1; y += 1) for (let x = 0; x < side - 1; x += 1) D[y * side + x] = Math.abs(L[y * side + x] - L[y * side + x + 1]) + Math.abs(L[y * side + x] - L[(y + 1) * side + x]);
  const grid: ImageMeasures['grid'] = []; const cell = Math.floor(side / 3);
  for (let gy = 0; gy < 3; gy += 1) for (let gx = 0; gx < 3; gx += 1) {
    let l = 0; let d = 0; let c = 0;
    for (let y = gy * cell; y < (gy + 1) * cell; y += 1) for (let x = gx * cell; x < (gx + 1) * cell; x += 1) { l += L[y * side + x]; d += D[y * side + x]; c += 1; }
    grid.push({ luminance: Math.round((l / c) * 100) / 100, detail: Math.round(Math.min(1, (d / c) * 4) * 100) / 100 });
  }
  let dx = 0; let dy = 0; let dt = 0;
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) { const d = D[y * side + x]; dx += d * x; dy += d * y; dt += d; }
  const sx = dt ? dx / dt / side : 0.5; const sy = dt ? dy / dt / side : 0.5;
  let spread = 0; if (dt) for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) spread += D[y * side + x] * Math.hypot(x / side - sx, y / side - sy); spread = dt ? spread / dt : 0;
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  const palette = ranked.slice(0, 5).map((bucket) => ({ hex: hex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n), share: Math.round((bucket.n / n) * 100) / 100 }));
  // the background is the colour of the edge of the picture; the accent is the most colourful frequent colour that is not the background
  const edge = new Map<string, number>(); for (let i = 0; i < side; i += 1) for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]]) { const p = (y * side + x) * 4; const key = `${rgba[p] >> 5}${rgba[p + 1] >> 5}${rgba[p + 2] >> 5}`; edge.set(key, (edge.get(key) ?? 0) + 1); }
  const edgeKey = [...edge.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; const edgeBucket = edgeKey ? buckets.get(edgeKey) : undefined;
  const background = edgeBucket ? hex(edgeBucket.r / edgeBucket.n, edgeBucket.g / edgeBucket.n, edgeBucket.b / edgeBucket.n) : palette[0]?.hex ?? '#808080';
  const accentBucket = ranked.filter((bucket) => lum(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n) > 0.2 && Math.hypot(bucket.r / bucket.n - (edgeBucket ? edgeBucket.r / edgeBucket.n : 0), bucket.g / bucket.n - (edgeBucket ? edgeBucket.g / edgeBucket.n : 0), bucket.b / bucket.n - (edgeBucket ? edgeBucket.b / edgeBucket.n : 0)) > 60 && sat(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n) > 0.35 && bucket.n / n > 0.01).sort((a, b) => sat(b.r / b.n, b.g / b.n, b.b / b.n) * Math.sqrt(b.n) - sat(a.r / a.n, a.g / a.n, a.b / a.n) * Math.sqrt(a.n))[0];
  const accent = accentBucket ? hex(accentBucket.r / accentBucket.n, accentBucket.g / accentBucket.n, accentBucket.b / accentBucket.n) : palette[1]?.hex ?? palette[0]?.hex ?? '#808080';
  const edgeShare = edgeKey ? (edge.get(edgeKey) ?? 0) / (side * 4) : 0;
  // background: a single colour at the edge is a solid; a smooth change from one side to the other is a gradient; otherwise it is a photograph
  const topL = (grid[0].luminance + grid[1].luminance + grid[2].luminance) / 3; const botL = (grid[6].luminance + grid[7].luminance + grid[8].luminance) / 3;
  const photographic = colours.size / n > 0.35 && (grid.reduce((s, g) => s + g.detail, 0) / 9) > 0.12;
  const backgroundKind: ImageMeasures['backgroundKind'] = edgeShare > 0.8 ? 'solid' : !photographic && Math.abs(topL - botL) > 0.08 ? 'gradient' : photographic ? 'photo' : 'solid';
  const rowDetail = [0, 1, 2].map((row) => (grid[row * 3].detail + grid[row * 3 + 1].detail + grid[row * 3 + 2].detail) / 3);
  const calmest = (['top', 'middle', 'bottom'] as const)[rowDetail.indexOf(Math.min(...rowDetail))];
  const placement: ImageMeasures['placement'] = spread > 0.34 || (grid.every((g) => g.detail > 0.15)) ? 'full_bleed' : Math.hypot(sx - 0.5, sy - 0.5) < 0.12 ? 'center' : Math.abs(sx - 0.5) >= Math.abs(sy - 0.5) ? (sx < 0.5 ? 'left' : 'right') : sy < 0.5 ? 'top' : 'bottom';
  const orientation = Math.abs(width / height - 1) < 0.06 ? 'square' : width > height ? 'landscape' : 'portrait';
  return { width, height, aspectRatio: aspectLabel(width, height), orientation, brightness: Math.round(mean * 100) / 100, contrast: Math.round(Math.sqrt(variance / n) * 100) / 100, saturation: Math.round((satSum / n) * 100) / 100, palette, background, accent, grid, subject: { x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100, spread: Math.round(spread * 100) / 100 }, placement, calmest, photographic, backgroundKind };
}

/** Reads the picture (from a short-lived private file, as the image library cannot read some large files from memory) and measures it. */
/** The picture at a size where a logo can be fingerprinted (540 on the short side), kept only while the analysis runs. */
export type Frame = { rgba: Buffer; width: number; height: number };
export async function measureImage(bytes: Buffer): Promise<{ measures: ImageMeasures; small: Buffer; frame: Frame }> {
  if (!imageType(bytes)) throw new ReferenceProblem('That doesn’t look like a picture. Please upload a PNG, JPEG or WebP image.');
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) throw new ReferenceProblem('That image is larger than 25 MB. Please upload a smaller one.');
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-reference-'));
  try {
    const file = path.join(dir, 'picture'); await writeFile(file, bytes, { mode: 0o600 });
    const image = await loadImage(file).catch(() => { throw new ReferenceProblem('Pilot couldn’t read that image. Please try another one.'); });
    if (image.width < 200 || image.height < 200) throw new ReferenceProblem('That image is too small to learn a design from. Please use one that is at least 200 pixels on each side.');
    if (image.width * image.height > 80_000_000) throw new ReferenceProblem('That image is too large. Please upload a smaller one.');
    const canvas = createCanvas(SIDE, SIDE); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, SIDE, SIDE);
    const measures = measurePixels(ctx.getImageData(0, 0, SIDE, SIDE).data, SIDE, image.width, image.height);
    // the colours by role and the light, from a 96-pixel square view of the whole picture
    const R = 96; const rc = createCanvas(R, R); const rctx = rc.getContext('2d'); rctx.drawImage(image, 0, 0, R, R); const rdata = rctx.getImageData(0, 0, R, R).data;
    measures.roles = colourRoles(rdata, R); measures.lighting = measureLighting(rdata, R, measures.roles);
    // a 540-wide frame, used once to take the logo's fingerprint
    const fw = 540; const fh = Math.max(64, Math.round((540 * image.height) / image.width)); const fc = createCanvas(fw, fh); const fctx = fc.getContext('2d'); fctx.drawImage(image, 0, 0, fw, fh);
    const frame: Frame = { rgba: Buffer.from(fctx.getImageData(0, 0, fw, fh).data.buffer), width: fw, height: fh };
    // a small copy (about 768 pixels on the long side) for the model to look at; it is not kept
    const scale = Math.min(1, 768 / Math.max(image.width, image.height)); const view = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    view.getContext('2d').drawImage(image, 0, 0, view.width, view.height);
    return { measures, small: view.toBuffer('image/jpeg', 82), frame };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export function logoPrintOf(frame: Frame, position: LogoPosition): LogoPrint | null { return printFromRgba(frame.rgba, frame.width, frame.height, position); }

/** A finished picture as a 540-wide frame, to check it for the reference's logo. */
export async function frameOf(bytes: Buffer): Promise<Frame> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-check-'));
  try {
    const file = path.join(dir, 'picture'); await writeFile(file, bytes, { mode: 0o600 }); const image = await loadImage(file);
    const fw = 540; const fh = Math.max(64, Math.round((540 * image.height) / image.width)); const c = createCanvas(fw, fh); const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0, fw, fh);
    return { rgba: Buffer.from(ctx.getImageData(0, 0, fw, fh).data.buffer), width: fw, height: fh };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
