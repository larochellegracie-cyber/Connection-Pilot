import type { SKRSContext2D } from '@napi-rs/canvas';
import { FONT_FAMILY } from './fonts.js';
import type { CardElement } from './spec.js';

/**
 * Draws the UI cards of a Standard Video (checklists, chat bubbles, calendars, quotes, plans, charts, phone screens, badges).
 * Everything is plain canvas drawing from a few words, so it is free and repeatable. `t` is the seconds since the card started to
 * appear; the rows, bubbles, ticks and bars inside it come in one after another from that clock.
 */
const INK = '#0B1F44'; const MUTED = '#64748B'; const SOFT = '#EDF1F7';
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const backOut = (t: number) => { const k = clamp01(t); return 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2; };
/** 0 before `at`, 1 once `dur` seconds later */
const appear = (t: number, at: number, dur = 0.4) => easeOut((t - at) / dur);

const luminance = (hex: string) => { const m = /^#([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); }

/** One line of text that shrinks to fit `maxW` (cards never wrap, so nothing spills out of them). */
function line(ctx: SKRSContext2D, text: string, x: number, y: number, size: number, weight: number, color: string, maxW: number, align: 'left' | 'center' | 'right' = 'left') {
  let px = size;
  ctx.font = `${weight} ${px}px ${FONT_FAMILY}, sans-serif`;
  while (px > size * 0.55 && ctx.measureText(text).width > maxW) { px -= 1; ctx.font = `${weight} ${px}px ${FONT_FAMILY}, sans-serif`; }
  ctx.textBaseline = 'middle'; ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function tick(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = r * 0.3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(cx - r * 0.42, cy + r * 0.02); ctx.lineTo(cx - r * 0.1, cy + r * 0.34); ctx.lineTo(cx + r * 0.46, cy - r * 0.32); ctx.stroke(); ctx.restore();
}

/** A tick in a disc that pops in. */
function tickDisc(ctx: SKRSContext2D, cx: number, cy: number, r: number, accent: string, ink: string, p: number) {
  if (p <= 0) return;
  const k = Math.max(0.01, backOut(p)); ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-cx, -cy);
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); tick(ctx, cx, cy, r, ink); ctx.restore();
}

const button = (ctx: SKRSContext2D, label: string, x: number, y: number, w: number, h: number, accent: string, ink: string, p: number, s: number) => {
  if (p <= 0) return;
  ctx.save(); ctx.globalAlpha *= p; ctx.fillStyle = accent; rr(ctx, x, y + (1 - p) * 16 * s, w, h, h / 2); ctx.fill();
  line(ctx, label, x + w / 2, y + h / 2 + (1 - p) * 16 * s, h * 0.42, 800, ink, w - 40 * s, 'center'); ctx.restore();
};

export function drawCard(ctx: SKRSContext2D, el: CardElement, b: { x: number; y: number; w: number; h: number }, s: number, t: number, accent: string) {
  const { x, y, w, h } = b; const p = 40 * s;
  const accentInk = luminance(accent) > 0.55 ? INK : '#FFFFFF';
  const dark = el.tone === 'dark'; const toned = el.tone === 'accent';
  const face = dark ? INK : toned ? accent : '#FFFFFF'; const text = dark ? '#FFFFFF' : toned ? accentInk : INK; const muted = dark ? '#AEB9CE' : toned ? accentInk : MUTED;
  const rows = el.lines ?? [];
  if (el.opacity !== undefined) ctx.globalAlpha *= el.opacity;

  if (el.card === 'pill') {
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 24 * s; ctx.shadowOffsetY = 8 * s;
    ctx.fillStyle = dark ? INK : toned ? accent : '#FFFFFF'; rr(ctx, x, y, w, h, h / 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = dark || !toned ? accent : accentInk; ctx.beginPath(); ctx.arc(x + h * 0.5, y + h / 2, h * 0.16, 0, Math.PI * 2); ctx.fill();
    line(ctx, el.title ?? '', x + h * 0.82, y + h / 2, h * 0.42, 800, text, w - h * 1.1);
    return;
  }

  // a soft, wide shadow and a hairline edge, so a card lifts off the background without a hard outline
  ctx.save(); ctx.shadowColor = 'rgba(2,10,30,0.28)'; ctx.shadowBlur = 64 * s; ctx.shadowOffsetY = 26 * s;
  ctx.fillStyle = el.card === 'screen' ? '#0A1226' : face; rr(ctx, x, y, w, h, (el.card === 'screen' ? 64 : 36) * s); ctx.fill(); ctx.restore();
  if (el.card !== 'screen') { ctx.save(); ctx.strokeStyle = dark ? 'rgba(255,255,255,0.10)' : 'rgba(11,31,68,0.07)'; ctx.lineWidth = 1.5 * s; rr(ctx, x, y, w, h, 36 * s); ctx.stroke(); ctx.restore(); }

  if (el.card === 'blank') return;

  if (el.card === 'checklist') {
    line(ctx, el.title ?? '', x + p, y + p + 24 * s, 42 * s, 800, text, w - p * 2);
    const top = y + p + 80 * s; const step = Math.min(110 * s, (h - (top - y) - p) / Math.max(1, rows.length));
    rows.forEach((row, i) => {
      const at = 0.5 + i * 0.35; const a = appear(t, at); const cy = top + step * i + step / 2;
      if (i) { ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : SOFT; ctx.fillRect(x + p, top + step * i, w - p * 2, 2 * s); }
      tickDisc(ctx, x + p + 32 * s, cy, 28 * s, accent, accentInk, (t - at - 0.1) / 0.4);
      ctx.save(); ctx.globalAlpha *= a; line(ctx, row, x + p + 84 * s + (1 - a) * 24 * s, cy, 38 * s, 700, text, w - p * 2 - 90 * s); ctx.restore();
    });
    return;
  }

  if (el.card === 'chat') {
    ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x + p + 28 * s, y + p + 24 * s, 28 * s, 0, Math.PI * 2); ctx.fill();
    line(ctx, el.title ?? '', x + p + 78 * s, y + p + 24 * s, 38 * s, 800, text, w - p * 2 - 80 * s);
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : SOFT; ctx.fillRect(x, y + p + 72 * s, w, 2 * s);
    const top = y + p + 100 * s; const step = Math.min(120 * s, (h - (top - y) - p * 0.6) / Math.max(1, rows.length));
    rows.forEach((raw, i) => {
      const mine = raw.startsWith('>'); const msg = raw.replace(/^[<>]\s*/, '');
      const a = appear(t, 0.45 + i * 0.75); if (a <= 0) return;
      ctx.font = `700 ${36 * s}px ${FONT_FAMILY}, sans-serif`;
      const bw = Math.min(w - p * 1.5, ctx.measureText(msg).width + 64 * s); const bh = Math.min(96 * s, step - 14 * s); const by = top + step * i + (1 - a) * 22 * s;
      const bx = mine ? x + w - p * 0.75 - bw : x + p * 0.75;
      ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = mine ? accent : dark ? 'rgba(255,255,255,0.14)' : SOFT; rr(ctx, bx, by, bw, bh, 34 * s); ctx.fill();
      line(ctx, msg, bx + bw / 2, by + bh / 2, 36 * s, 700, mine ? accentInk : text, bw - 40 * s, 'center'); ctx.restore();
    });
    return;
  }

  if (el.card === 'calendar') {
    const head = 110 * s; ctx.save(); ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(x, y, w, head, [40 * s, 40 * s, 0, 0]); ctx.fill(); ctx.restore();
    line(ctx, el.title ?? '', x + p, y + head / 2, 44 * s, 800, accentInk, w - p * 2);
    const gx = x + p * 0.7; const gw = w - p * 1.4; const cw = gw / 7; const gy = y + head + 20 * s; const rowsN = 5;
    const ch = Math.min(cw * 0.9, (h - head - 40 * s) / (rowsN + 1));
    'MTWTFSS'.split('').forEach((d, i) => line(ctx, d, gx + cw * i + cw / 2, gy + ch / 2, 26 * s, 800, muted, cw, 'center'));
    const mark = (el.highlight ?? 17) - 1;
    for (let d = 0; d < 31; d += 1) {
      const col = d % 7; const row = Math.floor(d / 7) + 1; const cx = gx + cw * col + cw / 2; const cy = gy + ch * row + ch / 2;
      if (d === mark) {
        const k = Math.max(0.01, backOut((t - 0.9) / 0.5));
        ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(0, 0, Math.min(ch, cw) * 0.46, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        line(ctx, String(d + 1), cx, cy, 28 * s, 800, t > 0.9 ? accentInk : text, cw, 'center');
      } else line(ctx, String(d + 1), cx, cy, 26 * s, 600, text, cw, 'center');
    }
    return;
  }

  if (el.card === 'quote' || el.card === 'plan') {
    const plan = el.card === 'plan';
    if (plan) { const tw = Math.min(w - p * 2, 300 * s); ctx.fillStyle = accent; rr(ctx, x + p, y + p, tw, 56 * s, 28 * s); ctx.fill(); line(ctx, el.title ?? '', x + p + tw / 2, y + p + 28 * s, 30 * s, 800, accentInk, tw - 30 * s, 'center'); }
    else line(ctx, el.title ?? '', x + p, y + p + 24 * s, 44 * s, 800, text, w - p * 2);
    let top = y + p + 90 * s;
    if (plan && el.value) { line(ctx, el.value, x + p, top + 30 * s, 84 * s, 800, text, w - p * 2); top += 100 * s; }
    const reserve = el.button ? 130 * s : 40 * s; const step = Math.min(96 * s, (y + h - reserve - top) / Math.max(1, rows.length));
    rows.forEach((row, i) => {
      const at = 0.45 + i * 0.3; const a = appear(t, at); const cy = top + step * i + step / 2;
      ctx.save(); ctx.globalAlpha *= a;
      if (plan) { tickDisc(ctx, x + p + 24 * s, cy, 22 * s, accent, accentInk, (t - at) / 0.4); line(ctx, row, x + p + 68 * s, cy, 36 * s, 700, text, w - p * 2 - 70 * s); }
      else { line(ctx, row, x + p, cy, 36 * s, 700, text, w - p * 2 - 220 * s); ctx.fillStyle = SOFT; rr(ctx, x + w - p - 180 * s, cy - 14 * s, 180 * s * (0.55 + 0.45 * ((i * 37) % 10) / 10), 28 * s, 14 * s); ctx.fill(); }
      ctx.restore();
    });
    if (el.button) button(ctx, el.button, x + p, y + h - p - 74 * s, w - p * 2, 74 * s, accent, accentInk, appear(t, 0.45 + rows.length * 0.3 + 0.2), s);
    return;
  }

  if (el.card === 'stat') {
    line(ctx, el.value ?? '', x + w / 2, y + h * 0.42, Math.min(h * 0.5, 150 * s), 800, text, w - p * 2, 'center');
    line(ctx, el.title ?? '', x + w / 2, y + h * 0.78, 38 * s, 700, muted, w - p * 2, 'center');
    return;
  }

  if (el.card === 'chart') {
    line(ctx, el.title ?? '', x + p, y + p + 24 * s, 42 * s, 800, text, w - p * 2);
    const base = y + h - p; const top = y + p + 100 * s; const heights = [0.35, 0.5, 0.45, 0.7, 0.62, 0.95]; const n = heights.length; const gap = 18 * s; const bw = (w - p * 2 - gap * (n - 1)) / n;
    heights.forEach((v, i) => {
      const a = appear(t, 0.4 + i * 0.18, 0.6); const bh = (base - top) * v * a;
      ctx.fillStyle = i === n - 1 ? accent : dark ? 'rgba(255,255,255,0.18)' : SOFT; rr(ctx, x + p + i * (bw + gap), base - bh, bw, bh, 12 * s); ctx.fill();
    });
    return;
  }

  if (el.card === 'screen') {
    const inset = 16 * s; const sx = x + inset; const sy = y + inset; const sw = w - inset * 2; const sh = h - inset * 2;
    ctx.fillStyle = '#FFFFFF'; rr(ctx, sx, sy, sw, sh, 50 * s); ctx.fill();
    ctx.fillStyle = INK; rr(ctx, x + w / 2 - 70 * s, sy + 14 * s, 140 * s, 34 * s, 17 * s); ctx.fill();
    ctx.save(); rr(ctx, sx, sy, sw, sh, 50 * s); ctx.clip();
    ctx.fillStyle = accent; ctx.fillRect(sx, sy, sw, 150 * s);
    line(ctx, el.title ?? '', sx + 34 * s, sy + 100 * s, 40 * s, 800, accentInk, sw - 68 * s);
    const top = sy + 180 * s; const reserve = el.button ? 120 * s : 30 * s; const step = Math.min(120 * s, (sy + sh - reserve - top) / Math.max(1, rows.length));
    rows.forEach((row, i) => {
      const a = appear(t, 0.5 + i * 0.3); const cy = top + step * i + step / 2 + (1 - a) * 20 * s;
      ctx.save(); ctx.globalAlpha *= a;
      ctx.fillStyle = SOFT; rr(ctx, sx + 24 * s, cy - step * 0.4, sw - 48 * s, step * 0.8, 22 * s); ctx.fill();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(sx + 24 * s + step * 0.4, cy, step * 0.24, 0, Math.PI * 2); ctx.fill();
      line(ctx, row, sx + 24 * s + step * 0.8, cy, 32 * s, 700, INK, sw - 48 * s - step * 0.9);
      ctx.restore();
    });
    if (el.button) button(ctx, el.button, sx + 30 * s, sy + sh - 100 * s, sw - 60 * s, 68 * s, accent, accentInk, appear(t, 0.5 + rows.length * 0.3 + 0.2), s);
    ctx.restore();
  }
}
