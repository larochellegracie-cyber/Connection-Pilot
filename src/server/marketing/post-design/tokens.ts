import * as nodeModule from 'node:module';
import path from 'node:path';
import { ensureFonts, FONT_FAMILY } from '../standard-video/fonts.js';
import { EXTRA_PAIRINGS, pairingIdForClass, registerLibrary, requestedFamily, requestedPairingId, type TypeClass } from './fonts.js';
export type { TypeClass } from './fonts.js';

/**
 * The design rules every designed picture post follows, so the result looks intentional and not randomly generated:
 *  - ONE grid: a margin of 8% of the width on every side, and everything aligns to it;
 *  - ONE type scale per post (eyebrow, headline, supporting line, small print), from the post's own size, never ad-hoc sizes;
 *  - TWO fonts at most: a display face for the headline and a plain face for everything else (a "pairing");
 *  - ONE accent colour (the brand's), used for at most the button, a rule and small marks; everything else is the background and its text colour;
 *  - words always readable (contrast at least 4.5 to 1 against what is under them) and never closer than the margin to an edge;
 *  - the product (a real photo) is the largest thing in the picture and has clear space round it.
 */
export const SIZES = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] } as const;
export type PostAspect = keyof typeof SIZES;

export const MARGIN = 0.08;
export type Scale = { eyebrow: number; headline: number; sub: number; small: number; cta: number; margin: number; gap: number; /** the spacing rhythm: inside a group of lines, between groups, between sections */ tight: number; group: number; section: number; /** the button: height and side padding */ btnH: number; btnPad: number; /** a call-out note */ note: number };
export function scaleFor(width: number, height: number, air = 1): Scale {
  const w = width; const tall = height / width;
  return { margin: Math.round(w * MARGIN * (air > 1 ? 1.1 : air < 1 ? 0.9 : 1)), eyebrow: Math.round(w * 0.027), headline: Math.round(w * (tall > 1.5 ? 0.108 : 0.098)), sub: Math.round(w * 0.038), small: Math.round(w * 0.027), cta: Math.round(w * 0.036), gap: Math.round(w * 0.026), tight: Math.round(w * 0.014), group: Math.round(w * 0.04 * air), section: Math.round(w * 0.066 * air), btnH: Math.round(w * 0.088), btnPad: Math.round(w * 0.052), note: Math.round(w * 0.03) };
}

/** A headline face and a body face that go together. `display` has one weight for the headline; the body is always Inter. */
export type Pairing = { id: string; label: string; display: string; displayWeight: number; body: string; feel: string[]; /** how wide the display face runs, to size lines */ width: number };
export const PAIRINGS: Pairing[] = [
  { id: 'friendly-script', label: 'Lobster with Inter', display: 'Lobster', displayWeight: 400, body: FONT_FAMILY, feel: ['bakery', 'cafe', 'dessert', 'sweet', 'playful', 'kids', 'party', 'cake', 'treat', 'friendly', 'fun'], width: 0.5 },
  { id: 'elegant-serif', label: 'Playfair Display with Inter', display: 'Playfair Display', displayWeight: 800, body: FONT_FAMILY, feel: ['luxury', 'wedding', 'spa', 'salon', 'jewel', 'boutique', 'florist', 'elegant', 'premium', 'restaurant', 'wine'], width: 0.54 },
  { id: 'editorial-serif', label: 'DM Serif Display with Inter', display: 'DM Serif Display', displayWeight: 400, body: FONT_FAMILY, feel: ['editorial', 'real estate', 'law', 'finance', 'consult', 'photograph', 'design', 'architect', 'interior'], width: 0.5 },
  { id: 'bold-condensed', label: 'Oswald with Inter', display: 'Oswald', displayWeight: 700, body: FONT_FAMILY, feel: ['fitness', 'gym', 'auto', 'garage', 'construction', 'roof', 'plumb', 'electric', 'landscap', 'pool', 'clean', 'repair', 'power wash', 'trade', 'sport', 'bold'], width: 0.42 },
  { id: 'clean-sans', label: 'Inter', display: FONT_FAMILY, displayWeight: 800, body: FONT_FAMILY, feel: ['tech', 'software', 'clinic', 'dental', 'medical', 'clean', 'modern', 'minimal'], width: 0.55 },
  { id: 'clean-medium', label: 'Inter (medium)', display: FONT_FAMILY, displayWeight: 700, body: FONT_FAMILY, feel: [], width: 0.55 },
  ...EXTRA_PAIRINGS,
];

/** The font pairing for a business: the owner's own named font if it is one Pilot carries, else the one that fits what the business is. */
export function pairingFor({ businessType = '', mood = '', brandFont = '', request = '' }: { businessType?: string; mood?: string; brandFont?: string; /** the owner's own words: a type style or a family by name wins over what the business is */ request?: string }): Pairing {
  const asked = `${brandFont} ${request}`.trim().toLowerCase();
  if (asked) {
    const family = requestedFamily(asked); if (family) { const own = PAIRINGS.find((p) => p.display === family); if (own) return own; const lib = PAIRINGS.find((p) => p.id === 'clean-sans')!; return { ...lib, id: `family-${family.toLowerCase().replace(/ /g, '-')}`, label: family, display: family, displayWeight: family === 'Montserrat' || family === 'Poppins' || family === 'DM Sans' ? 800 : 400 }; }
    const byStyle = requestedPairingId(asked); if (byStyle) { const hit = PAIRINGS.find((p) => p.id === byStyle); if (hit) return hit; }
    const hit = PAIRINGS.find((p) => asked.includes(p.display.toLowerCase()) || p.id === asked); if (hit) return hit;
  }
  const text = `${businessType} ${mood}`.toLowerCase();
  let best: { pairing: Pairing; score: number } = { pairing: PAIRINGS.find((p) => p.id === 'clean-sans')!, score: 0 };
  for (const pairing of PAIRINGS) { const score = pairing.feel.filter((word) => text.includes(word)).length; if (score > best.score) best = { pairing, score }; }
  return best.pairing;
}
/** The pairing for a reference image's type class. */
export function pairingForClass(c: TypeClass): Pairing { return PAIRINGS.find((p) => p.id === pairingIdForClass(c)) ?? PAIRINGS.find((p) => p.id === 'clean-sans')!; }

let registered = false;
/** Registers the display faces once (they are bundled with Pilot, so a post looks the same on any server). */
export async function ensureDesignFonts(): Promise<void> {
  await ensureFonts(); await registerLibrary(); if (registered) return;
  const { GlobalFonts } = await import('@napi-rs/canvas'); const require = nodeModule.createRequire(path.join(process.cwd(), 'package.json'));
  const files: Array<[string, string]> = [['lobster', 'lobster-latin-400-normal'], ['playfair-display', 'playfair-display-latin-800-normal'], ['dm-serif-display', 'dm-serif-display-latin-400-normal'], ['oswald', 'oswald-latin-700-normal']];
  const names: Record<string, string> = { lobster: 'Lobster', 'playfair-display': 'Playfair Display', 'dm-serif-display': 'DM Serif Display', oswald: 'Oswald' };
  for (const [pkg, file] of files) { try { GlobalFonts.registerFromPath(require.resolve(`@fontsource/${pkg}/files/${file}.woff`), names[pkg]); } catch { /* Inter is used instead */ } }
  registered = true;
}
/** Whether a font family is available to draw with (else Inter is used). */
export async function hasFont(family: string): Promise<boolean> { const { GlobalFonts } = await import('@napi-rs/canvas'); return GlobalFonts.has(family); }
