import type { PostSpec } from '../reference-image/style.js';
import type { ColourRoles } from '../reference/colour.js';
import { pairingForClass, type Pairing } from './tokens.js';
import { contrast, lum, mix, readable } from './draw-utils.js';
import type { Pattern, Palette, TypeTreatment } from './layouts.js';
import type { BrandKit } from '../standard-video/templates.js';

/**
 * STYLE TRANSFER for posts. A reference image is analysed once (reference-image/): its structure, type, colours, photo treatment and elements. `styleFromReference`
 * turns that into a PostStyle, which the post renderer (layouts.ts) follows: the layout structure, the page and text colours, the type pairing and case, how the
 * photo is shaped and framed, and which finishing elements (frame, soft shapes, grain, rule, pill label, handwritten note) are used. The reference's words, brand
 * and pictures never come with it: only how it is designed. The business's own logo, photos and words fill the structure.
 */
export type PostStyle = {
  /** the layout structure the reference uses (before content availability may change it) */ pattern: Pattern; align: 'left' | 'center'; caps: boolean; headlineScale: number; accentWord: boolean; eyebrow: boolean;
  /** the reference's page and text colours (null = the business's own colours) */ palette: Palette | null; paletteMode: 'reference' | 'brand'; pairing: Pairing; air: number;
  photo: PostSpec['photo']; elements: PostSpec['elements']; button: PostSpec['button']; background: PostSpec['background']; textPosition: PostSpec['textPosition']; scrim: PostSpec['scrim']; logo: 'top' | 'bottom'; tone: 'light' | 'dark';
  /** how the headline is set beyond its face (tracking, capitals, highlight, underline, shadow) */ type?: TypeTreatment;
  /** large decorative shapes the reference has in its background, and a badge if it has one */ shapes?: PostSpec['shapes']; badge?: PostSpec['badge'];
  /** how the reference was read, in plain words (shown to the owner) */ summary: string;
};

const PATTERN_FOR: Record<PostSpec['structure'], Pattern> = { centered_product: 'product_focus', text_top_photo_bottom: 'announcement', photo_full_bleed_overlay: 'overlay', split: 'split', grid: 'grid', quote: 'quote', offer: 'offer', banner: 'banner', benefits: 'benefits', type_only: 'announcement' };

/** The page and text colours of the reference, by role, made safe to read: words always clear on the page, one accent that stands out from it. */
export function paletteFromRoles(roles: ColourRoles, kit: BrandKit, mode: 'reference' | 'brand' = 'reference'): Palette | null {
  if (mode === 'brand') return null;
  const flat = roles.background; const top = mix(flat, '#FFFFFF', lum(flat) > 0.5 ? 0.04 : 0.07); const bottom = roles.separated ? mix(flat, roles.floor, 0.35) : mix(flat, '#000000', 0.05);
  const mid = mix(top, bottom, 0.5); const worst = (c: string) => Math.min(contrast(c, top), contrast(c, bottom));
  const text = worst(roles.text) >= 4.5 ? roles.text : worst('#FFFFFF') >= worst('#1B1B1F') ? '#FFFFFF' : '#1B1B1F';
  // the accent: the reference's own accent colour when it is a real colour that stands out from the page; else the business's accent; else the best of its other colours
  const sat = (h: string) => { const n = parseInt(h.slice(1), 16); const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255; const mx = Math.max(r, g, b); return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx; };
  const candidates = [roles.accent, roles.hero, kit.accent, kit.secondary, kit.primary].filter((c) => /^#[0-9a-f]{6}$/i.test(c));
  const accent = candidates.find((c) => sat(c) > 0.3 && contrast(c, mid) >= 3.2) ?? candidates.find((c) => contrast(c, mid) >= 3) ?? (lum(mid) > 0.5 ? '#1B1B1F' : '#FFFFFF');
  let muted = text; for (const t of [0.34, 0.26, 0.18, 0.1]) { const c = mix(text, mid, t); if (worst(c) >= 4.6) { muted = c; break; } }
  return { bgTop: top, bgBottom: bottom, text, muted, accent, onAccent: readable(accent), seamless: false };
}

/** Social-media standards applied on top of any reference: a few finishing details (not a pile of them), a headline that leaves the photo room, and generous space even if the reference is tight. */
const ELEMENT_PRIORITY: PostSpec['elements'] = ['rule', 'pill_label', 'keyline_frame', 'soft_shapes', 'handwritten_note', 'arrow', 'grain'];
export function cleanElements(elements: PostSpec['elements']): PostSpec['elements'] {
  const finishing = ELEMENT_PRIORITY.filter((e) => elements.includes(e)).slice(0, 3); const logo = elements.filter((e) => e === 'logo_top' || e === 'logo_bottom');
  return [...finishing.filter((e) => !(e === 'arrow' && !finishing.includes('handwritten_note'))), ...logo]; // an arrow only goes with a note
}

export function styleFromReference({ spec, roles, kit, mode = 'reference', tone }: { spec: PostSpec; roles: ColourRoles | null | undefined; kit: BrandKit; mode?: 'reference' | 'brand'; tone: 'light' | 'dark' }): PostStyle {
  const pairing = pairingForClass(spec.headlineFont); const pattern = PATTERN_FOR[spec.structure];
  const logo = spec.elements.includes('logo_top') && !spec.elements.includes('logo_bottom') ? 'top' : 'bottom';
  const palette = roles ? paletteFromRoles(roles, kit, mode) : null;
  const summary = `${spec.structure.replace(/_/g, ' ')}, ${spec.align}-aligned ${spec.headlineFont.replace(/_/g, ' ')} headline${spec.headlineCase === 'upper' ? ' in capitals' : ''}, ${spec.photo.shape === 'none' ? 'no photo' : `${spec.photo.shape}${spec.photo.bleed ? ' full-bleed' : ''} photo${spec.photo.frame !== 'none' ? ` with a ${spec.photo.frame} frame` : ''}`}, ${spec.spacing} spacing, ${tone} ${spec.background.replace('_', ' ')} background${spec.elements.length ? `, with ${spec.elements.filter((e) => !e.startsWith('logo')).map((e) => e.replace(/_/g, ' ')).join(', ')}` : ''}`;
  return { pattern, align: spec.align, caps: spec.headlineCase === 'upper', headlineScale: spec.headlineSize === 'xl' ? 1.08 : spec.headlineSize === 'm' ? 0.86 : 1, type: { ...(spec.tracking === 'wide' ? { tracking: 0.06 } : spec.tracking === 'tight' ? { tracking: -0.015 } : {}), ...(spec.headlineEffect === 'highlight' ? { highlight: true } : spec.headlineEffect === 'underline' ? { underline: true } : spec.headlineEffect === 'shadow' ? { shadow: true } : {}) }, shapes: spec.shapes.slice(0, 4), badge: spec.badge, accentWord: spec.accentWord, eyebrow: spec.eyebrow || spec.elements.includes('pill_label'), palette, paletteMode: palette ? 'reference' : 'brand', pairing, air: spec.spacing === 'airy' ? 1.2 : 1, photo: spec.photo, elements: cleanElements(spec.elements), button: spec.button, background: spec.background, textPosition: spec.textPosition, scrim: spec.scrim, logo, tone, summary };
}
