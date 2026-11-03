import { FONT_FAMILY } from '../standard-video/fonts.js';
import type { Photo } from './photo.js';

type Ctx = import('@napi-rs/canvas').SKRSContext2D;
export type { Ctx };
export const num = (h: string) => parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
export const rgb = (h: string) => { const n = num(h); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export const mix = (a: string, b: string, t: number) => { const x = rgb(a); const y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
export const lum = (h: string) => rgb(h).reduce((s, v, i) => { const c = v / 255; return s + (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]; }, 0);
export const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
export const alpha = (h: string, a: number) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };
export const readable = (bg: string, light = '#FFFFFF', dark = '#1B1B1F') => (contrast(light, bg) >= contrast(dark, bg) ? light : dark);
export const font = (weight: number, size: number, family: string) => `${weight} ${size}px "${family}", "${FONT_FAMILY}", sans-serif`;
export function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (line && ctx.measureText(t).width > maxWidth) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  // the same number of lines, set evenly: never one long line and a stray word (an orphan) at the end
  if (lines.length >= 2 && words.length <= 24) {
    const n = words.length; const L = lines.length; const width = (i: number, j: number) => ctx.measureText(words.slice(i, j).join(' ')).width; const INF = 1e12;
    const cost: number[][] = Array.from({ length: L + 1 }, () => new Array(n + 1).fill(INF)); const from: number[][] = Array.from({ length: L + 1 }, () => new Array(n + 1).fill(0)); cost[0][0] = 0;
    for (let l = 1; l <= L; l += 1) for (let j = l; j <= n; j += 1) for (let i = l - 1; i < j; i += 1) { if (cost[l - 1][i] >= INF) continue; const w = width(i, j); if (w > maxWidth) continue; const c = cost[l - 1][i] + (maxWidth - w) ** 2 * (l === L ? 0.6 : 1); if (c < cost[l][j]) { cost[l][j] = c; from[l][j] = i; } }
    if (cost[L][n] < INF) { const out: string[] = []; let j = n; for (let l = L; l >= 1; l -= 1) { const i = from[l][j]; out.unshift(words.slice(i, j).join(' ')); j = i; } return out; }
  }
  return lines;
}
/** Sets the font and returns the wrapped lines at the largest size (down to `min`) that fits `maxLines` lines in `maxWidth`. */
export function fit(ctx: Ctx, text: string, family: string, weight: number, start: number, min: number, maxWidth: number, maxLines: number, tracking = 0): { size: number; lines: string[] } {
  const spacing = (size: number) => { (ctx as unknown as { letterSpacing: string }).letterSpacing = tracking ? `${tracking * size}px` : '0px'; };
  try {
    for (let size = start; size >= min; size -= 2) { ctx.font = font(weight, size, family); spacing(size); const lines = wrap(ctx, text, maxWidth); if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { size, lines }; }
    ctx.font = font(weight, min, family); spacing(min); return { size: min, lines: wrap(ctx, text, maxWidth).slice(0, maxLines) };
  } finally { (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'; }
}

export function feathered(ctx: Ctx, createCanvas: (w: number, h: number) => import('@napi-rs/canvas').Canvas, photo: Photo, x: number, y: number, w: number, h: number, edge: number) {
  const c = createCanvas(Math.round(w), Math.round(h)); const k = c.getContext('2d'); k.drawImage(photo.image as never, 0, 0, c.width, c.height);
  k.globalCompositeOperation = 'destination-in';
  const gx = k.createLinearGradient(0, 0, c.width, 0); const e = Math.min(0.5, edge / c.width); gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(e, 'rgba(0,0,0,1)'); gx.addColorStop(1 - e, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)'); k.fillStyle = gx; k.fillRect(0, 0, c.width, c.height);
  const gy = k.createLinearGradient(0, 0, 0, c.height); const f = Math.min(0.5, edge / c.height); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(f, 'rgba(0,0,0,1)'); gy.addColorStop(1 - f, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)'); k.fillStyle = gy; k.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(c as never, x, y);
}
export function coverBox(ctx: Ctx, photo: Photo, x: number, y: number, w: number, h: number, focus: { x: number; y: number }, radius: number, shadow: boolean, tone = '#000000', rim = false) {
  const scale = Math.max(w / photo.width, h / photo.height); const sw = w / scale; const sh = h / scale;
  const sx = Math.max(0, Math.min(photo.width - sw, focus.x * photo.width - sw / 2)); const sy = Math.max(0, Math.min(photo.height - sh, focus.y * photo.height - sh / 2));
  if (shadow) { // two shadows, a wide soft one and a tight one under the edge, both tinted by the page so they sit in it
    for (const [blur, dy, a] of [[w * 0.09, w * 0.03, 0.16], [w * 0.02, w * 0.006, 0.12]] as const) { ctx.save(); ctx.shadowColor = alpha(tone, a); ctx.shadowBlur = Math.round(blur); ctx.shadowOffsetY = Math.round(dy); ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); ctx.restore(); }
  }
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.clip(); ctx.drawImage(photo.image as never, sx, sy, sw, sh, x, y, w, h); ctx.restore();
  if (rim) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(2, w * 0.004); ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w - 2, h - 2, radius); ctx.stroke(); ctx.restore(); }
}
export const contain = (box: { w: number; h: number }, photo: Photo) => { const k = Math.min(box.w / photo.width, box.h / photo.height); return { w: photo.width * k, h: photo.height * k }; };

/** A hand-drawn style arrow from (x1, y1) curving to (x2, y2), with a small head. */
export function arrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, colour: string, width: number, bend: number) {
  const mx = (x1 + x2) / 2 + bend; const my = (y1 + y2) / 2 - Math.abs(bend) * 0.4;
  ctx.save(); ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
  const a = Math.atan2(y2 - my, x2 - mx); const L = width * 5; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5)); ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5)); ctx.stroke(); ctx.restore();
}


/** A photo cropped into a shape (rounded card, round, arch, or square-cornered), with the reference's frame treatment: a soft shadow, an offset outline, or a border. Never stretched. */
export function shapedPhoto(ctx: Ctx, photo: Photo, focus: { x: number; y: number }, x: number, y: number, w: number, h: number, shape: 'rect' | 'rounded' | 'circle' | 'arch', frame: 'none' | 'offset' | 'border' | 'shadow', accent: string, tone: string, radius: number) {
  const path = (px: number, py: number, pw: number, ph: number) => { ctx.beginPath(); if (shape === 'circle') ctx.ellipse(px + pw / 2, py + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2); else if (shape === 'arch') ctx.roundRect(px, py, pw, ph, [pw / 2, pw / 2, radius * 0.5, radius * 0.5]); else ctx.roundRect(px, py, pw, ph, shape === 'rect' ? 0 : radius); };
  const scale = Math.max(w / photo.width, h / photo.height); const sw = w / scale; const sh = h / scale; const sx = Math.max(0, Math.min(photo.width - sw, focus.x * photo.width - sw / 2)); const sy = Math.max(0, Math.min(photo.height - sh, focus.y * photo.height - sh / 2));
  if (frame === 'offset') { const off = Math.round(w * 0.035); ctx.save(); ctx.strokeStyle = alpha(accent, 0.6); ctx.lineWidth = Math.max(2.5, w * 0.006); path(x + off, y + off, w, h); ctx.stroke(); ctx.restore(); }
  if (frame === 'shadow' || frame === 'none') { if (frame === 'shadow') for (const [blur, dy, a] of [[w * 0.09, w * 0.03, 0.16], [w * 0.02, w * 0.006, 0.12]] as const) { ctx.save(); ctx.shadowColor = alpha(tone, a); ctx.shadowBlur = Math.round(blur); ctx.shadowOffsetY = Math.round(dy); ctx.fillStyle = '#FFFFFF'; path(x, y, w, h); ctx.fill(); ctx.restore(); } }
  ctx.save(); path(x, y, w, h); ctx.clip(); ctx.drawImage(photo.image as never, sx, sy, sw, sh, x, y, w, h); ctx.restore();
  if (frame === 'border') { ctx.save(); ctx.strokeStyle = accent; ctx.lineWidth = Math.max(4, w * 0.012); path(x - w * 0.02, y - w * 0.02, w + w * 0.04, h + w * 0.04); ctx.stroke(); ctx.restore(); }
  else { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = Math.max(2, w * 0.004); path(x + 1, y + 1, w - 2, h - 2); ctx.stroke(); ctx.restore(); }
}

/** The largest a box may be drawn for a photo so it is never blown up past what its own pixels support (about a quarter more than its size): the box shrinks, keeping its shape. */
export function capToPhoto(box: { w: number; h: number }, photo: { width: number; height: number }, allow = 1.25): { w: number; h: number; scaled: boolean } {
  const scale = Math.max(box.w / photo.width, box.h / photo.height); if (scale <= allow) return { ...box, scaled: false }; const f = allow / scale; return { w: box.w * f, h: box.h * f, scaled: true };
}
