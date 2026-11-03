import { ensureDesignFonts, hasFont, scaleFor, SIZES, type Pairing, type PostAspect, type Scale } from './tokens.js';
import { FONT_FAMILY } from '../standard-video/fonts.js';
import type { BrandKit } from '../standard-video/templates.js';
import { loadPhoto, readPhoto, type Photo, type PhotoUse } from './photo.js';
import { drawExtra } from './layouts-extra.js';
type Ctx2 = import('@napi-rs/canvas').SKRSContext2D;
import { capToPhoto, shapedPhoto } from './draw-utils.js';
import { flankedLabel, keyline, paintBackdrop, softDisc } from './finish.js';
import { alpha, arrow, contain, contrast, coverBox, feathered, fit as fitRaw, font, mix, readable, rgb, wrap, lum } from './draw-utils.js';
export { mix, contrast };

/**
 * The layout patterns of a designed post. Each is a fixed, simple arrangement on the same grid and type scale (tokens.ts): the words and the photo are the business's,
 * the arrangement is the design. Every piece of text and the photo report the box they take, so the layout can be checked (lint.ts).
 *   product_focus  one product photo, large and centred, a small label above a headline, optional ingredient/feature call-outs with hand-drawn arrows (like a menu card)
 *   announcement   a brand-coloured card: a label, a big headline, a supporting line, a button, and a photo block when there is one
 *   grid           two to four products in a tidy grid with a label under each, under one headline
 *   seasonal       a product_focus post dressed for a season: a ribbon label and a fine frame in the season's colour
 */
export type Pattern = 'product_focus' | 'announcement' | 'grid' | 'seasonal' | 'offer' | 'benefits' | 'collage' | 'quote' | 'spotlight' | 'banner' | 'overlay' | 'split' | 'poster';
/** The patterns drawn in layouts-extra.ts. */
export const EXTRA: Pattern[] = ['offer', 'benefits', 'collage', 'quote', 'spotlight', 'banner', 'overlay', 'split', 'poster'];
/** Patterns on a card of the brand's own (deepened) colour, rather than a light page. */
const CARD: Pattern[] = ['announcement', 'quote', 'banner'];
export type PostCopy = { eyebrow: string; headline: string; subline: string; cta: string; callouts: string[]; items: Array<{ label: string; photo: Buffer | null }>; season?: { label: string; colour: string };
  /** a price or offer the owner gave ("20% off", "$25", "Free quote"): never made up */ offer?: { big: string; small: string };
  /** two to four short points, from what the business says about itself */ points?: Array<{ label: string; detail: string; icon: string }>;
  /** words the owner supplied to quote, and who said them */ quote?: { text: string; by: string };
  /** what and when, from the owner's own words ("Grand opening", "Saturday 10 am") */ event?: { label: string; line: string };
  /** the picture drawn for a post with no photo: a motif about the subject (or the mood) and how it is composed */ graphic?: { motif: import('./graphics.js').Motif; composition: 'stack' | 'side' | 'center' | 'frame'; seed: number } };
export type Box = { kind: 'text' | 'photo' | 'logo' | 'button' | 'icon' | 'graphic'; id: string; /** the words of a text box (for checks on how lines break) */ str?: string; x: number; y: number; w: number; h: number; size?: number; colour?: string; on?: string; /** a cut-out product: the box is the product itself, so it is smaller than a photo box for the same visual weight */ tight?: boolean; /** a photo set edge to edge on purpose */ bleed?: boolean };
/** How the headline is set beyond its face: tracking (in em), capitals, a marker highlight or an underline on its last word, a soft shadow, a looser or tighter line height. */
export type TypeTreatment = { tracking?: number; caps?: boolean; highlight?: boolean; underline?: boolean; shadow?: boolean; lineHeight?: number };
export type PostInput = { /** the type treatment of the headline (a reference's or the owner's request) */ type?: TypeTreatment; pattern: Pattern; aspect: PostAspect; kit: BrandKit; pairing: Pairing; copy: PostCopy; hero: Buffer | null; logo: Buffer | null; businessName: string;
  /** a style learned from a reference image (structure, colours, type, photo treatment, elements): when given, the post follows it */ style?: import('./style.js').PostStyle };
export type PostResult = { /** the page margin used (a style may set it tighter or airier) */ margin?: number; bytes: Buffer; boxes: Box[]; width: number; height: number; pattern: Pattern; palette: Palette; photoUse: PhotoUse | null; fonts: { display: string; body: string }; notes: string[] };

export type Palette = { bgTop: string; bgBottom: string; text: string; muted: string; accent: string; onAccent: string; seamless: boolean };


/** The colours of a post: the page is the photo's own backdrop (a studio shot) or else the brand's colour; the words are white or near-black, whichever reads better; the brand's accent is the only other colour. */
export function paletteOf(kit: BrandKit, use: PhotoUse | null, pattern: Pattern): Palette {
  const seamless = !!use && use.mode === 'seamless' && (pattern === 'product_focus' || pattern === 'seasonal' || pattern === 'spotlight');
  const card = (() => { for (let t = 0; t <= 0.6; t += 0.04) { const c = mix(kit.primary, '#000000', t); const c2 = mix(c, '#000000', 0.18); if (Math.min(contrast('#FFFFFF', c), contrast('#FFFFFF', c2)) >= 4.8 || Math.min(contrast('#1B1B1F', c), contrast('#1B1B1F', c2)) >= 4.8) return c; } return mix(kit.primary, '#000000', 0.6); })(); // the brand colour, deepened only as far as the words need to be clearly readable on it
  const base = seamless ? { top: use!.top, bottom: use!.bottom } : CARD.includes(pattern) ? { top: card, bottom: mix(card, '#000000', 0.18) } : { top: mix(kit.primary, '#FFFFFF', 0.9), bottom: mix(kit.primary, '#FFFFFF', 0.8) };
  const mid = mix(base.top, base.bottom, 0.5); const worst = (c: string) => Math.min(contrast(c, base.top), contrast(c, base.bottom)); const text = worst('#FFFFFF') >= worst('#1B1B1F') ? '#FFFFFF' : '#1B1B1F';
  const accents = [kit.accent, kit.secondary, kit.primary]; const accent = accents.find((c) => contrast(c, mid) >= 3) ?? (lum(mid) > 0.5 ? '#1B1B1F' : '#FFFFFF');
  let muted = text; for (const t of [0.32, 0.24, 0.16, 0.08]) { const c = mix(text, mid, t); if (worst(c) >= 4.6) { muted = c; break; } }
  return { bgTop: base.top, bgBottom: base.bottom, text, muted, accent, onAccent: readable(accent), seamless };
}

/** Where the product really is inside its box: a coarse map of which cells are product and which are backdrop, so notes and arrows can be kept off the product and pointed at it. */
type Mask = { cols: number; rows: number; at: (u: number, v: number) => boolean };
async function maskOf(photo: Photo, use: PhotoUse): Promise<Mask | null> {
  if (use.mode === 'card') return null; const { createCanvas } = await import('@napi-rs/canvas'); const bb = use.bbox ?? { x: 0, y: 0, w: 1, h: 1 };
  const sw = bb.w * photo.width; const sh = bb.h * photo.height; const long = 120; const k = long / Math.max(sw, sh); const cols = Math.max(8, Math.round(sw * k)); const rows = Math.max(8, Math.round(sh * k));
  const c = createCanvas(cols, rows); const x = c.getContext('2d'); x.drawImage(photo.image as never, bb.x * photo.width, bb.y * photo.height, sw, sh, 0, 0, cols, rows); const d = x.getImageData(0, 0, cols, rows).data;
  const t = rgb(use.top); const b = rgb(use.bottom); const occ = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) for (let q = 0; q < cols; q += 1) { const i = (r * cols + q) * 4; let on: boolean;
    if (use.mode === 'cutout') on = d[i + 3] > 90; else { const f = r / rows; const bg = [0, 1, 2].map((ch) => t[ch] + (b[ch] - t[ch]) * f); on = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) > 46; }
    occ[r * cols + q] = on ? 1 : 0; }
  return { cols, rows, at: (u, v) => { const q = Math.floor(u * cols); const r = Math.floor(v * rows); return q >= 0 && r >= 0 && q < cols && r < rows && occ[r * cols + q] === 1; } };
}

export async function renderPost(input: PostInput, level = 0): Promise<PostResult> {
  // a post with a product in it must leave the product the largest thing: if it came out small, the supporting line, then the button, then the label are left out and it is drawn again
  if (level > 0) input = { ...input, copy: { ...input.copy, ...(level >= 1 ? { subline: '' } : {}), ...(level >= 2 ? { cta: '' } : {}), ...(level >= 3 ? { eyebrow: '', callouts: input.copy.callouts } : {}) } };
  await ensureDesignFonts(); const { createCanvas } = await import('@napi-rs/canvas');
  const st = input.style; const [W, H] = SIZES[input.aspect]; const S: Scale = scaleFor(W, H, st?.air ?? 1); if (st) { S.headline = Math.round(S.headline * st.headlineScale); if (st.caps) input = { ...input, copy: { ...input.copy, headline: input.copy.headline.toUpperCase(), ...(input.copy.offer ? { offer: { ...input.copy.offer, big: input.copy.offer.big.toUpperCase() } } : {}) } }; if (st.button === 'none') input = { ...input, copy: { ...input.copy, cta: '' } }; } if (!st?.caps && input.type?.caps) input = { ...input, copy: { ...input.copy, headline: input.copy.headline.toUpperCase() } }; const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d'); const boxes: Box[] = []; const notes: string[] = [];
  const display = (await hasFont(input.pairing.display)) ? input.pairing.display : FONT_FAMILY; const body = (await hasFont(input.pairing.body)) ? input.pairing.body : FONT_FAMILY; const dWeight = display === FONT_FAMILY ? 800 : input.pairing.displayWeight;
  const treat: TypeTreatment = { ...(st?.type ?? {}), ...(input.type ?? {}) }; const fit = (c: Ctx2, tx: string, fam: string, w: number, a: number, b: number, mw: number, ml: number) => fitRaw(c, tx, fam, w, a, b, mw, ml, fam === display ? treat.tracking ?? 0 : 0);
  const heroPhoto = input.hero ? await loadPhoto(input.hero) : null; let use = heroPhoto && input.hero ? await readPhoto(heroPhoto, input.hero) : null;
  let pattern: Pattern = input.pattern === 'grid' && input.copy.items.filter((i) => i.photo).length < 2 ? 'product_focus' : input.pattern; if (pattern !== input.pattern) notes.push('Fewer than two product photos, so a single-product layout is used instead of a grid.');
  if ((pattern === 'overlay' || pattern === 'split') && !heroPhoto) { pattern = 'announcement'; notes.push('This layout needs a photo and there is none, so a type-led card with the same style is used.'); }
  if (!heroPhoto && (pattern === 'product_focus' || pattern === 'seasonal' || pattern === 'spotlight')) { pattern = input.copy.graphic ? 'poster' : 'announcement'; notes.push(input.copy.graphic ? 'There is no photo, so the picture is drawn from shapes and icons (nothing is drawn to stand in for the product).' : 'There is no photo, so the words are set as a centred type-led card (nothing is drawn to stand in for the product).'); }
  // a reference's own page colour is not the photo's backdrop: a studio shot is then set as a card on that page, not blended into it
  if (st?.palette && use?.mode === 'seamless') use = { ...use, mode: 'card' };
  const pal = st?.palette ? { ...st.palette, seamless: false } : paletteOf(input.kit, use, pattern); const m = S.margin; const innerW = W - 2 * m; const logoH = Math.round(H * 0.05); const logoY = H - Math.round(m * 0.62) - logoH; const footerTop = logoY - S.group;
  // ---- the page
  const darkPage = lum(mix(pal.bgTop, pal.bgBottom, 0.5)) < 0.3;
  paintBackdrop(ctx, W, H, pal, { seamless: pal.seamless, card: CARD.includes(pattern), ...(st ? { flat: st.background === 'flat' || st.background === 'soft_shapes', grain: st.elements.includes('grain') || st.background === 'textured' ? 0.02 : 0 } : {}) });
  if (st?.shapes?.length) { // the reference's own background shapes, in its place and size, in the page's colours (pale, so the words stay clear)
    const sz = { s: 0.2, m: 0.38, l: 0.62 } as const; const colourOf = (c: string) => c === 'accent' ? pal.accent : c === 'dark' ? mix(pal.bgTop, '#000000', 0.55) : c === 'light' ? mix(pal.bgTop, '#FFFFFF', 0.7) : '#FFFFFF';
    for (const sh of st.shapes) { const r = W * sz[sh.size]; const ax = sh.anchor.includes('left') ? 0.04 : sh.anchor.includes('right') ? 0.96 : 0.5; const ay = sh.anchor.includes('top') ? 0.05 : sh.anchor.includes('bottom') ? 0.95 : 0.5; const cx = W * (sh.anchor === 'left' ? 0.0 : sh.anchor === 'right' ? 1.0 : ax); const cy = H * (sh.anchor === 'top' ? 0.0 : sh.anchor === 'bottom' ? 1.0 : ay); const col = colourOf(sh.colour); const a = sh.colour === 'accent' ? (darkPage ? 0.2 : 0.13) : 0.5;
      ctx.save(); ctx.fillStyle = alpha(col, a); ctx.strokeStyle = alpha(col, Math.min(0.6, a + 0.1));
      if (sh.kind === 'circle') { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
      else if (sh.kind === 'ring') { ctx.lineWidth = Math.max(4, W * 0.012); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      else if (sh.kind === 'rounded_rect') { ctx.beginPath(); ctx.roundRect(cx - r, cy - r * 0.7, r * 2, r * 1.4, r * 0.3); ctx.fill(); }
      else if (sh.kind === 'arch') { ctx.beginPath(); ctx.roundRect(cx - r * 0.6, cy - r, r * 1.2, r * 2, [r * 0.6, r * 0.6, 0, 0]); ctx.fill(); }
      else if (sh.kind === 'wave') { ctx.beginPath(); ctx.moveTo(0, H); for (let i = 0; i <= 40; i += 1) ctx.lineTo((i / 40) * W, H * 0.9 + Math.sin((i / 40) * Math.PI * 3) * H * 0.02 - r * 0.15); ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); }
      else if (sh.kind === 'stripes') { ctx.beginPath(); ctx.rect(cx - r, cy - r, r * 2, r * 2); ctx.clip(); ctx.lineWidth = r * 0.12; for (let i = -6; i < 8; i += 1) { ctx.beginPath(); ctx.moveTo(cx - r * 1.6 + i * r * 0.3, cy + r); ctx.lineTo(cx - r * 0.6 + i * r * 0.3, cy - r); ctx.stroke(); } }
      else if (sh.kind === 'dots') { for (let y2 = 0; y2 < 6; y2 += 1) for (let x2 = 0; x2 < 6; x2 += 1) { ctx.beginPath(); ctx.arc(cx - r + (x2 / 5) * r * 1.4, cy - r + (y2 / 5) * r * 1.4, r * 0.045, 0, Math.PI * 2); ctx.fill(); } }
      else if (sh.kind === 'burst') { ctx.beginPath(); for (let i = 0; i < 28; i += 1) { const ang = (i / 28) * Math.PI * 2; const rr = i % 2 ? r * 0.8 : r; ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr); } ctx.closePath(); ctx.fill(); }
      else { ctx.beginPath(); for (let i = 0; i <= 48; i += 1) { const ang = (i / 48) * Math.PI * 2; const rr = r * (0.82 + 0.18 * Math.sin(ang * 3 + 1) + 0.08 * Math.cos(ang * 5)); ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr); } ctx.closePath(); ctx.fill(); }
      ctx.restore(); }
  }
  if (st?.elements.includes('soft_shapes') || st?.background === 'soft_shapes') { // large pale round shapes behind the content, as the reference has
    ctx.save(); ctx.fillStyle = alpha(pal.accent, darkPage ? 0.12 : 0.07); for (const [cx, cy, r] of [[W * 0.02, H * 0.06, W * 0.34], [W * 0.98, H * 0.9, W * 0.46], [W * 0.0, H * 0.5, W * 0.2]] as const) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  if (st ? st.elements.includes('keyline_frame') : !['seasonal', 'banner', 'spotlight', 'overlay', 'split'].includes(pattern)) keyline(ctx, W, H, Math.round(m * 0.42), CARD.includes(pattern) || darkPage ? '#FFFFFF' : pal.text, CARD.includes(pattern) || darkPage ? 0.2 : 0.16); // a fine frame just inside the page edge
  ctx.textBaseline = 'top';
  const text = (id: string, str: string, x: number, y: number, size: number, weight: number, family: string, colour: string, align: 'left' | 'center' | 'right', a = 1, spacing = 0) => {
    ctx.font = font(weight, size, family); ctx.fillStyle = alpha(colour, a); ctx.textAlign = align; (ctx as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`; if (treat.shadow && id.startsWith('headline')) { ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = size * 0.09; ctx.shadowOffsetY = size * 0.04; } ctx.fillText(str, x, y); ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
    const w = ctx.measureText(str).width + spacing * str.length; boxes.push({ kind: 'text', id, str, x: align === 'center' ? x - w / 2 : align === 'right' ? x - w : x, y, w, h: size * 1.2, size, colour, on: pal.bgTop }); return w;
  };
  const block = (id: string, lines: string[], x: number, y: number, size: number, weight: number, family: string, colour: string, align: 'left' | 'center' | 'right', lh: number, emphasis?: string) => {
    const head = id === 'headline'; const trackPx = head ? (treat.tracking ?? 0) * size : 0; const lineH = head ? lh * (treat.lineHeight ?? 1) : lh; let yy = y;
    lines.forEach((l, i) => {
      const words = l.split(' ');
      if (emphasis && head && i === lines.length - 1 && words.length >= 2) { // the last word picked out: in the brand's accent, on a marker highlight, or underlined
        const lead = words.slice(0, -1).join(' '); const tail = words[words.length - 1]; ctx.font = font(weight, size, family); (ctx as unknown as { letterSpacing: string }).letterSpacing = `${trackPx}px`; const full = ctx.measureText(l).width; const leadW = ctx.measureText(`${lead} `).width; const tailW = ctx.measureText(tail).width; const x0 = align === 'center' ? x - full / 2 : align === 'right' ? x - full : x;
        ctx.textAlign = 'left'; ctx.fillStyle = colour; ctx.fillText(lead, x0, yy);
        if (treat.highlight) { ctx.fillStyle = emphasis; ctx.beginPath(); ctx.roundRect(x0 + leadW - size * 0.12, yy + size * 0.06, tailW + size * 0.24, size * 1.0, size * 0.12); ctx.fill(); ctx.fillStyle = readable(emphasis); ctx.fillText(tail, x0 + leadW, yy); }
        else { ctx.fillStyle = emphasis; ctx.fillText(tail, x0 + leadW, yy); if (treat.underline) { ctx.fillRect(x0 + leadW, yy + size * 1.02, tailW, Math.max(4, size * 0.06)); } }
        (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'; boxes.push({ kind: 'text', id: `${id}${i}`, str: l, x: x0, y: yy, w: full, h: size * Math.min(1.2, lineH), size, colour: treat.highlight ? colour : colour, on: pal.bgTop });
      } else { text(`${id}${i}`, l, x, yy, size, weight, family, colour, align, 1, trackPx); boxes[boxes.length - 1].h = size * Math.min(1.2, lineH); }
      yy += size * lineH;
    });
    return yy - y;
  };
  /** The accent for one word of a headline, only where it reads clearly on the page. */
  const emph = (): string | undefined => { if (treat.highlight || treat.underline) return pal.accent; if (st && !st.accentWord) return undefined; const mid = mix(pal.bgTop, pal.bgBottom, 0.5); return contrast(pal.accent, mid) >= 4.5 && pal.accent !== pal.text ? pal.accent : undefined; };
  /** A small label set in tracked capitals, with hairlines either side when centred: the way a printed menu sets a heading. */
  const eyebrowLine = (label: string, y: number, align: 'left' | 'center' = 'center'): number => {
    if (!label) return 0; const str = label.toUpperCase().slice(0, 34); const size = Math.round(S.eyebrow * 0.92); const sp = Math.max(2.5, size * 0.2); ctx.font = font(700, size, body);
    const w = ctx.measureText(str).width + sp * str.length; text('eyebrow', str, align === 'center' ? W / 2 + sp / 2 : m, y, size, 700, body, pal.muted, align, 1, sp); boxes[boxes.length - 1].on = pal.bgTop;
    if (align === 'center' && w < innerW * 0.62) flankedLabel(ctx, W, y, w, size, pal.text); return size * 1.2 + S.group * 0.9;
  };
  /** The one button every layout uses: a pill with even padding, the words centred in it. */
  const button = (label: string, x: number, y: number, align: 'left' | 'center', fill = pal.accent, ink = pal.onAccent, maxW?: number) => {
    if (st?.button === 'text') { // a plain text link with an arrow and an underline, as the reference sets it
      ctx.font = font(700, S.cta, body); const lab = `${label}  →`; const w = ctx.measureText(lab).width; const bx = align === 'center' ? Math.round((W - w) / 2) : x; const h = Math.round(S.cta * 1.7);
      text('cta', lab, align === 'center' ? W / 2 : bx, y, S.cta, 700, body, pal.text, align === 'center' ? 'center' : 'left', 1, 0.3); ctx.fillStyle = pal.accent; ctx.fillRect(bx, y + S.cta * 1.32, w, Math.max(4, W * 0.005)); boxes.push({ kind: 'button', id: 'button', x: bx, y, w, h }); return { w, h };
    }
    if (st?.button === 'bar') { // a full-width bar with square-ish corners
      const h = S.btnH; const bw = maxW ?? innerW; const bx0 = maxW ? x : m; ctx.save(); ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(bx0, y, bw, h, Math.round(W * 0.012)); ctx.fill(); ctx.restore();
      ctx.font = font(700, S.cta, body); const lab = label.toUpperCase(); const tracked = ctx.measureText(lab).width + 3 * lab.length; const cs = tracked > bw - S.btnPad ? Math.max(Math.round(S.cta * 0.6), Math.floor(S.cta * (bw - S.btnPad) / tracked)) : S.cta;
      text('cta', lab, bx0 + bw / 2 + 1.5, y + (h - cs * 1.2) / 2, cs, 700, body, ink, 'center', 1, 3); boxes[boxes.length - 1].on = fill; boxes.push({ kind: 'button', id: 'button', x: bx0, y, w: bw, h }); return { w: bw, h };
    }
    let cfs = S.cta; ctx.font = font(700, cfs, body); if (maxW) while (cfs > S.cta * 0.62 && ctx.measureText(label).width + S.btnPad * 2 > maxW) { cfs -= 1; ctx.font = font(700, cfs, body); } // in a narrow column the words are set smaller so the button stays inside it
    const w = Math.round(ctx.measureText(label).width + S.btnPad * 2); const h = S.btnH; const bx = align === 'center' ? Math.round((W - w) / 2) : x;
    ctx.save(); ctx.shadowColor = alpha(mix(fill, '#000000', 0.5), 0.34); ctx.shadowBlur = Math.round(W * 0.022); ctx.shadowOffsetY = Math.round(W * 0.009); const bgr = ctx.createLinearGradient(0, y, 0, y + h); bgr.addColorStop(0, mix(fill, '#FFFFFF', 0.1)); bgr.addColorStop(1, mix(fill, '#000000', 0.08)); ctx.fillStyle = bgr; ctx.beginPath(); ctx.roundRect(bx, y, w, h, h / 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = Math.max(1.5, W * 0.0016); ctx.beginPath(); ctx.roundRect(bx + 1, y + 1, w - 2, h - 2, h / 2); ctx.stroke(); ctx.restore();
    text('cta', label, bx + w / 2, y + (h - cfs * 1.2) / 2 + cfs * 0.02, cfs, 700, body, ink, 'center', 1, 0.3); boxes[boxes.length - 1].on = fill; boxes.push({ kind: 'button', id: 'button', x: bx, y, w, h }); return { w, h };
  };
  const pill = (label: string, x: number, y: number, fill: string, ink: string, align: 'left' | 'center') => {
    const t = label.toUpperCase(); ctx.font = font(700, S.eyebrow, body); const sp = Math.max(2, S.eyebrow * 0.12); const w = Math.round(ctx.measureText(t).width + sp * t.length + S.eyebrow * 2.2); const h = Math.round(S.eyebrow * 2.15); const bx = align === 'center' ? Math.round((W - w) / 2) : x;
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(bx, y, w, h, h / 2); ctx.fill(); text('eyebrow', t, bx + w / 2 + sp / 2, y + (h - S.eyebrow * 1.2) / 2, S.eyebrow, 700, body, ink, 'center', 1, sp); boxes[boxes.length - 1].on = fill; return h;
  };
  const logoBottom = async (cx = W / 2) => {
    if (topLogo) return;
    if (input.logo) { const logo = await loadPhoto(input.logo); if (logo) { const w = Math.min(W * 0.3, (logo.width / logo.height) * logoH); const x = cx - w / 2; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = logoH * 0.35; ctx.shadowOffsetY = logoH * 0.1; ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.beginPath(); ctx.roundRect(x - logoH * 0.3, logoY - logoH * 0.2, w + logoH * 0.6, logoH * 1.4, logoH * 0.34); ctx.fill(); ctx.restore(); ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x - logoH * 0.3, logoY - logoH * 0.2, w + logoH * 0.6, logoH * 1.4, logoH * 0.34); ctx.stroke(); ctx.restore(); ctx.drawImage(logo.image as never, x, logoY, w, logoH); boxes.push({ kind: 'logo', id: 'logo', x, y: logoY, w, h: logoH }); return; } }
    text('logo', input.businessName.toUpperCase().slice(0, 26), cx, logoY + logoH * 0.2, S.small, 700, body, pal.text, 'center', 0.85, 3);
  };
  /** The business's logo at the top centre, when the reference has its mark there. Returns where the content may start. */
  const logoTop = async (): Promise<number> => { const ly = Math.round(m * 0.62); const saved = { y: logoY }; void saved; if (input.logo) { const logo = await loadPhoto(input.logo); if (logo) { const w = Math.min(W * 0.3, (logo.width / logo.height) * logoH); const x = (W - w) / 2; ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = logoH * 0.35; ctx.shadowOffsetY = logoH * 0.1; ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.beginPath(); ctx.roundRect(x - logoH * 0.3, ly - logoH * 0.2, w + logoH * 0.6, logoH * 1.4, logoH * 0.34); ctx.fill(); ctx.restore(); ctx.drawImage(logo.image as never, x, ly, w, logoH); boxes.push({ kind: 'logo', id: 'logo', x, y: ly, w, h: logoH }); return ly + logoH * 1.3 + S.group; } } text('logo', input.businessName.toUpperCase().slice(0, 26), W / 2, ly, S.small, 700, body, pal.text, 'center', 0.85, 3); return ly + S.small * 1.2 + S.group; };
  const topLogo = st?.logo === 'top' && ['product_focus', 'announcement', 'seasonal'].includes(pattern); const startY = topLogo ? await logoTop() : m;
  const noteInk = pal.muted; const arrowInk = contrast(pal.accent, mix(pal.bgTop, pal.bgBottom, 0.5)) >= 3 ? pal.accent : pal.muted;

  /** Notes with arrows beside the product: each note sits in the clear space next to the product (never over it), set in readable type, with a short curved arrow that ends on the product. */
  const callouts = (hx: number, hy: number, hw: number, hh: number, mask: Mask | null) => {
    const labels = input.copy.callouts.slice(0, 4); if (!labels.length || !mask) return;
    const hand = !!st?.elements.includes('handwritten_note'); const noteFamily = hand ? 'Lobster' : body; const noteSize = hand ? Math.round(S.note * 1.4) : S.note; const handInk = contrast(pal.accent, mix(pal.bgTop, pal.bgBottom, 0.5)) >= 3 ? pal.accent : pal.text;
    const prefer: Array<{ side: 'left' | 'right'; at: number }> = [{ side: 'left', at: 0.12 }, { side: 'right', at: 0.2 }, { side: 'left', at: 0.58 }, { side: 'right', at: 0.7 }]; const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
    const clash = (r: { x: number; y: number; w: number; h: number }) => placed.some((p) => r.x < p.x + p.w + S.group && r.x + r.w > p.x - S.group && r.y < p.y + p.h + S.group * 0.8 && r.y + r.h > p.y - S.group * 0.8);
    const gapX = Math.round(W * 0.03); const stroke = Math.max(2.4, W * 0.0028);
    labels.forEach((label, i) => {
      const first = prefer[i]; let done = false;
      for (const side of [first.side, first.side === 'left' ? 'right' : 'left'] as const) {
      if (done) break; const pref = { side, at: first.at };
      for (const dv of [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.2, -0.2]) {
        if (done) break; const v0 = Math.min(0.9, Math.max(0.02, pref.at + dv)); const rowY = hy + v0 * hh;
        const edgeAt = (y0: number, y1: number) => { // how far in, from the chosen side, the product starts in this band (as a fraction of the box)
          let best: number | null = null; for (let v = (y0 - hy) / hh; v <= (y1 - hy) / hh; v += 1 / mask.rows) for (let u = 0; u <= 1; u += 1 / mask.cols) { const uu = pref.side === 'left' ? u : 1 - u; if (mask.at(uu, v)) { best = best === null ? u : Math.min(best, u); break; } } return best; };
        const sideRoom0 = pref.side === 'left' ? hx - m : W - m - (hx + hw);
        for (let width = Math.min(W * 0.26, innerW * 0.3); width >= W * 0.13; width -= W * 0.03) {
          ctx.font = font(hand ? 400 : 400, noteSize, noteFamily); const lines = wrap(ctx, label, width).slice(0, 3); const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)); const lh = lines.length * noteSize * 1.28;
          const e = edgeAt(rowY, rowY + lh + W * 0.07); if (e === null) continue; const edgeX = pref.side === 'left' ? hx + e * hw : hx + hw - e * hw;
          const outerX = pref.side === 'left' ? edgeX - gapX - lw : edgeX + gapX; const x0 = pref.side === 'left' ? outerX : outerX; if (x0 < m - 1 || x0 + lw > W - m + 1) continue; if (sideRoom0 + e * hw < lw + gapX) continue;
          const rect = { x: x0, y: rowY, w: lw, h: lh + W * 0.075 }; if (clash(rect)) continue; if (rowY + lh + W * 0.075 > footerTop - S.group) continue;
          // the arrow starts under the note, near the product, and ends on the product
          const sx = pref.side === 'left' ? x0 + lw - Math.min(lw * 0.18, W * 0.02) : x0 + Math.min(lw * 0.18, W * 0.02); const sy = rowY + lh + S.tight * 0.9;
          let tx = pref.side === 'left' ? edgeX + W * 0.05 : edgeX - W * 0.05; let ty = sy + W * 0.05; let ok = false;
          for (let k = 0; k < 8 && !ok; k += 1) { const u = (pref.side === 'left' ? tx - hx : hx + hw - tx) / hw; const v = (ty - hy) / hh; if (mask.at(pref.side === 'left' ? u : 1 - u, v)) ok = true; else { tx += pref.side === 'left' ? W * 0.015 : -W * 0.015; } }
          if (!ok) continue;
          block(`callout${i}`, lines, pref.side === 'left' ? x0 + lw : x0, rowY, noteSize, 400, noteFamily, hand ? handInk : noteInk, pref.side === 'left' ? 'right' : 'left', 1.28);
          arrow(ctx, sx, sy, tx, ty, alpha(arrowInk, 0.95), stroke, pref.side === 'left' ? W * 0.018 : -W * 0.018); placed.push(rect); done = true; break;
        }
      }
      }
      if (!done) notes.push(`The note “${label}” had no clear space beside the product, so it was left out.`);
    });
  };

  if (pattern === 'product_focus' || pattern === 'seasonal') {
    let y = startY; const ha = st?.align ?? 'center'; const hx = ha === 'left' ? m : W / 2;
    if (pattern === 'seasonal' && input.copy.season) { // a fine frame in the season's colour and a ribbon label
      const sc = input.copy.season.colour; ctx.strokeStyle = alpha(sc, 0.9); ctx.lineWidth = Math.max(3, W * 0.004); ctx.beginPath(); ctx.roundRect(m * 0.45, m * 0.45, W - m * 0.9, H - m * 0.9, W * 0.03); ctx.stroke();
      if (level < 3) y += pill(input.copy.season.label, 0, y, sc, readable(sc), 'center') + S.group;
    } else if (input.copy.eyebrow && (!st || st.eyebrow)) { if (st?.elements.includes('pill_label')) y += pill(input.copy.eyebrow, m, y, pal.accent, pal.onAccent, ha === 'left' ? 'left' : 'center') + S.group; else y += eyebrowLine(input.copy.eyebrow, y, ha); }
    const hStart = Math.round(Math.min(S.headline, W * 0.108) * (level >= 3 ? 0.8 : 1)); const wordCount = input.copy.headline.split(/\s+/).filter(Boolean).length;
    let head = fit(ctx, input.copy.headline, display, dWeight, hStart, Math.round(S.headline * 0.7), innerW, 2); if (head.lines.join(' ').split(/\s+/).filter(Boolean).length < wordCount) head = fit(ctx, input.copy.headline, display, dWeight, hStart, Math.round(S.headline * 0.55), innerW, level >= 3 ? 2 : 3); // two lines, so the photo gets the room; three only if the words need them
    y += block('headline', head.lines, hx, y, head.size, dWeight, display, pal.text, ha, display === 'Lobster' ? 1.04 : 1.06, input.copy.headline.split(' ').length >= 3 ? emph() : undefined);
    if (st?.elements.includes('rule') && level < 3) { y += S.group * 0.5; const rw = Math.round(W * 0.1); ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.roundRect(ha === 'left' ? m : (W - rw) / 2, y, rw, Math.max(5, W * 0.006), 3); ctx.fill(); y += S.group * 0.7; }
    if (input.copy.subline) { y += S.tight; ctx.font = font(400, S.sub, body); y += block('sub', wrap(ctx, input.copy.subline, innerW * 0.84).slice(0, 2), hx, y, S.sub, 400, body, pal.muted, ha, 1.32); }
    const btn = input.copy.cta ? S.btnH : 0; const bottomLimit = footerTop - (btn ? btn + S.group : 0) - S.section * 0.55; const buttonY = footerTop - btn;
    const room = { x: m, y: y + S.section, w: innerW, h: bottomLimit - (y + S.section) }; const hasNotes = input.copy.callouts.length > 0;
    if (room.h < H * 0.14 && level < 3) return renderPost(input, level + 1); // no room left for the product: leave the lesser words out and draw again
    if (heroPhoto && use) {
      const mask = await maskOf(heroPhoto, use);
      if (use.mode === 'cutout') { const bb = use.bbox ?? { x: 0, y: 0, w: 1, h: 1 }; const sw = bb.w * heroPhoto.width; const sh = bb.h * heroPhoto.height; const sz0 = contain({ w: room.w * (hasNotes ? 0.72 : 0.88), h: room.h * 0.96 }, { width: sw, height: sh } as Photo); const sz = capToPhoto(sz0, { width: sw, height: sh }, 1.3); const x = (W - sz.w) / 2; const yy = room.y + (room.h - sz.h) / 2;
        softDisc(ctx, W / 2, yy + sz.h * 0.5, Math.max(sz.w, sz.h) * 0.85, '#FFFFFF', 0.62);
        ctx.save(); const gx = W / 2; const gy = yy + sz.h * 0.96; const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, sz.w * 0.55); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.translate(0, gy); ctx.scale(1, 0.16); ctx.translate(0, -gy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, sz.w * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.drawImage(heroPhoto.image as never, bb.x * heroPhoto.width, bb.y * heroPhoto.height, sw, sh, x, yy, sz.w, sz.h); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h, tight: true }); callouts(x, yy, sz.w, sz.h, mask); }
      else if (use.mode === 'seamless') { const sz = capToPhoto(contain({ w: room.w * (hasNotes ? 0.86 : 1.04), h: room.h }, heroPhoto), heroPhoto, 1.3); const x = (W - sz.w) / 2; const yy = room.y + (room.h - sz.h) / 2; feathered(ctx, createCanvas, heroPhoto, x, yy, sz.w, sz.h, Math.min(sz.w, sz.h) * 0.07); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h }); callouts(x, yy, sz.w, sz.h, mask); }
      else if (st) { // the photo treated as the reference treats it: its shape, edge-to-edge or inset, its frame
        const sp = st.photo; const aspect = heroPhoto.width / heroPhoto.height; let w: number; let h: number; let x: number; const shape = sp.shape === 'none' || sp.shape === 'cutout' ? 'rounded' : sp.shape;
        if (sp.bleed) { w = W; h = Math.min(room.h, W * 0.95); x = 0; } else if (shape === 'circle') { const d = Math.min(room.w * 0.8, room.h * 0.94); w = d; h = d; x = (W - w) / 2; } else if (shape === 'arch') { w = Math.min(room.w * 0.72, room.h * 0.78); h = Math.min(room.h * 0.96, w * 1.3); x = (W - w) / 2; } else { const sz = contain({ w: room.w, h: room.h * 0.96 }, { width: heroPhoto.width, height: heroPhoto.height } as Photo); w = sz.w; h = sz.h; x = (W - w) / 2; } void aspect;
        if (sp.bleed && capToPhoto({ w, h }, heroPhoto).scaled) { const cz = capToPhoto({ w: Math.min(W * 0.9, room.w), h: Math.min(room.h, W * 0.95) }, heroPhoto); w = cz.w; h = cz.h; x = (W - w) / 2; notes.push('The photo is small, so it is not stretched edge to edge.'); } else if (!sp.bleed) { const cz = capToPhoto({ w, h }, heroPhoto); w = cz.w; h = cz.h; x = (W - w) / 2; }
        const yy = room.y + (room.h - h) / 2; shapedPhoto(ctx, heroPhoto, use.focus, x, yy, w, h, shape === 'circle' || shape === 'arch' ? shape : sp.bleed || sp.shape === 'rect' ? 'rect' : 'rounded', sp.frame, pal.accent, mix(pal.text, pal.bgBottom, 0.55), Math.round(W * 0.035)); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w, h, ...(sp.bleed ? { bleed: true } : {}) }); }
      else { const sz = capToPhoto(contain({ w: room.w, h: room.h }, heroPhoto), heroPhoto); const x = (W - sz.w) / 2; const yy = room.y + (room.h - sz.h) / 2; { const off = Math.round(W * 0.018); ctx.save(); ctx.strokeStyle = alpha(pal.accent, 0.55); ctx.lineWidth = Math.max(2.5, W * 0.003); ctx.beginPath(); ctx.roundRect(x + off, yy + off, sz.w, sz.h, Math.round(W * 0.035)); ctx.stroke(); ctx.restore(); } coverBox(ctx, heroPhoto, x, yy, sz.w, sz.h, use.focus, Math.round(W * 0.035), true, mix(pal.text, pal.bgBottom, 0.55), true); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h }); }
    } else notes.push('No photo: the design is carried by the type alone (nothing is drawn to stand in for the product).');
    if (btn) button(input.copy.cta, m, buttonY, ha === 'left' && st?.button !== 'bar' ? 'left' : 'center');
    await logoBottom();
  } else if (EXTRA.includes(pattern)) {
    await drawExtra(pattern, { ctx, W, H, S, m, innerW, pal, display, body, dWeight, input, heroPhoto, use, boxes, notes, footerTop, logoY, logoH, createCanvas, text, block, button, pill, logoBottom, eyebrowLine, emph, style: st, fit });
  } else if (pattern === 'announcement') {
    const hasPhoto = !!heroPhoto; const left = m; const ha = st?.align ?? 'left'; const ax = ha === 'left' ? left : W / 2;
    // measure first, so the block can be placed on purpose (centred on the card with nothing to show; at the top with a photo below)
    ctx.font = font(400, S.sub, body); let scale = hasPhoto ? 1.0 : 1.28; let hf = fit(ctx, input.copy.headline, display, dWeight, Math.round(S.headline * scale), Math.round(S.headline * 0.62), innerW * 0.94, hasPhoto ? 2 : 4); let headH = hf.lines.length * hf.size * 1.04;
    ctx.font = font(400, S.sub, body); let subLines = input.copy.subline ? wrap(ctx, input.copy.subline, innerW * 0.86).slice(0, hasPhoto ? 2 : 3) : []; let subH = subLines.length * S.sub * 1.34;
    const pillH = input.copy.eyebrow && (!st || st.eyebrow) ? Math.round(S.eyebrow * 2.15) : 0; const ruleH = Math.max(5, Math.round(W * 0.006)); const btn = input.copy.cta ? S.btnH : 0;
    const need = (sub: number) => (pillH ? pillH + S.section : 0) + headH + S.group * 1.15 + ruleH + S.group * 0.8 + (sub ? sub + S.section * 0.9 : 0) + btn;
    if (hasPhoto && m + need(subH) + S.section + H * 0.27 > footerTop) { subLines = []; subH = 0; notes.push('The supporting line was left out so the photo keeps its room.'); }
    // everything must fit between the top margin and the footer with air to spare: if it does not, the headline is set smaller, then the supporting line is shortened, then left out
    for (let guard = 0; guard < 8 && !hasPhoto && m + need(subH) > footerTop - m * 0.7; guard += 1) { if (scale > 0.8) { scale -= 0.12; ctx.font = font(400, S.sub, body); hf = fit(ctx, input.copy.headline, display, dWeight, Math.round(S.headline * scale), Math.round(S.headline * 0.6), innerW * 0.94, 4); headH = hf.lines.length * hf.size * 1.04; } else if (subLines.length > 1) { subLines = subLines.slice(0, subLines.length - 1); subH = subLines.length * S.sub * 1.34; } else if (subLines.length) { subLines = []; subH = 0; notes.push('The supporting line was left out so everything fits with room to breathe.'); } else break; }
    const total = need(subH);
    let y: number;
    if (!hasPhoto) { // a large quiet shape in the brand's accent anchors the lower right
      boxes.push({ kind: 'graphic', id: 'decor', x: W * 0.3, y: H * 0.58, w: W * 0.7, h: H * 0.42, bleed: true }); softDisc(ctx, W * 0.9, H * 0.9, W * 0.62, pal.accent, 0.3); softDisc(ctx, W * 0.04, H * 1.02, W * 0.34, pal.accent, 0.2); softDisc(ctx, W * 0.95, H * 0.08, W * 0.3, '#FFFFFF', 0.1);
      y = Math.max(startY, Math.round((footerTop - total) / 2.05)); } else y = startY;
    if (pillH) y += pill(input.copy.eyebrow, left, y, pal.accent, pal.onAccent, ha === 'left' ? 'left' : 'center') + S.section;
    y += block('headline', hf.lines, ax, y, hf.size, dWeight, display, pal.text, ha, 1.04, input.copy.headline.split(' ').length >= 3 ? emph() : undefined) + S.group * 1.15;
    { const rw = Math.round(W * 0.13); ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.roundRect(ha === 'left' ? left : (W - rw) / 2, y, rw, ruleH, ruleH / 2); ctx.fill(); y += ruleH + S.group * 0.8; }
    if (subH) y += block('sub', subLines, ax, y, S.sub, 400, body, pal.muted, ha, 1.34) + S.section * 0.9;
    if (btn) { button(input.copy.cta, left, y, ha === 'left' ? 'left' : 'center'); y += btn; }
    if (heroPhoto && use) { const top = Math.round(y + S.section); const h = footerTop - S.group * 0.6 - top; if (h >= H * 0.22) { const cz = capToPhoto({ w: innerW, h }, heroPhoto); const px = Math.round((W - cz.w) / 2); const ty = top + Math.round((h - cz.h) / 2); coverBox(ctx, heroPhoto, px, ty, cz.w, cz.h, use.focus, Math.round(W * 0.035), true, '#000000', true); boxes.push({ kind: 'photo', id: 'hero', x: px, y: ty, w: cz.w, h: cz.h }); } else if (input.aspect === '1:1') return renderPost({ ...input, pattern: 'split' }, 0); else notes.push('There was not enough room for the photo under the words, so it was left out.'); }
    await logoBottom();
  } else { // grid
    let y = m; if (input.copy.eyebrow) y += eyebrowLine(input.copy.eyebrow, y);
    const head = fit(ctx, input.copy.headline, display, dWeight, Math.round(S.headline * 0.9), Math.round(S.headline * 0.55), innerW, 2); y += block('headline', head.lines, W / 2, y, head.size, dWeight, display, pal.text, 'center', 1.06) + S.section;
    const items = input.copy.items.filter((i) => i.photo).slice(0, 4); const cols = items.length === 3 ? 3 : 2; const rows = Math.ceil(items.length / cols); const gap = S.group; const gridH = footerTop - S.group - y; const labelH = S.note * 1.2 + S.group * 0.9;
    const cellW = (innerW - gap * (cols - 1)) / cols; const cellH = Math.min(cellW * 1.15, (gridH - gap * (rows - 1)) / rows - labelH); const total = rows * (cellH + labelH) + (rows - 1) * gap; const gy = y + Math.max(0, (gridH - total) / 2);
    for (let i = 0; i < items.length; i += 1) { const r = Math.floor(i / cols); const c = i % cols; const n = r === rows - 1 ? items.length - r * cols : cols; const x0 = m + (cols - n) * (cellW + gap) / 2 + c * (cellW + gap); const cy = gy + r * (cellH + labelH + gap);
      const photo = await loadPhoto(items[i].photo!); if (photo) { const u = await readPhoto(photo, items[i].photo!); coverBox(ctx, photo, x0, cy, cellW, cellH, u.focus, Math.round(W * 0.03), true, mix(pal.text, pal.bgBottom, 0.55), true); boxes.push({ kind: 'photo', id: `cell${i}`, x: x0, y: cy, w: cellW, h: cellH }); }
      ctx.font = font(700, S.note, body); const label = wrap(ctx, items[i].label, cellW)[0] ?? ''; text(`label${i}`, label, x0 + cellW / 2, cy + cellH + S.group * 0.55, S.note, 700, body, pal.text, 'center'); }
    await logoBottom();
  }
  // a badge as the reference has one: a round or starburst label with the offer in it (only ever an offer the owner gave)
  if (st?.badge && input.copy.offer && !['offer'].includes(pattern)) { const bd = Math.round(W * 0.21); const bx = st.badge.anchor.includes('left') ? m + bd * 0.55 : W - m - bd * 0.55; const by = st.badge.anchor.includes('top') ? m + bd * 0.62 : footerTop - bd * 0.6; ctx.save(); ctx.translate(bx, by); ctx.rotate(-0.12); ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = bd * 0.12; ctx.shadowOffsetY = bd * 0.04; ctx.fillStyle = pal.accent; ctx.beginPath();
    if (st.badge.shape === 'burst') for (let i = 0; i < 24; i += 1) { const ang = (i / 24) * Math.PI * 2; const rr = i % 2 ? bd * 0.43 : bd * 0.5; ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); } else ctx.arc(0, 0, bd / 2, 0, Math.PI * 2); ctx.closePath(); ctx.fill(); ctx.restore();
    const lab = fitRaw(ctx, input.copy.offer.big, display, dWeight, Math.round(bd * 0.3), Math.round(bd * 0.14), bd * 0.74, 2); const lh = lab.size * 1.02; const ty = by - (lab.lines.length * lh) / 2; lab.lines.forEach((ln, i) => { text(`badge${i}`, ln, bx, ty + i * lh, lab.size, dWeight, display, pal.onAccent, 'center'); boxes[boxes.length - 1].on = pal.accent; boxes[boxes.length - 1].h = lab.size * 0.95; }); }
  const heroBox = boxes.find((b) => b.id === 'hero'); if (heroBox && pattern === 'product_focus' && input.aspect === '1:1' && heroBox.w * heroBox.h < W * H * (heroBox.tight ? 0.13 : 0.24) && level >= 1) return renderPost({ ...input, pattern: 'split' }, 0); // a square has no room for a stack: the photo goes beside the words
  if (heroBox && (pattern === 'product_focus' || pattern === 'seasonal') && heroBox.w * heroBox.h < W * H * (heroBox.tight ? 0.13 : 0.24) && level < 3) { const lean = await renderPost(input, level + 1); lean.notes.unshift(`The product came out small with all the words, so ${['the supporting line', 'the supporting line and button', 'the supporting line, button and label'][level]} ${level === 0 ? 'was' : 'were'} left out.`); return lean; }
  return { margin: m, bytes: canvas.toBuffer('image/jpeg', 92), boxes, width: W, height: H, pattern, palette: pal, photoUse: use, fonts: { display, body }, notes };
}
