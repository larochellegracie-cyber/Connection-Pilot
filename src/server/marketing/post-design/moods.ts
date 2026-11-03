import { contrast, lum, mix, readable } from './draw-utils.js';
import type { Palette, Pattern, TypeTreatment } from './layouts.js';
import type { PostStyle } from './style.js';
import { PAIRINGS } from './tokens.js';
import type { BrandKit } from '../standard-video/templates.js';
import type { Motif } from './graphics.js';

/**
 * MOODS: the owner asks for a feeling ("make it retro", "something bold", "elegant and minimal") and the post takes it on: colours (made from the business's own brand colours),
 * a headline face, how the headline is set, the finishing details, and the shapes a graphic post draws. The business's brand colours stay recognisable in every mood.
 */
export type Mood = 'retro' | 'modern' | 'luxury' | 'playful' | 'minimal' | 'bold' | 'natural' | 'handmade';
const MOODS: Array<[Mood, RegExp]> = [
  ['retro', /\b(?:retro|vintage|70s|seventies|nostalgi\w*|throwback)\b/i], ['modern', /\b(?:modern|futuristic|tech|techy|neon|sleek|digital)\b/i], ['luxury', /\b(?:luxur\w+|elegant|premium|upscale|classy|sophisticated|high[- ]end)\b/i], ['playful', /\b(?:playful|fun|kids|cheerful|cute|colou?rful|vibrant)\b/i],
  ['minimal', /\b(?:minimal\w*|simple|clean and simple|plain|understated)\b/i], ['bold', /\b(?:bold|loud|punchy|strong|striking|big and bold|poster)\b/i], ['natural', /\b(?:natural|organic|eco|earthy|botanical|green|fresh and natural)\b/i], ['handmade', /\b(?:handmade|homemade|cozy|cosy|rustic|craft\w*|kraft|warm and friendly|hand[- ]?drawn)\b/i],
];
export const moodFrom = (text: string): Mood | null => MOODS.find(([, re]) => re.test(text))?.[0] ?? null;
export const MOOD_MOTIFS: Record<Mood, Motif> = { retro: 'burst', modern: 'rings', luxury: 'arches', playful: 'blobs', minimal: 'dots', bold: 'stripes', natural: 'leaf', handmade: 'blobs' };

const ink = (bg: string, light = '#FFFFFF', dark = '#1B1B1F') => readable(bg, light, dark);
/** A palette made safe to read: ink at least 4.5 to 1 on the page, an accent at least 3 to 1, muted words at least 4.6. */
function safe(top: string, bottom: string, text: string, accent: string, textFallback?: string): Palette {
  const mid = mix(top, bottom, 0.5); const worst = (c: string) => Math.min(contrast(c, top), contrast(c, bottom)); const t = worst(text) >= 4.5 ? text : textFallback && worst(textFallback) >= 4.5 ? textFallback : worst('#FFFFFF') >= worst('#1B1B1F') ? '#FFFFFF' : '#1B1B1F';
  let a = accent; if (contrast(a, mid) < 3) a = lum(mid) > 0.5 ? mix(accent, '#000000', 0.5) : mix(accent, '#FFFFFF', 0.5); if (contrast(a, mid) < 3) a = ink(mid);
  let muted = t; for (const k of [0.34, 0.26, 0.18, 0.1]) { const c = mix(t, mid, k); if (worst(c) >= 4.6) { muted = c; break; } }
  return { bgTop: top, bgBottom: bottom, text: t, muted, accent: a, onAccent: ink(a), seamless: false };
}

export function moodStyle(mood: Mood, kit: BrandKit, pattern: Pattern): PostStyle {
  const P = kit.primary; const S = kit.secondary; const A = kit.accent; const pair = (id: string) => PAIRINGS.find((p) => p.id === id)!;
  const base = { pattern, align: 'center' as const, caps: false, headlineScale: 1, accentWord: true, eyebrow: true, paletteMode: 'brand' as const, air: 1, photo: { shape: 'rounded' as const, bleed: false, frame: 'shadow' as const, position: 'center' as const }, button: 'pill' as const, textPosition: 'bottom' as const, scrim: 'bottom' as const, logo: 'bottom' as const };
  const mk = (palette: Palette, pairing: string, type: TypeTreatment, over: Partial<PostStyle> = {}): PostStyle => ({ ...base, palette, pairing: pair(pairing), type, elements: [], background: 'gradient', tone: lum(mix(palette.bgTop, palette.bgBottom, 0.5)) < 0.4 ? 'dark' : 'light', summary: `${mood} mood`, ...over });
  switch (mood) {
    case 'retro': return mk(safe('#F6EBD5', '#EBDDBC', mix(P, '#000000', 0.72), P), 'retro-slab', { tracking: 0.02 }, { elements: ['keyline_frame', 'rule'], background: 'flat', accentWord: false });
    case 'modern': return mk(safe(mix('#0D1117', S, 0.16), mix('#161C26', S, 0.22), '#F4F7FB', mix(P, '#FFFFFF', 0.28)), 'tech-grotesk', { tracking: -0.01, highlight: true }, { elements: ['soft_shapes'], background: 'soft_shapes', align: 'left' });
    case 'luxury': return mk(safe(mix(P, '#000000', 0.78), mix(P, '#000000', 0.88), '#F4EDE0', '#C9A24B'), 'luxe-light', { tracking: 0.06, caps: true }, { caps: true, elements: ['keyline_frame', 'rule'], air: 1.2, accentWord: false });
    case 'playful': return mk(safe(mix(P, '#FFFFFF', 0.86), mix(A, '#FFFFFF', 0.82), '#1F1A2E', P), 'rounded-friendly', { highlight: true }, { elements: ['soft_shapes', 'pill_label'] });
    case 'minimal': return mk(safe('#FFFFFF', '#F6F6F3', '#111111', P), 'poppins-clean', { tracking: 0 }, { elements: [], background: 'flat', air: 1.2, accentWord: false });
    case 'bold': { let bg = P; for (let t = 0; t <= 0.6 && contrast('#FFFFFF', bg) < 4.8; t += 0.05) bg = mix(P, '#000000', t); return mk(safe(bg, mix(bg, '#000000', 0.18), '#FFFFFF', '#FFD23F'), 'poster-condensed', { caps: true, shadow: true, tracking: 0.01 }, { caps: true, elements: ['rule'], headlineScale: 1.12, accentWord: true }); }
    case 'natural': return mk(safe('#F3F0E4', '#E8E4D2', '#24332A', '#3F7D58'), 'editorial-serif', {}, { elements: ['soft_shapes', 'rule'], background: 'soft_shapes' });
    default: return mk(safe('#EBDCC0', '#E2D0B0', '#4A3426', mix(P, '#000000', 0.15)), 'handwritten', { underline: true }, { elements: ['keyline_frame'], background: 'textured', headlineScale: 1.1 });
  }
}
