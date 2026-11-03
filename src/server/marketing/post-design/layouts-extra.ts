import type { Palette, Pattern, PostInput, Box } from './layouts.js';
import type { Scale } from './tokens.js';
import type { Photo, PhotoUse } from './photo.js';
import { loadPhoto, readPhoto } from './photo.js';
import { alpha, contain, contrast, coverBox, feathered, font, lum, mix, readable, wrap, type Ctx } from './draw-utils.js';
import { flankedLabel, keyline, softDisc } from './finish.js';
import { drawMotif, type Motif } from './graphics.js';

/**
 * The six extra layout patterns, on the same grid, type scale, spacing rhythm and design rules as the first four (see tokens.ts):
 *   offer       a price or offer the owner gave, big, in a panel of the brand colour; a short line, a button, and a photo band when there is one
 *   benefits    two to four short points, each with a simple icon in a disc, on a calm list; a round photo beside the headline when there is one
 *   collage     two or three of the owner's own photos set in an even grid under one headline
 *   quote       words the owner supplied, large, on a card of the brand colour, with a quiet attribution
 *   spotlight   one thing: a very large headline, one line, and the product photo as big as the post allows
 *   banner      an event or seasonal banner: a bold band, a large headline, the photo in an arch with a ring, and the details in plain words
 * Nothing here is invented: the offer, the quote and the event details are only ever the owner's own words.
 */
export type Toolkit = {
  ctx: Ctx; W: number; H: number; S: Scale; m: number; innerW: number; pal: Palette; display: string; body: string; dWeight: number; input: PostInput; heroPhoto: Photo | null; use: PhotoUse | null; boxes: Box[]; notes: string[]; footerTop: number; logoY: number; logoH: number;
  createCanvas: (w: number, h: number) => import('@napi-rs/canvas').Canvas;
  text: (id: string, str: string, x: number, y: number, size: number, weight: number, family: string, colour: string, align: 'left' | 'center' | 'right', a?: number, spacing?: number) => number;
  block: (id: string, lines: string[], x: number, y: number, size: number, weight: number, family: string, colour: string, align: 'left' | 'center' | 'right', lh: number, emphasis?: string) => number;
  eyebrowLine: (label: string, y: number, align?: 'left' | 'center') => number;
  emph: () => string | undefined;
  button: (label: string, x: number, y: number, align: 'left' | 'center', fill?: string, ink?: string, maxW?: number) => { w: number; h: number };
  pill: (label: string, x: number, y: number, fill: string, ink: string, align: 'left' | 'center') => number;
  logoBottom: (cx?: number) => Promise<void>;
  /** the style learned from a reference image, when there is one */ style?: import('./style.js').PostStyle;
  /** fitting text to a width, with the headline's tracking */ fit: (ctx: Ctx, text: string, family: string, weight: number, start: number, min: number, maxWidth: number, maxLines: number) => { size: number; lines: string[] };
};

/** A simple icon in a disc: drawn from a few lines and curves, in the brand's accent. */
export function iconFor(text: string): string {
  const t = text.toLowerCase();
  if (/\b(?:fast|quick|same[- ]day|on time|prompt|hours?|schedul\w*|flexible|24\/7|time)\b/.test(t)) return 'clock'; if (/\b(?:water|pool|clean\w*|wash\w*|spotless|fresh)\b/.test(t)) return 'drop';
  if (/\b(?:guarantee\w*|insured|licen[cs]ed|safe\w*|trust\w*|reliable|certified|protect\w*|warranty)\b/.test(t)) return 'shield'; if (/\b(?:love|care|family|friendly|handmade|homemade|personal)\b/.test(t)) return 'heart';
  if (/\b(?:best|top|premium|quality|expert|award\w*|rated|favou?rite)\b/.test(t)) return 'star'; if (/\b(?:power|energy|rapid|instant|electric)\b/.test(t)) return 'bolt'; return 'check';
}
function drawIcon(t: Toolkit, kind: string, cx: number, cy: number, r: number, fill: string, ink: string) {
  const { ctx } = t; ctx.save(); ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = r * 0.17; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; const u = r * 0.5;
  ctx.beginPath();
  if (kind === 'check') { ctx.moveTo(cx - u * 0.75, cy + u * 0.02); ctx.lineTo(cx - u * 0.2, cy + u * 0.58); ctx.lineTo(cx + u * 0.85, cy - u * 0.6); ctx.stroke(); }
  else if (kind === 'clock') { ctx.arc(cx, cy, u * 1.05, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy - u * 0.62); ctx.lineTo(cx, cy); ctx.lineTo(cx + u * 0.5, cy + u * 0.3); ctx.stroke(); }
  else if (kind === 'drop') { ctx.moveTo(cx, cy - u * 1.05); ctx.bezierCurveTo(cx + u * 0.95, cy + u * 0.1, cx + u * 0.72, cy + u * 1.0, cx, cy + u * 1.0); ctx.bezierCurveTo(cx - u * 0.72, cy + u * 1.0, cx - u * 0.95, cy + u * 0.1, cx, cy - u * 1.05); ctx.fill(); }
  else if (kind === 'shield') { ctx.moveTo(cx, cy - u * 1.05); ctx.lineTo(cx + u * 0.9, cy - u * 0.6); ctx.lineTo(cx + u * 0.8, cy + u * 0.25); ctx.quadraticCurveTo(cx + u * 0.5, cy + u * 0.85, cx, cy + u * 1.1); ctx.quadraticCurveTo(cx - u * 0.5, cy + u * 0.85, cx - u * 0.8, cy + u * 0.25); ctx.lineTo(cx - u * 0.9, cy - u * 0.6); ctx.closePath(); ctx.fill(); }
  else if (kind === 'heart') { ctx.moveTo(cx, cy + u * 0.95); ctx.bezierCurveTo(cx - u * 1.5, cy - u * 0.1, cx - u * 0.7, cy - u * 1.15, cx, cy - u * 0.35); ctx.bezierCurveTo(cx + u * 0.7, cy - u * 1.15, cx + u * 1.5, cy - u * 0.1, cx, cy + u * 0.95); ctx.fill(); }
  else if (kind === 'star') { for (let i = 0; i < 10; i += 1) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 === 0 ? u * 1.15 : u * 0.48; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
  else { ctx.moveTo(cx + u * 0.2, cy - u * 1.1); ctx.lineTo(cx - u * 0.7, cy + u * 0.15); ctx.lineTo(cx - u * 0.05, cy + u * 0.15); ctx.lineTo(cx - u * 0.25, cy + u * 1.1); ctx.lineTo(cx + u * 0.7, cy - u * 0.2); ctx.lineTo(cx + u * 0.05, cy - u * 0.2); ctx.closePath(); ctx.fill(); }
  ctx.restore(); t.boxes.push({ kind: 'icon', id: `icon${t.boxes.length}`, x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
}
async function cell(t: Toolkit, bytes: Buffer, x: number, y: number, w: number, h: number, id: string, radius: number, shadow = false) {
  const photo = await loadPhoto(bytes); if (!photo) return false; const use = await readPhoto(photo, bytes); coverBox(t.ctx, photo, x, y, w, h, use.focus, radius, shadow, mix(t.pal.text, t.pal.bgBottom, 0.55), true); t.boxes.push({ kind: 'photo', id, x, y, w, h }); return true;
}
function circlePhoto(t: Toolkit, photo: Photo, focus: { x: number; y: number }, cx: number, cy: number, d: number, ring: string | null, id: string) {
  const { ctx } = t; const scale = Math.max(d / photo.width, d / photo.height); const sw = d / scale; const sh = d / scale; const sx = Math.max(0, Math.min(photo.width - sw, focus.x * photo.width - sw / 2)); const sy = Math.max(0, Math.min(photo.height - sh, focus.y * photo.height - sh / 2));
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = d * 0.08; ctx.shadowOffsetY = d * 0.03; ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(photo.image as never, sx, sy, sw, sh, cx - d / 2, cy - d / 2, d, d); ctx.restore();
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = Math.max(3, d * 0.022); ctx.beginPath(); ctx.arc(cx, cy, d / 2 + ctx.lineWidth * 2.2, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = alpha(ring, 0.35); ctx.lineWidth = Math.max(1.5, d * 0.008); ctx.beginPath(); ctx.arc(cx, cy, d / 2 + ctx.lineWidth * 11, 0, Math.PI * 2); ctx.stroke(); }
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(2, d * 0.014); ctx.beginPath(); ctx.arc(cx, cy, d / 2 - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  t.boxes.push({ kind: 'photo', id, x: cx - d / 2, y: cy - d / 2, w: d, h: d });
}

export async function drawExtra(pattern: Pattern, t: Toolkit): Promise<void> {
  const { ctx, W, H, S, m, innerW, pal, display, body, dWeight, input, heroPhoto, use, boxes, notes, footerTop } = t; const c = input.copy; const st = t.style; const darkPage = (p: { bgTop: string; bgBottom: string }) => lum(mix(p.bgTop, p.bgBottom, 0.5)) < 0.3;
  const head = (size: number, min: number, width: number, lines: number) => t.fit(ctx, c.headline, display, dWeight, size, min, width, lines);
  const eyebrow = (y: number, align: 'left' | 'center' = 'center') => t.eyebrowLine(c.eyebrow, y, align);

  if (pattern === 'poster') {
    // a graphic post: no photo needed. The picture is drawn here, from shapes, gradients and icons in the brand's colours; words are set around it.
    const g = c.graphic ?? { motif: 'blobs' as Motif, composition: 'stack' as const, seed: 1 }; const brand = [input.kit.primary, input.kit.accent, input.kit.secondary].map((col) => ({ col, sat: (() => { const n = parseInt(col.slice(1), 16); const r = (n >> 16) & 255; const gg = (n >> 8) & 255; const bb = n & 255; const mx = Math.max(r, gg, bb); return mx ? (mx - Math.min(r, gg, bb)) / mx : 0; })() })).sort((x, y) => y.sat - x.sat);
    const hueOf = (col: string) => { const n = parseInt(col.slice(1), 16); const r = ((n >> 16) & 255) / 255; const gg = ((n >> 8) & 255) / 255; const bb = (n & 255) / 255; const mx = Math.max(r, gg, bb); const d = mx - Math.min(r, gg, bb); if (!d) return 0; const h = mx === r ? ((gg - bb) / d + 6) % 6 : mx === gg ? (bb - r) / d + 2 : (r - gg) / d + 4; return h * 60; }; const watery = ['waves', 'drops', 'snow'].includes(g.motif); const blue = brand.find((b) => b.sat > 0.35 && hueOf(b.col) >= 170 && hueOf(b.col) <= 260);
    const lead = st?.palette ? pal.accent : watery && blue ? blue.col : input.kit.primary; const ink = { a: lead, b: mix(lead, st?.palette ? pal.text : input.kit.secondary, 0.5), c: mix(mix(pal.bgTop, pal.bgBottom, 0.5), lead, 0.28), light: mix(pal.bgTop, '#FFFFFF', 0.6), dark: mix(lead, '#000000', 0.4) };
    const ha = st?.align ?? 'center'; const hx = ha === 'left' ? m : W / 2; const tall = H / W > 1.5; const comp = (tall || H / W > 1.2) && (g.composition === 'side' || g.composition === 'frame') ? 'stack' : g.composition; if (comp !== g.composition) notes.push('A tall post stacks the picture above the words.'); const side = comp === 'side'; const lhD = ['Pacifico', 'Lobster', 'Dancing Script', 'Caveat', 'Permanent Marker'].includes(display) ? 1.2 : 1.06;
    const faceBoost = Math.min(1.6, Math.max(1, 0.55 / (input.pairing.width || 0.55))); let hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * (side ? 0.9 : 1.1) * faceBoost), Math.round(S.headline * 0.58), side ? innerW * 0.52 : innerW, side ? 4 : 3); let hs = side ? 0.9 : 1.1; let showEyebrow = !!c.eyebrow;
    ctx.font = font(400, S.sub, body); let subLines = c.subline ? wrap(ctx, c.subline, side ? innerW * 0.5 : innerW * 0.84).slice(0, 2) : []; const btn = c.cta ? S.btnH : 0;
    const textH = () => (showEyebrow ? S.eyebrow * 1.2 + S.group * 0.9 : 0) + hd.lines.length * hd.size * lhD + (subLines.length ? S.group * 0.45 + subLines.length * S.sub * 1.32 : 0) + (btn ? S.section * 0.8 + btn : 0);
    const reg = (x: number, y: number, w: number, h: number) => boxes.push({ kind: 'graphic', id: 'motif', x, y, w, h, bleed: true });
    const writeText = (y: number, align: 'left' | 'center', cx: number) => { let yy = y; if (showEyebrow) yy += t.eyebrowLine(c.eyebrow, yy, align); yy += t.block('headline', hd.lines, cx, yy, hd.size, dWeight, display, pal.text, align, lhD, hd.lines.join(' ').split(' ').length >= 3 ? t.emph() : undefined); if (subLines.length) { yy += S.group * 0.45; yy += t.block('sub', subLines, cx, yy, S.sub, 400, body, pal.muted, align, 1.32); } if (btn) t.button(c.cta, cx, yy + S.section * 0.8, align === 'left' ? 'left' : 'center'); };
    const room = footerTop - m; let ms = side ? W * 0.42 : comp === 'center' ? W * 0.95 : Math.min(W * 0.62, H * (tall ? 0.3 : 0.4));
    if (!side && comp !== 'center') { // everything must fit above the logo: the supporting line goes first, then the headline is set smaller, then the label, and the picture gives way last
      const over = () => ms + S.section + textH() > room - (comp === 'frame' ? 0 : 0); if (over() && subLines.length) subLines = [];
      for (let g2 = 0; g2 < 6 && over() && hs > 0.62; g2 += 1) { hs -= 0.12; hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * hs), Math.round(S.headline * 0.58), innerW, 3); }
      if (over() && showEyebrow) showEyebrow = false; if (over()) ms = Math.max(W * 0.24, room - S.section - textH()); }
    if (comp === 'side') {
      const cy = H * 0.45; softDisc(ctx, W * 0.84, cy, W * 0.5, ink.a, 0.22); drawMotif(ctx, g.motif, W * 0.85, cy, ms, ink, g.seed); reg(W * 0.64, cy - ms / 2, W * 0.36, ms);
      writeText(Math.max(m, Math.round((footerTop - textH()) / 2.3)), 'left', m);
    } else if (comp === 'center') {
      const cy = H * 0.44; ctx.save(); ctx.globalAlpha = 0.1; drawMotif(ctx, g.motif, W / 2, cy, ms, ink, g.seed); ctx.restore(); reg(W * 0.025, cy - ms / 2, W * 0.95, ms);
      let is = W * 0.22; if (is + S.group + textH() > room) { subLines = []; } const y0 = Math.max(m, Math.round((footerTop - (textH() + is + S.group)) / 2.1)); softDisc(ctx, W / 2, y0 + is / 2, is * 1.1, ink.a, 0.22); drawMotif(ctx, g.motif, W / 2, y0 + is / 2, is, ink, g.seed); writeText(y0 + is + S.group, 'center', W / 2);
    } else if (comp === 'frame') {
      ms = Math.min(ms, W * 0.46); while (ms * 1.0 + S.group + textH() > room - m * 0.4 && ms > W * 0.24) ms -= 10; if (ms * 1.0 + S.group + textH() > room - m * 0.4) subLines = [];
      const fy = m * 0.9 + ms * 0.5; const fx = m * 0.9; const fw = W - fx * 2; const fh = footerTop - fy - S.group * 0.3; ctx.save(); ctx.fillStyle = alpha('#FFFFFF', darkPage(pal) ? 0.07 : 0.55); ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, W * 0.05); ctx.fill(); ctx.strokeStyle = alpha(ink.a, 0.55); ctx.lineWidth = Math.max(2.5, W * 0.003); ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, W * 0.05); ctx.stroke(); ctx.restore();
      drawMotif(ctx, g.motif, W / 2, fy, ms, ink, g.seed); reg(W / 2 - ms / 2, fy - ms / 2, ms, ms); writeText(fy + ms * 0.5 + S.group * 0.8, 'center', W / 2);
    } else { // stack: the picture above, the words below
      const top = Math.max(m, Math.round((footerTop - (ms + S.section + textH())) / 2.2)); const cy = top + ms / 2; softDisc(ctx, W / 2, cy, ms * 0.95, ink.a, 0.22); drawMotif(ctx, g.motif, W / 2, cy, ms, ink, g.seed); reg(W / 2 - ms / 2, top, ms, ms);
      writeText(top + ms + S.section, ha === 'left' ? 'left' : 'center', hx);
    }
    await t.logoBottom(); return;
  }

  if (pattern === 'overlay' && heroPhoto && use) {
    // the photo fills the frame; a shade (in the reference's direction) under the words keeps them clear
    boxes.push({ kind: 'photo', id: 'hero', x: 0, y: 0, w: W, h: H, bleed: true });
    const dark = st ? st.tone === 'dark' || !st.palette || lum(mix(pal.bgTop, pal.bgBottom, 0.5)) < 0.5 : true; const shade = dark ? '#000000' : '#FFFFFF'; const ink = dark ? '#FFFFFF' : '#1B1B1F'; const soft = mix(ink, shade, 0.14); const dir = st && st.scrim !== 'none' ? st.scrim : 'bottom';
    // the shade is made as strong as the picture needs: the actual pixels under the words are measured, and the shade deepened until the words read clearly (contrast of at least 5 to 1)
    const zone = (st?.textPosition ?? 'bottom') === 'top' ? { y0: 0, y1: H * 0.5 } : (st?.textPosition ?? 'bottom') === 'center' ? { y0: H * 0.25, y1: H * 0.75 } : { y0: H * 0.45, y1: H }; let boost = 0;
    for (let pass = 0; pass < 5; pass += 1) {
      coverBox(ctx, heroPhoto, 0, 0, W, H, use.focus, 0, false);
      const g0 = dir === 'top' ? ctx.createLinearGradient(0, H * 0.7, 0, 0) : dir === 'left' ? ctx.createLinearGradient(W * 0.8, 0, 0, 0) : ctx.createLinearGradient(0, H * 0.3, 0, H); g0.addColorStop(0, alpha(shade, 0)); g0.addColorStop(0.55, alpha(shade, Math.min(0.9, (dark ? 0.5 : 0.55) + boost))); g0.addColorStop(1, alpha(shade, Math.min(0.96, (dark ? 0.86 : 0.88) + boost))); ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H);
      if (dir === 'all') { ctx.fillStyle = alpha(shade, Math.min(0.7, 0.35 + boost)); ctx.fillRect(0, 0, W, H); }
      const sample = ctx.getImageData(Math.round(m), Math.round(zone.y0), Math.round(innerW), Math.max(8, Math.round(zone.y1 - zone.y0))).data; const lums: number[] = []; const step = 48; for (let i = 0; i < sample.length; i += 4 * step) lums.push(lum(`#${[sample[i], sample[i + 1], sample[i + 2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`)); lums.sort((a, b) => a - b); const n = lums.length; const hi = n ? lums[Math.min(n - 1, Math.floor(n * 0.92))] : 0;
      const brightest = `#${[0, 1, 2].map(() => Math.round(Math.min(255, 255 * Math.pow(hi, 1 / 2.2))).toString(16).padStart(2, '0')).join('')}`; if (contrast(ink, brightest) >= 5 || n === 0) break; boost += 0.08;
    }
    if (dir === 'all') { ctx.fillStyle = alpha(shade, 0.35); ctx.fillRect(0, 0, W, H); }
    if (st?.elements.includes('keyline_frame')) keyline(ctx, W, H, Math.round(m * 0.42), ink, 0.5);
    const ha = st?.align ?? 'left'; const x = ha === 'left' ? m : W / 2; const pos = st?.textPosition ?? 'bottom'; const first = boxes.length;
    const hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * 1.12), Math.round(S.headline * 0.6), innerW * 0.92, 3); ctx.font = font(400, S.sub, body); const subLines = c.subline ? wrap(ctx, c.subline, innerW * 0.8).slice(0, 2) : [];
    const pillH = c.eyebrow && (!st || st.eyebrow) ? Math.round(S.eyebrow * 2.15) : 0; const btn = c.cta ? S.btnH : 0;
    const total = (pillH ? pillH + S.group : 0) + hd.lines.length * hd.size * 1.06 + (subLines.length ? S.tight + subLines.length * S.sub * 1.32 : 0) + (btn ? S.section * 0.8 + btn : 0);
    let y = pos === 'top' ? m * 1.3 : pos === 'center' ? Math.max(m, (H - total) / 2) : footerTop - total - S.group * 0.4;
    if (pillH) y += t.pill(c.eyebrow, x, y, st && st.palette ? pal.accent : ink, st && st.palette ? pal.onAccent : readable(ink), ha === 'left' ? 'left' : 'center') + S.group;
    const emphO = st?.accentWord && contrast(pal.accent, mix(shade, '#808080', 0.2)) >= 4.5 ? pal.accent : undefined; y += t.block('headline', hd.lines, x, y, hd.size, dWeight, display, ink, ha, 1.06, hd.lines.join(' ').split(' ').length >= 3 ? emphO : undefined);
    if (subLines.length) { y += S.tight; y += t.block('sub', subLines, x, y, S.sub, 400, body, soft, ha, 1.32); }
    if (btn) t.button(c.cta, x, y + S.section * 0.8, ha === 'left' ? 'left' : 'center', st && st.palette ? pal.accent : ink, st && st.palette ? pal.onAccent : readable(ink));
    const on = mix(shade, '#808080', 0.2); for (let i = first; i < boxes.length; i += 1) if (boxes[i].kind === 'text' && !['cta', 'eyebrow'].includes(boxes[i].id)) boxes[i].on = on;
    await t.logoBottom(); return;
  }

  if (pattern === 'split' && heroPhoto && use) {
    const side = st?.photo.position === 'left' || st?.photo.position === 'right' ? st.photo.position : st?.photo.position === 'top' || st?.photo.position === 'bottom' ? 'top' : 'right';
    if (side === 'top') {
      const ph = Math.round(H * 0.5); coverBox(ctx, heroPhoto, 0, 0, W, ph, use.focus, 0, false); boxes.push({ kind: 'photo', id: 'hero', x: 0, y: 0, w: W, h: ph, bleed: true });
      const ha = st?.align ?? 'left'; const x = ha === 'left' ? m : W / 2; let y = ph + S.section; if (c.eyebrow && (!st || st.eyebrow)) y += t.eyebrowLine(c.eyebrow, y, ha);
      const hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * 0.95), Math.round(S.headline * 0.55), innerW, 2); y += t.block('headline', hd.lines, x, y, hd.size, dWeight, display, pal.text, ha, 1.05, hd.lines.join(' ').split(' ').length >= 3 ? t.emph() : undefined) + S.group * 0.6;
      ctx.font = font(400, S.sub, body); if (c.subline && y + S.sub * 2.7 < footerTop - (c.cta ? S.btnH + S.group : 0)) y += t.block('sub', wrap(ctx, c.subline, innerW * 0.86).slice(0, 2), x, y, S.sub, 400, body, pal.muted, ha, 1.32) + S.group;
      if (c.cta && y + S.btnH <= footerTop) t.button(c.cta, x, Math.min(y, footerTop - S.btnH), ha === 'left' ? 'left' : 'center'); await t.logoBottom(); return;
    }
    const pw = Math.round(W * 0.5); const px = side === 'left' ? 0 : W - pw; coverBox(ctx, heroPhoto, px, 0, pw, H, use.focus, 0, false); boxes.push({ kind: 'photo', id: 'hero', x: px, y: 0, w: pw, h: H, bleed: true });
    const x0 = side === 'left' ? pw + Math.round(m * 0.75) : m; const colW = W - pw - Math.round(m * 1.75); const cx = x0 + colW / 2;
    const hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * 0.9), Math.round(S.headline * 0.56), colW, 6); ctx.font = font(400, S.sub, body); const subLines = c.subline ? wrap(ctx, c.subline, colW).slice(0, 3) : []; const pillH = c.eyebrow && (!st || st.eyebrow) ? S.eyebrow * 1.2 + S.group : 0; const btnH = c.cta ? S.btnH : 0;
    let hdr = hd; let subs = subLines; const totalOf = () => pillH + hdr.lines.length * hdr.size * 1.06 + S.group * 1.4 + (subs.length ? subs.length * S.sub * 1.32 + S.group : 0) + (btnH ? S.group * 0.8 + btnH : 0);
    for (let guard = 0; guard < 8 && m + totalOf() > footerTop - m * 0.5; guard += 1) { if (hdr.size > S.headline * 0.55) hdr = t.fit(ctx, c.headline, display, dWeight, Math.round(hdr.size * 0.9), Math.round(S.headline * 0.45), colW, 6); else if (subs.length) { subs = []; notes.push('The supporting line was left out so everything fits the column.'); } else break; }
    const total = totalOf(); let y = Math.max(m, Math.round((footerTop - total) / 2.1));
    if (pillH) { const lab = c.eyebrow.toUpperCase(); let es = Math.round(S.eyebrow * 0.9); ctx.font = font(700, es, body); while (es > S.small * 0.7 && ctx.measureText(lab).width + 3 * lab.length > colW) { es -= 1; ctx.font = font(700, es, body); } t.text('eyebrow', lab, x0, y, es, 700, body, pal.muted, 'left', 1, 3); y += pillH; }
    y += t.block('headline', hdr.lines, x0, y, hdr.size, dWeight, display, pal.text, 'left', 1.06, hdr.lines.join(' ').split(' ').length >= 3 ? t.emph() : undefined) + S.group * 0.7; ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.roundRect(x0, y, Math.round(W * 0.09), Math.max(5, W * 0.006), 3); ctx.fill(); y += S.group * 0.9;
    if (subs.length) y += t.block('sub', subs, x0, y, S.sub, 400, body, pal.muted, 'left', 1.32) + S.group * 0.9; if (btnH) t.button(c.cta, x0, y, 'left', undefined, undefined, colW); await t.logoBottom(cx); return;
  }

  if (pattern === 'offer') {
    const offer = c.offer ?? { big: c.headline, small: '' }; let withPhoto = !!heroPhoto && H / W >= 1.2; let withSub = !!c.subline;
    const wide = !!heroPhoto && heroPhoto.width / heroPhoto.height >= 1.1; const bandH = wide ? Math.round(H * 0.22) : Math.round(W * 0.27); const panelH = Math.round(H * (withPhoto ? 0.23 : 0.29)); const btn = c.cta ? S.btnH : 0;
    const eyeH = c.eyebrow ? S.eyebrow * 1.2 + S.group * 0.8 : 0; const hd = head(Math.round(S.headline * 0.78), Math.round(S.headline * 0.5), innerW, 2); const headH = hd.lines.length * hd.size * 1.06 + S.group * 0.9;
    ctx.font = font(400, S.sub, body); let subLines = c.subline ? wrap(ctx, c.subline, innerW * 0.84).slice(0, 2) : []; const subH = (n: string[]) => (n.length ? n.length * S.sub * 1.32 + S.group * 0.9 : 0);
    const need = () => m + eyeH + (withPhoto ? bandH + S.group : 0) + headH + panelH + S.group + subH(subLines) + (btn ? S.section * 0.7 + btn : 0);
    if (need() > footerTop - S.group * 0.5 && subLines.length) { subLines = []; withSub = false; notes.push('The supporting line was left out so the offer and the photo have room.'); }
    if (need() > footerTop - S.group * 0.5 && withPhoto) { withPhoto = false; notes.push('There was not enough room for a photo with the offer, so it was left out.'); }
    let y = m; if (!withPhoto) y = Math.max(m, Math.round((footerTop - need()) / 2.4)); y += eyebrow(y);
    if (withPhoto && heroPhoto && input.hero) { if (wide) await cell(t, input.hero, m, y, innerW, bandH, 'hero', Math.round(W * 0.035)); else if (use) circlePhoto(t, heroPhoto, use.focus, W / 2, y + bandH / 2, bandH, pal.accent, 'hero'); y += bandH + S.group * 1.2; }
    y += t.block('headline', hd.lines, W / 2, y, hd.size, dWeight, display, pal.text, 'center', 1.06) + S.group * 0.9;
    // the offer panel: the offer is the biggest thing in the post
    ctx.save(); ctx.shadowColor = alpha(mix(pal.accent, '#000000', 0.55), 0.38); ctx.shadowBlur = W * 0.04; ctx.shadowOffsetY = W * 0.016; const pg = ctx.createLinearGradient(0, y, 0, y + panelH); pg.addColorStop(0, mix(pal.accent, '#FFFFFF', 0.09)); pg.addColorStop(1, mix(pal.accent, '#000000', 0.12)); ctx.fillStyle = pg; ctx.beginPath(); ctx.roundRect(m, y, innerW, panelH, W * 0.05); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(m, y, innerW, panelH, W * 0.05); ctx.clip(); softDisc(ctx, m + innerW * 0.85, y + panelH * 0.1, panelH * 1.1, '#FFFFFF', 0.16); ctx.restore(); ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = Math.max(2, W * 0.002); ctx.beginPath(); ctx.roundRect(m + W * 0.012, y + W * 0.012, innerW - W * 0.024, panelH - W * 0.024, W * 0.04); ctx.stroke(); ctx.restore();
    const big = t.fit(ctx, offer.big, display, dWeight, Math.round(W * 0.22), Math.round(W * 0.08), innerW * 0.82, 1); const ink = pal.onAccent; const bigH = big.size * 1.05; const smallGap = offer.small ? S.group * 0.9 : 0; const smallH = offer.small ? S.sub * 1.3 : 0; const top = y + (panelH - bigH - smallGap - smallH) / 2;
    t.text('offer', big.lines[0] ?? offer.big, W / 2, top, big.size, dWeight, display, ink, 'center'); boxes[boxes.length - 1].on = pal.accent; boxes[boxes.length - 1].h = bigH;
    if (offer.small) { t.text('offersmall', offer.small, W / 2, top + bigH + smallGap, S.sub, 700, body, ink, 'center', 0.95); boxes[boxes.length - 1].on = pal.accent; }
    y += panelH + S.group;
    if (withSub && subLines.length) y += t.block('sub', subLines, W / 2, y, S.sub, 400, body, pal.muted, 'center', 1.32) + S.group * 0.9;
    if (btn) t.button(c.cta, 0, Math.min(footerTop - btn, y + S.section * 0.7), 'center', pal.text, readable(pal.text));
    await t.logoBottom(); return;
  }

  if (pattern === 'benefits') {
    const pts = (c.points ?? []).slice(0, 4); const hasPhoto = !!heroPhoto && !!use; const d = hasPhoto ? Math.round(W * 0.25) : 0; let y = m;
    y += eyebrow(y, 'left'); const hw = innerW - (d ? d + S.group : 0); const hd = head(Math.round(S.headline * 0.88), Math.round(S.headline * 0.55), hw, 3);
    const hy = y; y += t.block('headline', hd.lines, m, y, hd.size, dWeight, display, pal.text, 'left', 1.06);
    if (hasPhoto && heroPhoto && use) circlePhoto(t, heroPhoto, use.focus, W - m - d / 2, Math.max(m + d / 2, hy + Math.max(hd.lines.length * hd.size * 1.06, d) / 2 - (d ? 0 : 0)), d, null, 'hero');
    y = Math.max(y, hasPhoto ? hy + d : y) + S.section * 0.8; const btn = c.cta ? S.btnH : 0; const bottom = footerTop - (btn ? btn + S.group : 0) - S.group * 0.3; const area = bottom - y; const n = Math.max(1, pts.length); const rowH = Math.min(H * 0.16, area / n);
    const r = Math.min(rowH * 0.3, W * 0.06);
    // each row must hold its words with air: if two-line labels and details do not fit the row, the detail goes, then the label is set on one line
    const tw0 = innerW - r * 2 - S.group; const lblSize = Math.round(S.sub * 1.04); const detSize = Math.round(S.small * 1.15);
    const rowNeed = (withDetail: boolean) => Math.max(...pts.map((p) => { ctx.font = font(700, lblSize, body); const l = wrap(ctx, p.label, tw0).slice(0, 2).length; ctx.font = font(400, detSize, body); const d = withDetail && p.detail ? wrap(ctx, p.detail, tw0).slice(0, 2).length : 0; return l * lblSize * 1.22 + (d ? S.tight * 0.8 + d * detSize * 1.3 : 0); })) + S.tight * 2;
    const showDetail = rowNeed(true) <= rowH; const oneLine = !showDetail && rowNeed(false) > rowH; if (!showDetail) notes.push('The detail lines were left out so each point has room.');
    pts.forEach((p, i) => { const top = y + i * rowH; if (i > 0) { ctx.fillStyle = alpha(pal.text, 0.14); ctx.fillRect(m, top, innerW, Math.max(2, W * 0.0018)); }
      const cy = top + rowH / 2; drawIcon(t, p.icon || iconFor(p.label), m + r, cy, r, pal.accent, pal.onAccent); const tx = m + r * 2 + S.group; const tw = innerW - (tx - m);
      const one = oneLine ? t.fit(ctx, p.label, body, 700, lblSize, Math.round(S.sub * 0.7), tw, 1) : null; ctx.font = font(700, one?.size ?? lblSize, body); const lab = one ? one.lines : wrap(ctx, p.label, tw).slice(0, 2); const ls = one?.size ?? lblSize; ctx.font = font(400, detSize, body); const det = showDetail && p.detail ? wrap(ctx, p.detail, tw).slice(0, 2) : [];
      const lh = lab.length * ls * 1.22; const dh = det.length * detSize * 1.3; const gap = det.length ? S.tight * 0.8 : 0; let yy = cy - (lh + gap + dh) / 2;
      yy += t.block(`point${i}`, lab, tx, yy, ls, 700, body, pal.text, 'left', 1.22) + gap; if (det.length) t.block(`detail${i}`, det, tx, yy, detSize, 400, body, pal.muted, 'left', 1.3); });
    if (btn) t.button(c.cta, m, footerTop - btn, 'left'); await t.logoBottom(); return;
  }

  if (pattern === 'collage') {
    const photos = c.items.filter((i) => i.photo).slice(0, 3); let y = m; y += eyebrow(y); const hd = head(Math.round(S.headline * 0.82), Math.round(S.headline * 0.5), innerW, 2);
    y += t.block('headline', hd.lines, W / 2, y, hd.size, dWeight, display, pal.text, 'center', 1.06) + S.section * 0.8; const btn = c.cta ? S.btnH : 0; const bottom = footerTop - (btn ? btn + S.group : 0) - S.group * 0.3; const h = bottom - y; const gap = Math.round(S.group * 0.6); const rad = Math.round(W * 0.03);
    if (photos.length >= 3) { const lw = Math.round(innerW * 0.58); const rw = innerW - lw - gap; const rh = (h - gap) / 2; await cell(t, photos[0].photo!, m, y, lw, h, 'cell0', rad, true); await cell(t, photos[1].photo!, m + lw + gap, y, rw, rh, 'cell1', rad, true); await cell(t, photos[2].photo!, m + lw + gap, y + rh + gap, rw, rh, 'cell2', rad, true); }
    else if (photos.length === 2) { const cw = (innerW - gap) / 2; await cell(t, photos[0].photo!, m, y, cw, h, 'cell0', rad, true); await cell(t, photos[1].photo!, m + cw + gap, y, cw, h, 'cell1', rad, true); }
    else if (heroPhoto && input.hero) await cell(t, input.hero, m, y, innerW, h, 'cell0', rad, true);
    if (btn) t.button(c.cta, 0, footerTop - btn, 'center'); await t.logoBottom(); return;
  }

  if (pattern === 'quote') {
    const q = c.quote ?? { text: c.headline, by: '' }; let d = heroPhoto && use ? Math.round(W * 0.22) : 0; const mark = Math.round(W * 0.2); const byH = q.by ? S.group * 1.4 + S.eyebrow * 1.4 : 0; const weight = display === 'Lobster' ? 400 : dWeight === 800 ? 700 : dWeight;
    const settle = (photo: number) => { const avail = footerTop - m - mark * 0.5 - S.group * 1.2 - byH - (photo ? photo + S.section : 0); for (let size = Math.round(W * (q.text.length < 50 ? 0.145 : q.text.length < 70 ? 0.12 : q.text.length < 110 ? 0.092 : 0.078)); size >= Math.round(W * 0.036); size -= 2) { const f = t.fit(ctx, q.text, display, weight, size, size, innerW * 0.88, 12); if (f.lines.length * size * 1.22 <= avail && f.lines.length <= 9) return f; } return null; };
    let qs = settle(d); if (!qs && d) { d = 0; notes.push('The photo was left out so the words have room.'); qs = settle(0); } qs = qs ?? t.fit(ctx, q.text, display, weight, Math.round(W * 0.036), Math.round(W * 0.036), innerW * 0.88, 12);
    const qh = qs.lines.length * qs.size * 1.22; const total = (d ? d + S.section : 0) + mark * 0.5 + qh + S.group * 1.2 + byH; let y = Math.max(m, Math.round((footerTop - total) / 2));
    if (d && heroPhoto && use) { circlePhoto(t, heroPhoto, use.focus, W / 2, y + d / 2, d, pal.accent, 'hero'); y += d + S.section; }
    softDisc(ctx, W / 2, y + qh * 0.4, Math.min(W * 0.62, qh * 1.3 + W * 0.25), pal.accent, 0.16); boxes.push({ kind: 'graphic', id: 'halo', x: W * 0.12, y: Math.max(0, y + qh * 0.4 - W * 0.4), w: W * 0.76, h: W * 0.8, bleed: true });
    t.text('quotemark', '“', W / 2, y - mark * 0.12, mark, 400, display, pal.accent, 'center'); boxes[boxes.length - 1].h = mark * 0.5; y += mark * 0.5;
    y += t.block('quote', qs.lines, W / 2, y, qs.size, weight, display, pal.text, 'center', 1.22) + S.group * 1.2;
    if (q.by) { y += S.group * 0.3; const by = q.by.toUpperCase(); ctx.font = font(700, S.eyebrow, body); const bw = ctx.measureText(by).width + 3 * by.length; t.text('by', by, W / 2 + 1.5, y, S.eyebrow, 700, body, pal.muted, 'center', 1, 3); flankedLabel(ctx, W, y, bw, S.eyebrow, pal.accent, 0.7); }
    await t.logoBottom(); return;
  }

  if (pattern === 'spotlight' && H / W < 1.2 && heroPhoto && use && input.hero) {
    // a square post: the words in a left column, the product as tall as the post allows in the right
    const leftW = Math.round(innerW * 0.44); const px = m + leftW + S.group; const pw = W - m - px; const top = m; const ph = footerTop - S.group * 0.5 - top; let y = m;
    if (c.eyebrow) { t.text('eyebrow', c.eyebrow.toUpperCase().slice(0, 22), m, y, S.eyebrow, 700, body, pal.muted, 'left', 1, 3); y += S.eyebrow * 1.2 + S.group; }
    const hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * 1.05), Math.round(S.headline * 0.55), leftW, 4); y += t.block('headline', hd.lines, m, y, hd.size, dWeight, display, pal.text, 'left', 1.04);
    if (c.subline) { y += S.group * 0.7; ctx.font = font(400, S.sub, body); y += t.block('sub', wrap(ctx, c.subline, leftW).slice(0, 3), m, y, S.sub, 400, body, pal.muted, 'left', 1.3); }
    if (c.cta) { y += S.group * 1.4; ctx.font = font(700, S.cta, body); const f = t.fit(ctx, c.cta, body, 700, S.cta, Math.round(S.cta * 0.7), leftW, 1); const w = t.text('cta', f.lines[0] ?? c.cta, m, y, f.size, 700, body, pal.text, 'left', 1, 0.3); ctx.fillStyle = pal.accent; ctx.fillRect(m, y + f.size * 1.3, w, Math.max(4, W * 0.005)); }
    if (use.mode === 'seamless') { const sz = contain({ w: pw + m * 0.4, h: ph }, heroPhoto); const x = W - m * 0.4 - sz.w; const yy = top + (ph - sz.h) / 2; feathered(ctx, t.createCanvas, heroPhoto, x, yy, sz.w, sz.h, Math.min(sz.w, sz.h) * 0.07); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h, bleed: true }); }
    else if (use.mode === 'cutout') { const bb = use.bbox ?? { x: 0, y: 0, w: 1, h: 1 }; const sw = bb.w * heroPhoto.width; const sh = bb.h * heroPhoto.height; const sz = contain({ w: pw, h: ph * 0.96 }, { width: sw, height: sh } as Photo); const x = px + (pw - sz.w) / 2; const yy = top + (ph - sz.h) / 2; ctx.drawImage(heroPhoto.image as never, bb.x * heroPhoto.width, bb.y * heroPhoto.height, sw, sh, x, yy, sz.w, sz.h); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h, tight: true }); }
    else { coverBox(ctx, heroPhoto, px, top, pw, ph, use.focus, Math.round(W * 0.035), true); boxes.push({ kind: 'photo', id: 'hero', x: px, y: top, w: pw, h: ph }); }
    await t.logoBottom(); return;
  }
  if (pattern === 'spotlight') {
    let y = m; if (c.eyebrow) { t.text('eyebrow', c.eyebrow.toUpperCase(), m, y, S.eyebrow, 700, body, pal.muted, 'left', 1, 3); y += S.eyebrow * 1.2 + S.group; }
    const sq = H / W < 1.2; const hd = head(Math.round(S.headline * (sq ? 1.05 : 1.38)), Math.round(S.headline * 0.55), innerW, 2); y += t.block('headline', hd.lines, m, y, hd.size, dWeight, display, pal.text, 'left', 1.02, c.headline.split(' ').length >= 3 ? t.emph() : undefined);
    if (c.subline) { y += S.group * 0.7; ctx.font = font(400, S.sub, body); y += t.block('sub', wrap(ctx, c.subline, innerW * 0.8).slice(0, 1), m, y, S.sub, 400, body, pal.muted, 'left', 1.3); }
    const ctaH = c.cta ? Math.round(S.cta * 1.7) : 0; const ctaY = footerTop - ctaH; const bottom = (ctaH ? ctaY - S.group : footerTop - S.group * 0.4); const top = y + S.group; const h = bottom - top;
    if (heroPhoto && use && input.hero) {
      if (use.mode === 'seamless') { const sz = contain({ w: W * 1.0, h }, heroPhoto); const x = (W - sz.w) / 2; const yy = top + (h - sz.h) / 2; feathered(ctx, t.createCanvas, heroPhoto, x, yy, sz.w, sz.h, Math.min(sz.w, sz.h) * 0.07); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h, bleed: true }); }
      else if (use.mode === 'cutout') { const bb = use.bbox ?? { x: 0, y: 0, w: 1, h: 1 }; const sw = bb.w * heroPhoto.width; const sh = bb.h * heroPhoto.height; const sz = contain({ w: W * 0.9, h: h * 0.96 }, { width: sw, height: sh } as Photo); const x = (W - sz.w) / 2; const yy = top + (h - sz.h) / 2;
        ctx.save(); const gy = yy + sz.h * 0.96; const g = ctx.createRadialGradient(W / 2, gy, 0, W / 2, gy, sz.w * 0.55); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.translate(0, gy); ctx.scale(1, 0.16); ctx.translate(0, -gy); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, gy, sz.w * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.drawImage(heroPhoto.image as never, bb.x * heroPhoto.width, bb.y * heroPhoto.height, sw, sh, x, yy, sz.w, sz.h); boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: sz.w, h: sz.h, tight: true }); }
      else { coverBox(ctx, heroPhoto, 0, top, W, h, use.focus, 0, false); boxes.push({ kind: 'photo', id: 'hero', x: 0, y: top, w: W, h, bleed: true }); }
    } else notes.push('No photo: the headline carries the post on its own.');
    if (ctaH) { const w = t.text('cta', c.cta, m, ctaY, S.cta, 700, body, pal.text, 'left', 1, 0.3); ctx.fillStyle = pal.accent; ctx.fillRect(m, ctaY + S.cta * 1.3, w, Math.max(4, W * 0.005)); }
    await t.logoBottom(); return;
  }

  // banner: a bold band, the headline, the photo in an arch with a ring, the details in plain words
  const band = c.season?.colour ?? pal.accent; const bandInk = readable(band); const bh = Math.round(S.eyebrow * 3.4); ctx.fillStyle = band; ctx.fillRect(0, 0, W, bh);
  const label = (c.event?.label ?? c.season?.label ?? c.eyebrow ?? '').toUpperCase(); const sp = Math.max(3, S.eyebrow * 0.2); t.text('bandlabel', label, W / 2 + sp / 2, (bh - S.eyebrow * 1.2) / 2, S.eyebrow, 700, body, bandInk, 'center', 1, sp); boxes[boxes.length - 1].on = band;
  softDisc(ctx, W * 0.5, H * 0.42, W * 0.7, band, 0.22); softDisc(ctx, W * 0.95, H * 0.95, W * 0.4, '#FFFFFF', 0.08);
  ctx.save(); ctx.fillStyle = alpha(pal.accent, 0.16); for (let r = 0; r < 4; r += 1) for (let q = 0; q < 6; q += 1) { ctx.beginPath(); ctx.arc(W - m * 0.7 - q * W * 0.05, bh + m * 0.6 + r * W * 0.05, W * 0.007, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(m * 0.7 + q * W * 0.05, H - m * 1.8 - r * W * 0.05, W * 0.007, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  const hasPhoto = !!(heroPhoto && use && input.hero); const hd = t.fit(ctx, c.headline, display, dWeight, Math.round(S.headline * 1.15), Math.round(S.headline * 0.62), innerW * 0.94, 3); const line0 = c.event?.line ?? ''; const block0 = hd.lines.length * hd.size * 1.05 + S.group + (line0 ? S.sub * 1.5 + S.group : 0) + (c.cta ? S.btnH + S.group : 0); let y = hasPhoto ? bh + S.section : Math.max(bh + S.section, Math.round(bh + (footerTop - bh - block0) / 2.2)); if (!hasPhoto) { ctx.save(); ctx.strokeStyle = alpha(band, 0.3); ctx.lineWidth = Math.max(3, W * 0.005); for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(W / 2, y + hd.lines.length * hd.size * 0.5, innerW * (0.3 + i * 0.13), 0, Math.PI * 2); ctx.stroke(); } ctx.restore(); { const rr = innerW * 0.56; const rcy = y + hd.lines.length * hd.size * 0.5; boxes.push({ kind: 'graphic', id: 'rings', x: W / 2 - rr, y: Math.max(bh, rcy - rr), w: rr * 2, h: Math.min(H - bh, rr * 2), bleed: true }); } } y += t.block('headline', hd.lines, W / 2, y, hd.size, dWeight, display, pal.text, 'center', 1.05) + S.group;
  const line = c.event?.line ?? ''; const lineH = line ? S.sub * 1.5 + S.group : 0; const btn = c.cta ? S.btnH : 0; const bottom = footerTop - (btn ? btn + S.group : 0) - lineH - S.group * 0.4; const room = bottom - y;
  if (heroPhoto && use && input.hero && room > H * 0.2) {
    const pw = Math.min(innerW * 0.74, room * 0.86); const ph = Math.min(room, pw * 1.12); const x = (W - pw) / 2; const yy = y + (room - ph) / 2; const r = pw / 2;
    ctx.save(); ctx.strokeStyle = alpha(band, 0.95); ctx.lineWidth = Math.max(4, W * 0.006); ctx.beginPath(); ctx.roundRect(x - W * 0.02, yy - W * 0.02, pw + W * 0.04, ph + W * 0.04, [r + W * 0.02, r + W * 0.02, W * 0.04, W * 0.04]); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, yy, pw, ph, [r, r, W * 0.025, W * 0.025]); ctx.clip(); const scale = Math.max(pw / heroPhoto.width, ph / heroPhoto.height); const sw = pw / scale; const sh = ph / scale; const sx = Math.max(0, Math.min(heroPhoto.width - sw, use.focus.x * heroPhoto.width - sw / 2)); const sy = Math.max(0, Math.min(heroPhoto.height - sh, use.focus.y * heroPhoto.height - sh / 2)); ctx.drawImage(heroPhoto.image as never, sx, sy, sw, sh, x, yy, pw, ph); ctx.restore();
    boxes.push({ kind: 'photo', id: 'hero', x, y: yy, w: pw, h: ph }); y = yy + ph + S.group * 1.6;
  } else { notes.push('No photo: rings and the headline carry the banner.'); }
  if (line) { let words = line.split(' '); let f = t.fit(ctx, words.join(' '), body, 700, S.sub, Math.round(S.small * 1.1), innerW - S.sub * 2.4, 1); while (f.lines.length > 1 && words.length > 3) { words = words.slice(0, -1); f = t.fit(ctx, words.join(' '), body, 700, S.sub, Math.round(S.small * 1.1), innerW - S.sub * 2.4, 1); } const text = f.lines[0] ?? words.join(' '); ctx.font = font(700, f.size, body); const lw = ctx.measureText(text).width + f.size * 2; ctx.fillStyle = alpha(band, 0.22); ctx.beginPath(); ctx.roundRect((W - lw) / 2, y - S.tight * 0.4, lw, f.size * 1.55, f.size * 0.78); ctx.fill(); t.text('eventline', text, W / 2, y, f.size, 700, body, pal.text, 'center'); y += lineH; }
  if (btn) t.button(c.cta, 0, footerTop - btn, 'center', band, bandInk);
  await t.logoBottom(); void mix; void contrast;
}
