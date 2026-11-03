import type { ReferenceAnalysis, SceneDesign, Slot } from './style.js';
import type { ColourRoles } from './colour.js';
import { forbiddenFor, type ReferenceText } from './protect.js';

/**
 * The design blueprint of a product-advert reference: the part of a reference video that a fully custom video is built from. It has two halves.
 *   VISUAL: colours (measured from the frames), lighting, background, typography, negative space, mood, and per scene where the hero object sits and how big.
 *   MOTION: how long it runs, how many scenes, each scene's length, camera move, how the object moves, when the words appear, and the transitions.
 * Nothing in it is the reference's own wording, brand or content. Brand names and distinctive words seen in the reference are carried only as `avoid`:
 * a list that is kept OUT of everything Pilot makes from it.
 */
export type DesignPalette = { bgA: string; bgB: string; glow: string; glow2: string; toneA: string; toneB: string; light: boolean; /** the colour for words on the backdrop */ text?: string };
export type SceneBlueprint = {
  seconds: number; role: 'hook' | 'scene' | 'closing'; transition: string;
  headline: { position: string; size: string; align: string } | null; product: { placement: string; size: string } | null;
  camera: string; objectMotion: string; textTiming: string;
};
export type DesignBlueprint = {
  format: '9:16' | '1:1' | '4:5' | '16:9'; totalSeconds: number; sceneCount: number; pacing: 'fast' | 'medium' | 'slow';
  visual: { /** where the floor begins (fraction of the height) when the reference shows one */ horizon: number | null; palette: DesignPalette; /** the colours measured from the reference by role (backdrop, floor, light, hero, accent, text) with the share of the frame each fills and the warmth of its light */ colours: ColourRoles | null; lighting: string; background: string; typography: string; negativeSpace: 'low' | 'medium' | 'high'; mood: string; hierarchy: string };
  motion: { scenes: SceneBlueprint[]; transitions: string[]; overall: string };
  avoid: string[];
  /** the reference's own text that must not appear in the new video: brand names and words, identifying slogans (strictly) and descriptive lines (only if lifted whole), after removing anything the owner's own words use */ forbidden: ReferenceText;
};

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const rgbOf = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: number[]) => `#${c.map(hex2).join('').toUpperCase()}`;
const mix = (a: string, b: string, t: number) => { const x = rgbOf(a); const y = rgbOf(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (h: string) => rgbOf(h).reduce((s, v, i) => { const c = v / 255; return s + (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]; }, 0);
const sat = (h: string) => { const [r, g, b] = rgbOf(h); const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
const average = (colours: string[]) => toHex([0, 1, 2].map((i) => colours.reduce((s, c) => s + rgbOf(c)[i], 0) / Math.max(1, colours.length)));

const contrastOf = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const hsl = (h: string) => { const [r, g, b] = rgbOf(h).map((v) => v / 255); const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2; const d = mx - mn; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); const hue = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: hue * 60, s, l }; };
const fromHsl = (h: number, s: number, l: number) => { const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]); };
/** A pale colour with too little colour in it gets some (same hue), so a warm beige set stays warm. */
export function warmUp(hex: string): string { const c = hsl(hex); return c.s >= 0.3 ? hex : fromHsl(c.h, 0.3, Math.max(0.55, Math.min(0.8, c.l))); }

/** The colours the reference is made of, measured from its frames: the backdrop (the colour most parts are mainly), two lights and two supporting tones. Words must read on it, so a mid-tone backdrop is pushed clearly light or dark. */
export function paletteFrom(analysis: Pick<ReferenceAnalysis, 'measures' | 'style'>): DesignPalette {
  const roles = analysis.measures.colourRoles;
  if (roles) {
    // the colours the reference really has, by role, used as they are: the backdrop is the top of the set, the floor the bottom of it, the light its glow
    const bgA = mix(roles.background, lum(roles.background) > 0.45 ? '#FFFFFF' : '#000000', 0.04);
    // a floor the reference really shows stays its own colour (not blended into the backdrop); with no visible floor the lower set is simply the backdrop a little darker
    const bgB = roles.separated ? roles.floor : mix(roles.background, '#000000', 0.16);
    // words: the reference's own text colour if it reads on the backdrop; otherwise whichever of dark ink or white reads better (a mid-tone beige takes dark ink)
    const darkInk = mix(roles.floor, '#000000', 0.8); const whiteInk = mix(roles.background, '#FFFFFF', 0.92);
    const bestInk = contrastOf(darkInk, bgA) >= contrastOf(whiteInk, bgA) ? darkInk : whiteInk;
    const text = contrastOf(roles.text, bgA) >= 4.5 ? roles.text : bestInk;
    const light = lum(text) < lum(bgA);
    return { bgA, bgB, glow: roles.glow, glow2: mix(roles.glow, roles.accent, 0.35), toneA: roles.hero, toneB: roles.accent, light, text };
  }
  const segments = analysis.measures.segments.filter((s) => s.colours?.length);
  const firsts = segments.map((s) => s.colours[0]).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  let bg = firsts.length ? average(firsts) : (analysis.style.theme === 'dark' ? '#241810' : '#DCCBB0');
  const wantLight = analysis.style.theme === 'light' || lum(bg) > 0.3;
  // keep it the same family of colour but clearly light or clearly dark
  if (wantLight && lum(bg) < 0.5) bg = mix(bg, '#FFFFFF', 0.45);
  if (!wantLight && lum(bg) > 0.1) bg = mix(bg, '#000000', 0.55);
  // frames of a warm set often measure as grey-beige: keep the hue they measured, but give a pale backdrop the warmth the eye sees (at least some colour in it)
  if (wantLight) bg = warmUp(bg);
  const all = segments.flatMap((s) => s.colours).filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const lively = [...all].sort((a, b) => sat(b) * Math.sqrt(1 + lum(b)) - sat(a) * Math.sqrt(1 + lum(a)));
  const dark = [...all].sort((a, b) => lum(a) - lum(b))[0] ?? '#3A2418';
  const light = wantLight;
  return {
    bgA: light ? mix(bg, '#FFFFFF', 0.28) : mix(bg, '#FFFFFF', 0.08), bgB: light ? mix(bg, '#000000', 0.2) : mix(bg, '#000000', 0.45),
    glow: light ? mix(bg, '#FFFFFF', 0.75) : mix(lively[0] ?? bg, '#FFFFFF', 0.35), glow2: light ? mix(lively[0] ?? bg, '#FFFFFF', 0.45) : mix(lively[1] ?? bg, '#FFFFFF', 0.2),
    toneA: light ? mix(dark, '#FFFFFF', 0.1) : mix(bg, '#FFFFFF', 0.6), toneB: mix(lively[0] ?? bg, light ? '#000000' : '#FFFFFF', 0.15), light,
  };
}

const HEAD_POS = { top: 'top', upper: 'upper third', middle: 'middle', lower: 'lower third', bottom: 'bottom' } as const;
const camera = (d: SceneDesign | undefined, zoom: number | undefined, drift: { dx: number; dy: number } | undefined) => {
  if (d?.product?.camera && d.product.camera !== 'static') return d.product.camera;
  if (zoom && zoom > 1.12) return 'push_in'; if (zoom && zoom < 0.88) return 'pull_out'; if (drift && Math.hypot(drift.dx, drift.dy) > 0.07) return 'pan';
  return d?.product?.camera ?? 'static';
};

/** Words of the reference's own that must never reach the new video: removed from any text before it is given to a model, and refused if a model returns them. */
export const scrub = (value: string, avoid: string[]) => avoid.reduce((text, word) => (word.length >= 3 ? text.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '').replace(/\s{2,}/g, ' ') : text), value).trim();
export const containsAvoided = (value: string, avoid: string[], allowed = '') => avoid.some((word) => word.length >= 3 && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value) && !new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(allowed));

export function buildDesignBlueprint(analysis: ReferenceAnalysis, slots: Slot[], { totalSeconds, allowed = '' }: { totalSeconds: number; allowed?: string }): DesignBlueprint {
  const { style, measures } = analysis;
  const avoid = (style.avoid ?? []).map((w) => w.trim()).filter((w) => w.length >= 3 && !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(allowed)).slice(0, 16);
  const scenes: SceneBlueprint[] = slots.map((slot, i) => {
    const part = analysis.measures.segments[Math.min(i, analysis.measures.segments.length - 1)];
    const d = slot.design; const g = part?.geometry;
    return {
      seconds: slot.seconds, role: i === 0 ? 'hook' : i === slots.length - 1 ? 'closing' : 'scene', transition: slot.transition,
      headline: d?.headline ? { position: HEAD_POS[d.headline.position], size: d.headline.size, align: d.headline.align } : null,
      product: d?.product ? { placement: d.product.placement, size: d.product.size } : g ? { placement: g.subject.y > 0.55 ? 'low_center' : g.subject.y < 0.4 ? 'high_center' : 'center', size: g.subject.spread > 0.3 ? 'large' : g.subject.spread > 0.2 ? 'medium' : 'small' } : null,
      camera: camera(d, g?.zoom, g?.drift), objectMotion: scrub(d?.product?.objectMotion ?? '', avoid), textTiming: scrub(d?.product?.textTiming ?? '', avoid),
    };
  });
  const transitions = [...new Set(slots.map((s) => s.transition))];
  return {
    format: measures.vertical ? '9:16' : measures.width === measures.height ? '1:1' : '16:9', totalSeconds, sceneCount: scenes.length, pacing: totalSeconds / Math.max(1, scenes.length) < 3 ? 'fast' : totalSeconds / Math.max(1, scenes.length) > 6 ? 'slow' : 'medium',
    visual: { horizon: analysis.measures.colourRoles?.separated ? analysis.measures.colourRoles.horizon : null, palette: paletteFrom(analysis), colours: analysis.measures.colourRoles ?? null, lighting: scrub(style.lighting ?? style.feel, avoid), background: scrub(style.background ?? '', avoid), typography: scrub(style.typography ?? '', avoid), negativeSpace: style.negativeSpace ?? 'medium', mood: scrub(style.feel, avoid), hierarchy: 'a large bold headline first, then the hero product, then a smaller supporting line' },
    motion: { scenes, transitions, overall: scrub(style.motion, avoid) }, avoid, forbidden: forbiddenFor(style.referenceText, allowed),
  };
}
