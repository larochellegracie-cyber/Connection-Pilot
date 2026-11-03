/**
 * Reference-logo protection by fingerprint. The reference's logo is never reused (Pilot only ever draws the business's own logo, from the business's own
 * assets), and this proves it from the finished picture: while the reference is analysed, the part of a full-size frame where its logo sits is reduced to a
 * small grey pattern (the inside of the logo, away from its frame or chip), and a finished video can be searched for that pattern at three sizes. The
 * pattern is kept, never the reference's picture. A match is a correlation of 0.8 or more between the pattern and a window of the finished frame; flat
 * windows (nothing in them) can never match, and two different logos on the same kind of white chip do not, because only the inside is compared.
 */
export type LogoPosition = 'top_left' | 'top_center' | 'top_right' | 'bottom_left' | 'bottom_center' | 'bottom_right' | 'center';
export type Region = { x: number; y: number; w: number; h: number };
export const PATCH_W = 64; export const PATCH_H = 24; export const INSET = 0.12; export const LOGO_MATCH = 0.8; const MIN_SPREAD = 10;
/** `box` is the logo's own size (its chip or ink, as fractions of the frame); `cells` is the INSIDE of it only, so a chip's outline or empty space around a logo is never what is compared. */
export type Rgb = [number, number, number];
export type LogoPrint = { position: LogoPosition; region: Region; box: { w: number; h: number }; cells: number[]; /** the colour of the logo's ink and of the paper it is on (the darker and the lighter half of its pixels): reuse has to match these too, so ordinary dark text on a pale backdrop does not pass for a logo */ ink: Rgb; paper: Rgb };

/** Where a logo sits for each position (fractions of the frame): the small chips and signs logos are in a vertical video. */
export const REGIONS: Record<LogoPosition, Region> = {
  // vertical videos keep their logos inside the platform's safe area, so "top" is about 7 to 18 percent down
  top_left: { x: 0.02, y: 0.07, w: 0.26, h: 0.11 }, top_center: { x: 0.35, y: 0.07, w: 0.3, h: 0.11 }, top_right: { x: 0.72, y: 0.07, w: 0.26, h: 0.11 },
  bottom_left: { x: 0.02, y: 0.8, w: 0.26, h: 0.11 }, bottom_center: { x: 0.35, y: 0.8, w: 0.3, h: 0.11 }, bottom_right: { x: 0.72, y: 0.8, w: 0.26, h: 0.11 }, center: { x: 0.3, y: 0.44, w: 0.4, h: 0.12 },
};

/** A grey picture softened (a box blur, radius 2) so that a logo a pixel or two off, or a little sharper or softer, still lines up with its pattern. Both sides are softened the same way. */
export function smooth(gray: ArrayLike<number>, W: number, H: number, r = 2): Float32Array {
  const tmp = new Float32Array(W * H); const out = new Float32Array(W * H); const n = 2 * r + 1;
  for (let y = 0; y < H; y += 1) { let sum = 0; for (let x = -r; x <= r; x += 1) sum += gray[y * W + Math.min(W - 1, Math.max(0, x))]; for (let x = 0; x < W; x += 1) { tmp[y * W + x] = sum / n; sum += gray[y * W + Math.min(W - 1, x + r + 1)] - gray[y * W + Math.max(0, x - r)]; } }
  for (let x = 0; x < W; x += 1) { let sum = 0; for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x]; for (let y = 0; y < H; y += 1) { out[y * W + x] = sum / n; sum += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; } }
  return out;
}

/** The inside of a box (without the INSET margin on each side) as PATCH_W x PATCH_H grey values, by averaging. */
export function patchFromGray(gray: ArrayLike<number>, W: number, H: number, box: { x: number; y: number; w: number; h: number }): number[] {
  const ix = box.x + box.w * INSET; const iy = box.y + box.h * INSET; const iw = box.w * (1 - 2 * INSET); const ih = box.h * (1 - 2 * INSET); const out: number[] = [];
  for (let cy = 0; cy < PATCH_H; cy += 1) for (let cx = 0; cx < PATCH_W; cx += 1) {
    const x0 = Math.floor(ix + (cx * iw) / PATCH_W); const x1 = Math.max(x0 + 1, Math.floor(ix + ((cx + 1) * iw) / PATCH_W)); const y0 = Math.floor(iy + (cy * ih) / PATCH_H); const y1 = Math.max(y0 + 1, Math.floor(iy + ((cy + 1) * ih) / PATCH_H));
    let sum = 0; let n = 0; for (let y = y0; y < y1 && y < H; y += 1) for (let x = x0; x < x1 && x < W; x += 1) { if (x >= 0 && y >= 0) { sum += gray[y * W + x]; n += 1; } }
    out.push(n ? sum / n : 0);
  }
  return out;
}
const spread = (a: number[]) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
/** Whether a patch has anything in it (a logo is not a flat colour). */
export const hasContent = (cells: number[]) => spread(cells) >= MIN_SPREAD;
/** Pearson correlation of two patches; a flat patch correlates with nothing (0). */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length); const ma = a.reduce((s, v) => s + v, 0) / n; const mb = b.reduce((s, v) => s + v, 0) / n; let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < n; i += 1) { const x = a[i] - ma; const y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  if (Math.sqrt(saa / n) < MIN_SPREAD || Math.sqrt(sbb / n) < MIN_SPREAD) return 0;
  return sab / Math.sqrt(saa * sbb);
}

/**
 * Finds the logo inside the region where it was said to be: whatever differs clearly from the region's own background (the ring round its edge) is the logo or its
 * chip, and its bounding box (ignoring stray specks) is the logo's box. Null when nothing stands out (no logo is readable there).
 */
export function locateLogo(gray: ArrayLike<number>, W: number, H: number, region: Region): { x: number; y: number; w: number; h: number } | null {
  const rx = Math.floor(region.x * W); const ry = Math.floor(region.y * H); const rw = Math.floor(region.w * W); const rh = Math.floor(region.h * H); if (rw < 24 || rh < 12) return null;
  const ring: number[] = []; for (let y = 0; y < rh; y += 1) for (let x = 0; x < rw; x += 1) if (x < 3 || y < 3 || x >= rw - 3 || y >= rh - 3) ring.push(gray[(ry + y) * W + rx + x]);
  ring.sort((a, b) => a - b); const bg = ring[Math.floor(ring.length / 2)];
  const cols = new Array(rw).fill(0); const rows = new Array(rh).fill(0); let count = 0;
  for (let y = 3; y < rh - 3; y += 1) for (let x = 3; x < rw - 3; x += 1) if (Math.abs(gray[(ry + y) * W + rx + x] - bg) > 35) { cols[x] += 1; rows[y] += 1; count += 1; }
  if (count < 60) return null;
  const span = (a: number[], need: number) => { let lo = a.findIndex((v) => v >= need); let hi = a.length - 1 - [...a].reverse().findIndex((v) => v >= need); if (lo < 0 || hi < lo) return null; return [lo, hi] as const; };
  const sx = span(cols, 2); const sy = span(rows, 2); if (!sx || !sy) return null;
  const box = { x: rx + sx[0], y: ry + sy[0], w: sx[1] - sx[0] + 1, h: sy[1] - sy[0] + 1 };
  return box.w >= 16 && box.h >= 8 ? box : null;
}
/** A frame's brightness (0 to 255) from its RGBA bytes. */
export function lumaOf(rgba: ArrayLike<number>, W: number, H: number): Uint8Array { const g = new Uint8Array(W * H); for (let i = 0; i < W * H; i += 1) g[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]); return g; }
/** The ink and paper colours of the inside of a box: the mean colour of the darker half and of the lighter half of its pixels. */
export function inkAndPaper(rgba: ArrayLike<number>, gray: ArrayLike<number>, W: number, H: number, box: { x: number; y: number; w: number; h: number }): { ink: Rgb; paper: Rgb } {
  const x0 = Math.max(0, Math.floor(box.x + box.w * INSET)); const x1 = Math.min(W, Math.ceil(box.x + box.w * (1 - INSET))); const y0 = Math.max(0, Math.floor(box.y + box.h * INSET)); const y1 = Math.min(H, Math.ceil(box.y + box.h * (1 - INSET)));
  const px: Array<{ l: number; i: number }> = []; for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) px.push({ l: gray[y * W + x], i: (y * W + x) * 4 });
  px.sort((a, b) => a.l - b.l); const half = Math.max(1, Math.floor(px.length / 2)); const mean = (list: typeof px): Rgb => { const n = Math.max(1, list.length); return [0, 1, 2].map((c) => Math.round(list.reduce((s, p) => s + rgba[p.i + c], 0) / n)) as Rgb; };
  return { ink: mean(px.slice(0, Math.max(1, Math.floor(half * 0.5)))), paper: mean(px.slice(half)) };
}
const rgbDistance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Both colours of a window match the print's (within 70 of 441): a logo in other colours, or plain text on a backdrop, is not the same logo. */
export const colourMatches = (print: LogoPrint, found: { ink: Rgb; paper: Rgb }) => !!print.ink && !!print.paper && rgbDistance(print.ink, found.ink) <= 70 && rgbDistance(print.paper, found.paper) <= 70;

/** The pattern of a logo in a frame (RGBA bytes): located first, then only its inside and its colours are kept. Null when there is no readable logo in the region. */
export function printFromRgba(rgba: ArrayLike<number>, W: number, H: number, position: LogoPosition): LogoPrint | null {
  const region = REGIONS[position]; const gray = lumaOf(rgba, W, H); const box = locateLogo(gray, W, H, region); if (!box) return null;
  const cells = patchFromGray(smooth(gray, W, H), W, H, box); if (!hasContent(cells)) return null;
  return { position, region, box: { w: box.w / W, h: box.h / H }, cells, ...inkAndPaper(rgba, gray, W, H, box) };
}

/** A summed-area table, so the average of any box is four lookups. */
const integral = (g: ArrayLike<number>, W: number, H: number) => { const I = new Float64Array((W + 1) * (H + 1)); for (let y = 0; y < H; y += 1) { let row = 0; for (let x = 0; x < W; x += 1) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } } return I; };
const cellsFrom = (I: Float64Array, W: number, H: number, box: { x: number; y: number; w: number; h: number }, pw: number, ph: number): number[] => {
  const ix = box.x + box.w * INSET; const iy = box.y + box.h * INSET; const iw = box.w * (1 - 2 * INSET); const ih = box.h * (1 - 2 * INSET); const out = new Array<number>(pw * ph);
  const at = (x: number, y: number) => I[Math.min(H, Math.max(0, y)) * (W + 1) + Math.min(W, Math.max(0, x))];
  for (let cy = 0; cy < ph; cy += 1) for (let cx = 0; cx < pw; cx += 1) { const x0 = Math.floor(ix + (cx * iw) / pw); const x1 = Math.max(x0 + 1, Math.floor(ix + ((cx + 1) * iw) / pw)); const y0 = Math.floor(iy + (cy * ih) / ph); const y1 = Math.max(y0 + 1, Math.floor(iy + ((cy + 1) * ih) / ph)); out[cy * pw + cx] = (at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0)) / Math.max(1, (x1 - x0) * (y1 - y0)); }
  return out;
};
const shrink = (cells: number[], pw: number, ph: number, k: number) => { const w2 = pw / k; const h2 = ph / k; const out: number[] = []; for (let y = 0; y < h2; y += 1) for (let x = 0; x < w2; x += 1) { let s = 0; for (let j = 0; j < k; j += 1) for (let i = 0; i < k; i += 1) s += cells[(y * k + j) * pw + x * k + i]; out.push(s / (k * k)); } return out; };

/** The best match of the print anywhere in a finished frame, at three sizes; `gray` is the whole frame. A cheap coarse comparison picks the candidates and the full pattern confirms them. */
export function nearestWindow(rgba: ArrayLike<number>, W: number, H: number, print: LogoPrint, step = 4): { /** the best match of the pattern alone */ similarity: number; /** the best match that also has the logo's own colours: this is what counts as the logo being there */ confirmed: number; at: { x: number; y: number }; scale: number } {
  const gray = lumaOf(rgba, W, H); let best = { similarity: -1, confirmed: -1, at: { x: 0, y: 0 }, scale: 1 }; const I = integral(smooth(gray, W, H), W, H); const coarse = shrink(print.cells, PATCH_W, PATCH_H, 4);
  for (const scale of [0.7, 1, 1.4]) {
    const bw = Math.max(16, Math.round(print.box.w * W * scale)); const bh = Math.max(8, Math.round(print.box.h * H * scale));
    for (let y = 0; y + bh <= H; y += step) for (let x = 0; x + bw <= W; x += step) {
      const box = { x, y, w: bw, h: bh }; if (correlation(coarse, cellsFrom(I, W, H, box, PATCH_W / 4, PATCH_H / 4)) < 0.5) continue;
      const s = correlation(print.cells, cellsFrom(I, W, H, box, PATCH_W, PATCH_H)); const at = { x: Math.round((x / W) * 100) / 100, y: Math.round((y / H) * 100) / 100 };
      if (s > best.similarity) best = { ...best, similarity: s, at: s >= best.confirmed ? at : best.at, scale };
      if (s >= LOGO_MATCH && s > best.confirmed && colourMatches(print, inkAndPaper(rgba, gray, W, H, box))) best = { ...best, confirmed: s, at, scale };
    }
  }
  return best;
}
