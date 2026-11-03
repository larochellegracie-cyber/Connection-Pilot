import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureFonts, FONT_FAMILY } from '../standard-video/fonts.js';
import type { BrandKit } from '../standard-video/templates.js';
import type { Aspect, Blueprint } from './style.js';
import type { DesignPalette } from '../reference/design.js';

/**
 * Draws a new picture from a design blueprint (see style.ts) and the business's own content: its words, its colours and logo, and its own photo.
 * The reference image is not an input here at all: only the blueprint (layout, tone, type, spacing, accents) is, so nothing of the reference's pixels,
 * words or logos can reach the result. Drawn on this server (free). Text always goes through the same wrapping, fitting and contrast rules.
 */
export type Copy = { headline: string; subline: string; cta: string };
export type RenderInput = {
  blueprint: Blueprint; copy: Copy; businessName: string; kit: BrandKit; photo: Buffer | null; logo: Buffer | null;
  /** the reference's own colours (backdrop, floor, words), used while the picture keeps the reference's tone; the business's accent colour still colours the button and rules */ palette?: DesignPalette;
  /** a floor the reference shows under its backdrop (fraction of the height where it begins) and the colour of it */ floor?: { horizon: number; colour: string };
  /** a drawn product (a transparent illustration) standing in for a photo the business does not have */ drawn?: Buffer | null;
  /** how the reference is lit, so the drawn product is lit the same way */ lighting?: { direction: string; shadows: string; temperature: string };
  /** where the reference's light comes from: the shadow under the subject falls the other way */ light?: 'left' | 'right' | 'top' | 'front' | 'even';
};

const SIZES: Record<Aspect, [number, number]> = { '1:1': [1080, 1080], '4:5': [1080, 1350], '3:4': [1080, 1440], '9:16': [1080, 1920], '16:9': [1600, 900] };
export const sizeOf = (aspect: Aspect) => SIZES[aspect];

const num = (h: string) => parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
const rgb = (h: string) => { const n = num(h); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a: string, b: string, t: number) => { const x = rgb(a); const y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const luminance = (h: string) => rgb(h).reduce((s, v, i) => { const c = v / 255; const l = c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; return s + l * [0.2126, 0.7152, 0.0722][i]; }, 0);
export const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgba = (h: string, a: number) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

export type Colours = { bgA: string; bgB: string; text: string; accent: string; onAccent: string; muted: string };
/** The business's own colours, used in the reference's tone: a dark reference gives a dark version of the brand, a light one a light version. */
export function coloursFor(kit: BrandKit, tone: 'dark' | 'light', shift = 0): Colours {
  // the brand's darkest colour is the base of a dark look (an orange brand gets a deep navy or charcoal, not a muddy brown)
  const base = [kit.primary, kit.secondary, kit.accent].reduce((best, colour) => (luminance(colour) < luminance(best) ? colour : best));
  kit = { ...kit, primary: tone === 'dark' ? base : kit.primary };
  const move = (colour: string) => (shift < 0 ? mix(colour, tone === 'dark' ? '#000000' : mix(kit.primary, '#000000', 0.55), -shift * 1.4) : shift > 0 ? mix(colour, '#FFFFFF', shift * 1.2) : colour);
  const bgA = move(tone === 'dark' ? mix(kit.primary, '#000000', 0.72) : '#FFFFFF'); const bgB = move(tone === 'dark' ? mix(kit.primary, '#000000', 0.88) : mix(kit.primary, '#FFFFFF', 0.9));
  const text = contrast('#FFFFFF', bgA) >= contrast('#111111', bgA) ? '#FFFFFF' : tone === 'dark' ? '#111111' : mix(kit.primary, '#000000', 0.78);
  const candidates = [kit.accent, kit.secondary, kit.primary, '#E8B04A'];
  const accent = candidates.find((c) => contrast(c, bgA) >= 3) ?? (tone === 'dark' ? '#FFFFFF' : '#111111');
  return { bgA, bgB, text, accent, onAccent: contrast('#FFFFFF', accent) >= contrast('#111111', accent) ? '#FFFFFF' : '#111111', muted: mix(text, bgA, 0.35) };
}

/** The business's colours in the reference's tone, or, when the reference's own palette is given and the picture still has the reference's tone, the reference's backdrop and words with the business's accent. */
export function coloursWith(kit: BrandKit, bp: Blueprint, palette?: DesignPalette): Colours & { floor?: string } {
  const own = coloursFor(kit, bp.tone, bp.shift);
  if (!palette) return own;
  // the reference's own tone as it is; a darker or lighter version of the SAME colours when the owner changes the tone ("make it darker")
  const same = (palette.light ? 'light' : 'dark') === bp.tone;
  const base = same ? { a: palette.bgA, b: palette.bgB, f: palette.bgB } : bp.tone === 'dark' ? { a: mix(palette.bgB, '#000000', 0.5), b: mix(palette.bgB, '#000000', 0.62), f: mix(palette.bgB, '#000000', 0.8) } : { a: mix(palette.bgA, '#FFFFFF', 0.7), b: mix(palette.bgA, '#FFFFFF', 0.45), f: mix(palette.bgA, '#FFFFFF', 0.3) };
  const move = (colour: string) => (bp.shift < 0 ? mix(colour, '#000000', -bp.shift * 1.4) : bp.shift > 0 ? mix(colour, '#FFFFFF', bp.shift * 1.2) : colour);
  const bgA = move(base.a); const bgB = move(base.b);
  const text = same && contrast(palette.text ?? own.text, bgA) >= 4.5 && bp.shift === 0 ? palette.text! : contrast('#FFFFFF', bgA) >= contrast('#111111', bgA) ? '#FFFFFF' : mix(palette.toneA, '#000000', 0.75);
  const accent = [kit.accent, kit.secondary, kit.primary, own.accent].find((a) => contrast(a, bgA) >= 3) ?? own.accent;
  return { bgA, bgB, text, accent, onAccent: contrast('#FFFFFF', accent) >= contrast('#111111', accent) ? '#FFFFFF' : '#111111', muted: mix(text, bgA, 0.35), floor: move(base.f) };
}

type Ctx = import('@napi-rs/canvas').SKRSContext2D;
let makeCanvas: ((w: number, h: number) => import('@napi-rs/canvas').Canvas) | null = null;
const createLayer = (w: number, h: number) => makeCanvas!(w, h);
const SIZE_FACTOR = { xxl: 0.13, xl: 0.108, l: 0.088, m: 0.068, s: 0.052 } as const;

function wrapLines(ctx: Ctx, text: string, maxWidth: number, spacing: number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let line = '';
  const width = (s: string) => ctx.measureText(s).width + spacing * s.length;
  for (const word of words) { const test = line ? `${line} ${word}` : word; if (line && width(test) > maxWidth) { lines.push(line); line = word; } else line = test; }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}
function drawLine(ctx: Ctx, text: string, x: number, y: number, align: 'left' | 'center' | 'right', spacing: number) {
  if (spacing <= 0.5) { ctx.textAlign = align; ctx.fillText(text, x, y); return; }
  ctx.textAlign = 'left';
  const total = ctx.measureText(text).width + spacing * (text.length - 1); let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const ch of text) { ctx.fillText(ch, cursor, y); cursor += ctx.measureText(ch).width + spacing; }
}

function shapePath(ctx: Ctx, shape: Blueprint['subject']['shape'], x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  if (shape === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'arch') { const r = w / 2; ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath(); }
  else { const r = shape === 'rounded' ? Math.min(w, h) * 0.06 : 0; ctx.roundRect(x, y, w, h, r); }
}

async function loadBuffer(bytes: Buffer) {
  const { loadImage } = await import('@napi-rs/canvas');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-design-'));
  try { const file = path.join(dir, 'picture'); await writeFile(file, bytes, { mode: 0o600 }); return await loadImage(file); } finally { await rm(dir, { recursive: true, force: true }); }
}
function cover(ctx: Ctx, image: { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height); const sw = w / scale; const sh = h / scale;
  ctx.drawImage(image as never, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

export async function renderDesign(input: RenderInput): Promise<Buffer> {
  await ensureFonts();
  const { createCanvas } = await import('@napi-rs/canvas'); makeCanvas = createCanvas;
  const { blueprint: bp, copy, kit } = input; const [W, H] = sizeOf(bp.aspect); const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
  const c = coloursWith(kit, bp, input.palette); const photo = input.photo ? await loadBuffer(input.photo) : null; const logo = input.logo ? await loadBuffer(input.logo).catch(() => null) : null;
  // a logo at the bottom would sit on the button, so with a button it goes to the top instead
  const effLogo = input.blueprint.logo === 'bottom_center' && input.blueprint.text && input.blueprint.cta.style !== 'none' && input.copy.cta ? 'top_center' : input.blueprint.logo;
  const short = Math.min(W, H); const m = Math.round(bp.margin * short);
  const full = !!photo && (bp.subject.placement === 'full_bleed' || bp.background.kind === 'photo');
  // with no photo of the owner's, the business's own logo takes the place of the picture (never an invented product)
  const drawnImg = !photo && input.drawn ? await loadBuffer(input.drawn).catch(() => null) : null;
  const logoSubject = !photo && !drawnImg && !!logo && bp.subject.placement !== 'full_bleed'; const subjectImg = photo ?? drawnImg ?? (logoSubject ? logo : null);
  const grade = drawnImg ? { lighting: input.lighting, colour: c.bgA } : undefined;
  const columns = !!subjectImg && !full && (bp.subject.placement === 'left' || bp.subject.placement === 'right');

  // ---- background
  if (full && photo) { cover(ctx, photo, 0, 0, W, H); }
  else {
    const g = bp.background.kind === 'solid' ? null : bp.background.direction === 'radial' ? ctx.createRadialGradient(W / 2, H * 0.4, short * 0.1, W / 2, H * 0.4, Math.max(W, H) * 0.8) : bp.background.direction === 'diagonal' ? ctx.createLinearGradient(0, 0, W, H) : ctx.createLinearGradient(0, 0, 0, H);
    if (g) { g.addColorStop(0, c.bgA); g.addColorStop(1, c.bgB); ctx.fillStyle = g; } else ctx.fillStyle = c.bgA;
    ctx.fillRect(0, 0, W, H);
  }
  // a floor under the backdrop, as in the reference (a product stands on it)
  const floorY = input.floor && !full && (photo || drawnImg || logoSubject) ? Math.round(H * Math.min(0.85, Math.max(0.45, input.floor.horizon))) : null;
  if (floorY !== null && input.floor) { const f = ctx.createLinearGradient(0, floorY, 0, H); const fc0 = c.floor ?? input.floor.colour; f.addColorStop(0, fc0); f.addColorStop(1, mix(fc0, '#000000', 0.18)); ctx.fillStyle = f; ctx.fillRect(0, floorY, W, H - floorY); const h = ctx.createLinearGradient(0, floorY - 6, 0, floorY + 10); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,0.12)'); ctx.fillStyle = h; ctx.fillRect(0, floorY - 6, W, 16); }
  const ground = floorY !== null ? { y: floorY, dx: input.light === 'left' ? 1 : input.light === 'right' ? -1 : 0 } : undefined;
  if (bp.accents.includes('glow') && !full) { const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, short * 0.75); g.addColorStop(0, rgba(c.accent, bp.tone === 'dark' ? 0.28 : 0.16)); g.addColorStop(1, rgba(c.accent, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }

  // ---- text sizes (shrunk until everything fits)
  const wantText = bp.text && !!copy.headline;
  const align = columns ? 'left' : bp.headline.align;
  const headlineText = bp.headline.caps ? copy.headline.toUpperCase() : copy.headline;
  const layout = (scale: number, width: number) => {
    const hs = Math.round(short * SIZE_FACTOR[bp.headline.size] * scale * (W > H ? 1.15 : 1)); const ss = Math.round(hs * 0.42); const cs = Math.round(hs * 0.4); const spacing = bp.headline.spacing * hs;
    ctx.font = `${bp.headline.weight} ${hs}px ${FONT_FAMILY}`; const hl = wantText ? wrapLines(ctx, headlineText, width, spacing) : [];
    ctx.font = `400 ${ss}px ${FONT_FAMILY}`; const sl = wantText && bp.subline && copy.subline ? wrapLines(ctx, copy.subline, width, 0).slice(0, 3) : [];
    const headH = hl.length * hs * 1.08; const subH = sl.length * ss * 1.3; const ctaH = wantText && bp.cta.style !== 'none' && copy.cta ? cs * 2.1 : 0;
    return { hs, ss, cs, spacing, hl, sl, headH, subH, ctaH, gap: hs * 0.32 };
  };
  const textWidth = columns ? Math.round((W - 2 * m) * (1 - Math.min(0.6, bp.subject.scale)) - m * 0.5) : W - 2 * m;
  let scale = 1; let t = layout(scale, textWidth);
  const textHeight = (x: ReturnType<typeof layout>) => x.headH + (x.subH ? x.gap + x.subH : 0) + (x.ctaH && bp.cta.position === 'below_text' ? x.gap * 1.6 + x.ctaH : 0);
  // the words may not take the room the picture needs (a stack keeps at least a third of the short side for it, below the button)
  const limitFor = (x: ReturnType<typeof layout>) => full ? H * 0.5 : columns ? H - 2 * m : subjectImg ? H - 3.2 * m - short * 0.1 - short * 0.32 - (x.ctaH ? x.ctaH + x.gap * 1.5 : 0) : H * 0.7;
  while (scale > 0.6 && wantText && t.hl.length > 2) { scale -= 0.06; t = layout(scale, textWidth); }
  while (scale > 0.45 && textHeight(t) > limitFor(t)) { scale -= 0.06; t = layout(scale, textWidth); }

  // ---- the picture (the business's own photo), and where the words go
  let textX = align === 'center' ? W / 2 : align === 'right' ? W - m : m; let textY = m; let ctaY = H - m - t.ctaH;
  const showLogo = effLogo !== 'none' && !logoSubject; const logoBand = showLogo && (logo || input.businessName) ? Math.round(short * 0.1) : 0;
  const topSafe = m + (showLogo && effLogo.startsWith('top') ? logoBand : 0);
  const textBlockH = textHeight(t) + (bp.accents.includes('rule') ? t.hs * 0.5 : 0);
  if (full && photo) {
    // a shade over the photo so the words always read, darkest on the side the words are on
    const shade = Math.max(0.35, bp.overlay); const pos = bp.headline.position;
    const g = pos === 'top' ? ctx.createLinearGradient(0, 0, 0, H * 0.7) : pos === 'left' ? ctx.createLinearGradient(0, 0, W * 0.75, 0) : ctx.createLinearGradient(0, H, 0, H * 0.25);
    if (pos === 'center') { ctx.fillStyle = rgba(c.bgB, shade); ctx.fillRect(0, 0, W, H); } else { g.addColorStop(0, rgba(c.bgB, Math.min(0.92, shade + 0.4))); g.addColorStop(1, rgba(c.bgB, bp.tone === 'dark' ? 0.08 : 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    if (bp.background.vignette) { const v = ctx.createRadialGradient(W / 2, H / 2, short * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); }
    textY = pos === 'top' ? topSafe : pos === 'center' ? (H - textBlockH) / 2 : H - m - (bp.cta.position === 'bottom' ? t.ctaH + t.gap * 1.5 : 0) - textBlockH; if (pos === 'left') textY = (H - textBlockH) / 2;
  } else if (subjectImg && columns) {
    const colW = Math.round((W - 2 * m) * Math.min(0.6, Math.max(0.4, bp.subject.scale))); const boxH = Math.min(H - 2 * m - logoBand, colW * 1.25); const left = bp.subject.placement === 'left';
    const x = left ? m : W - m - colW; const y = (H - boxH) / 2 + logoBand / 3; drawSubject(ctx, bp, c, subjectImg, x, y, colW, boxH, logoSubject, ground, grade);
    textX = left ? m + colW + m * 0.7 : m; textY = Math.max(topSafe, (H - textBlockH) / 2); ctaY = H - m - t.ctaH;
  } else if (subjectImg) {
    // a stack: words above or below, the picture in the rest of the height, the call to action last
    const pos = bp.headline.position; const room = H - topSafe - m - (t.ctaH && bp.cta.position === 'bottom' ? t.ctaH + t.gap * 1.5 : 0) - textBlockH - m * 0.8;
    const boxW = Math.min(W - 2 * m, Math.round((W - 2 * m) * Math.max(0.55, bp.subject.scale))); const boxH = Math.max(short * 0.3, Math.min(room, boxW * (bp.subject.shape === 'arch' ? 1.25 : 1.05)));
    const w = bp.subject.shape === 'circle' ? Math.min(boxW, boxH) : bp.subject.shape === 'arch' ? Math.min(boxW, boxH * 0.8) : boxW; const h = bp.subject.shape === 'circle' ? w : boxH;
    if (pos === 'top') { textY = topSafe; drawSubject(ctx, bp, c, subjectImg, (W - w) / 2, textY + textBlockH + m * 0.8 + Math.max(0, (room - h) / 2), w, h, logoSubject, ground, grade); }
    else { const y = topSafe + Math.max(0, (room - h) / 2); drawSubject(ctx, bp, c, subjectImg, (W - w) / 2, y, w, h, logoSubject, ground, grade); textY = y + h + m * 0.8; }
  } else {
    // no photo: the words carry the design on the brand's own background (a graphic accent block stands in for the picture; nothing is invented)
    const pos = bp.headline.position; textY = pos === 'top' ? topSafe + m : pos === 'bottom' ? H - m - (t.ctaH ? t.ctaH + t.gap * 1.5 : 0) - textBlockH : (H - textBlockH) / 2 - (t.ctaH ? t.ctaH / 2 : 0);
    if (bp.accents.length === 0 || !bp.accents.includes('glow')) { const g = ctx.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, short * 0.7); g.addColorStop(0, rgba(c.accent, 0.22)); g.addColorStop(1, rgba(c.accent, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  }

  // ---- accents
  const lineW = Math.max(2, Math.round(short * 0.004));
  if (bp.accents.includes('frame')) { ctx.strokeStyle = rgba(c.accent, 0.85); ctx.lineWidth = lineW; ctx.strokeRect(m * 0.55, m * 0.55, W - m * 1.1, H - m * 1.1); }
  if (bp.accents.includes('corner_marks')) { const L = short * 0.07; ctx.strokeStyle = c.accent; ctx.lineWidth = lineW * 1.5; for (const [x, y, dx, dy] of [[m * 0.6, m * 0.6, 1, 1], [W - m * 0.6, m * 0.6, -1, 1], [m * 0.6, H - m * 0.6, 1, -1], [W - m * 0.6, H - m * 0.6, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L); ctx.stroke(); } }
  if (bp.accents.includes('band')) { ctx.fillStyle = c.accent; ctx.fillRect(0, 0, W, Math.round(short * 0.018)); }
  if (bp.accents.includes('dots')) { ctx.fillStyle = rgba(c.accent, 0.5); for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) { ctx.beginPath(); ctx.arc(W - m - i * short * 0.028, H - m - j * short * 0.028, short * 0.005, 0, Math.PI * 2); ctx.fill(); } }
  if (bp.accents.includes('badge') && subjectImg && !full && bp.headline.position === 'bottom') { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(W - m - short * 0.06, topSafe + short * 0.06, short * 0.035, 0, Math.PI * 2); ctx.fill(); }

  // ---- the words
  if (wantText) {
    let y = textY; ctx.textBaseline = 'top';
    if (bp.accents.includes('rule')) { ctx.fillStyle = c.accent; const rw = short * 0.12; ctx.fillRect(align === 'center' ? textX - rw / 2 : align === 'right' ? textX - rw : textX, y, rw, lineW * 2); y += t.hs * 0.5; }
    ctx.fillStyle = c.text; ctx.font = `${bp.headline.weight} ${t.hs}px ${FONT_FAMILY}`;
    for (const line of t.hl) { drawLine(ctx, line, textX, y, align, t.spacing); y += t.hs * 1.08; }
    if (t.sl.length) { y += t.gap; ctx.fillStyle = c.muted === c.text ? c.text : (bp.tone === 'dark' ? mix(c.text, c.bgA, 0.18) : mix(c.text, c.bgA, 0.25)); ctx.font = `400 ${t.ss}px ${FONT_FAMILY}`; for (const line of t.sl) { drawLine(ctx, line, textX, y, align, 0); y += t.ss * 1.3; } }
    if (t.ctaH) {
      const cy = bp.cta.position === 'below_text' ? y + t.gap * 1.6 : ctaY; ctx.font = `800 ${t.cs}px ${FONT_FAMILY}`; const label = copy.cta; const tw = ctx.measureText(label).width + t.cs * 2.2; const bh = t.cs * 2.1;
      const bx = bp.cta.style === 'bar' ? 0 : align === 'center' ? textX - tw / 2 : align === 'right' ? textX - tw : textX; const bw = bp.cta.style === 'bar' ? W : tw;
      if (bp.cta.style === 'pill' || bp.cta.style === 'bar') { ctx.fillStyle = c.accent; ctx.beginPath(); ctx.roundRect(bx, bp.cta.style === 'bar' ? H - bh * 1.2 : cy, bw, bp.cta.style === 'bar' ? bh * 1.2 : bh, bp.cta.style === 'bar' ? 0 : bh / 2); ctx.fill(); ctx.fillStyle = c.onAccent; }
      else if (bp.cta.style === 'outline') { ctx.strokeStyle = c.accent; ctx.lineWidth = lineW * 1.5; ctx.beginPath(); ctx.roundRect(bx, cy, bw, bh, bh / 2); ctx.stroke(); ctx.fillStyle = c.accent; }
      else { ctx.fillStyle = c.accent; ctx.fillRect(bx + t.cs, cy + bh * 0.82, tw - t.cs * 2, lineW); }
      const ty = bp.cta.style === 'bar' ? H - bh * 1.2 + bh * 0.3 : cy + bh * 0.27; ctx.textAlign = 'center'; ctx.fillText(label, bx + bw / 2, bp.cta.style === 'text' ? cy + bh * 0.2 : ty);
    }
  }

  // ---- the business's logo (or its name)
  if (showLogo) {
    const h = logoBand * 0.8; const x = effLogo === 'top_left' ? m : W / 2; const y = effLogo === 'bottom_center' ? H - m - h : m * 0.9;
    if (logo) { const w = Math.min(short * 0.34, (logo.width / logo.height) * h); const pad = h * 0.16; const bx = effLogo === 'top_left' ? x : x - w / 2; ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.beginPath(); ctx.roundRect(bx - pad, y - pad, w + 2 * pad, h + 2 * pad, pad * 1.4); ctx.fill(); ctx.drawImage(logo as never, bx, y, w, h); }
    else { ctx.font = `800 ${Math.round(h * 0.42)}px ${FONT_FAMILY}`; ctx.fillStyle = c.text; ctx.textBaseline = 'top'; ctx.textAlign = effLogo === 'top_left' ? 'left' : 'center'; ctx.fillText(input.businessName.toUpperCase().slice(0, 28), x, y + h * 0.2); }
  }
  return canvas.toBuffer('image/jpeg', 90);
}

function drawSubject(ctx: Ctx, bp: Blueprint, c: Colours, image: { width: number; height: number }, x: number, y: number, w: number, h: number, isLogo = false, ground?: { y: number; dx: number }, grade?: { lighting?: { direction: string; shadows: string; temperature: string }; colour: string }) {
  if (grade) return drawIllustration(ctx, image, x, y, w, h, grade);
  const frame = bp.subject.frame;
  if (ground) { // a soft shadow on the floor under the subject, falling away from the light
    ctx.save(); const sy = Math.min(y + h, ground.y + (h * 0.08)); const sx = x + w / 2 + ground.dx * w * 0.08; const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.55); g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.translate(0, sy); ctx.scale(1, 0.22); ctx.translate(0, -sy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, w * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (frame === 'card') { const pad = Math.round(Math.min(w, h) * 0.04); ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16; ctx.fillStyle = bp.tone === 'dark' ? mix(c.bgA, '#FFFFFF', 0.1) : '#FFFFFF'; shapePath(ctx, bp.subject.shape === 'circle' ? 'circle' : 'rounded', x - pad, y - pad, w + 2 * pad, h + 2 * pad); ctx.fill(); ctx.restore(); }
  if (frame === 'shadow') { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20; ctx.fillStyle = c.bgA; shapePath(ctx, bp.subject.shape, x, y, w, h); ctx.fill(); ctx.restore(); }
  ctx.save(); shapePath(ctx, bp.subject.shape, x, y, w, h); ctx.clip();
  if (isLogo) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x, y, w, h); const pad = Math.min(w, h) * 0.16; const k = Math.min((w - 2 * pad) / image.width, (h - 2 * pad) / image.height); ctx.drawImage(image as never, x + (w - image.width * k) / 2, y + (h - image.height * k) / 2, image.width * k, image.height * k); }
  else cover(ctx, image, x, y, w, h);
  ctx.restore();
  if (frame === 'border') { ctx.strokeStyle = c.accent; ctx.lineWidth = Math.max(4, Math.round(Math.min(w, h) * 0.012)); shapePath(ctx, bp.subject.shape, x - 10, y - 10, w + 20, h + 20); ctx.stroke(); }
}

/** The drawn product, fitted into its place and lit like the reference: light on the side the reference's light comes from, shade on the other, a warm or cool cast. */
function drawIllustration(ctx: Ctx, image: { width: number; height: number }, x: number, y: number, w: number, h: number, grade: { lighting?: { direction: string; shadows: string; temperature: string }; colour: string }) {
  const k = Math.min(w / image.width, h / image.height) * 1.08; const iw = Math.round(image.width * k); const ih = Math.round(image.height * k); const ix = x + (w - iw) / 2; const iy = y + (h - ih) / 2;
  const layer = createLayer(iw, ih); const lc = layer.getContext('2d'); lc.drawImage(image as never, 0, 0, iw, ih);
  const dir = grade.lighting?.direction ?? 'top'; const strength = grade.lighting?.shadows === 'strong' ? 0.34 : grade.lighting?.shadows === 'light' ? 0.2 : 0.1;
  lc.globalCompositeOperation = 'source-atop';
  const g = dir === 'left' ? lc.createLinearGradient(0, 0, iw, 0) : dir === 'right' ? lc.createLinearGradient(iw, 0, 0, 0) : lc.createLinearGradient(0, 0, 0, ih);
  g.addColorStop(0, 'rgba(255,248,235,' + (strength * 0.55).toFixed(3) + ')'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,6,4,' + strength.toFixed(3) + ')'); lc.fillStyle = g; lc.fillRect(0, 0, iw, ih);
  if (grade.lighting?.temperature !== 'neutral') { lc.fillStyle = grade.lighting?.temperature === 'warm' ? 'rgba(255,170,90,0.07)' : 'rgba(90,150,255,0.07)'; lc.fillRect(0, 0, iw, ih); }
  ctx.drawImage(layer as never, ix, iy);
}
