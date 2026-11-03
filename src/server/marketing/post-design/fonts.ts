import * as nodeModule from 'node:module';
import path from 'node:path';
import { FONT_FAMILY } from '../standard-video/fonts.js';
import type { Pairing } from './tokens.js';

/**
 * The type library: many families, in every common voice (clean sans, geometric, humanist, condensed poster type, elegant and classic serifs, slab, brush and formal scripts,
 * handwriting, marker, typewriter, rounded, retro display), all bundled with Pilot so a post looks the same on any server. A post picks a HEADLINE face and a BODY face (a pairing):
 * from what the business is, from the owner's words ("make it retro", "handwritten", "use Montserrat"), or from the type of a reference image.
 */
export type TypeClass = 'script_brush' | 'script_formal' | 'script_casual' | 'handwritten' | 'marker' | 'serif_high_contrast' | 'serif_classic' | 'serif_fat' | 'serif_elegant_light' | 'slab' | 'sans_geometric' | 'sans_humanist' | 'sans_condensed' | 'sans_condensed_caps' | 'sans_heavy' | 'sans_light' | 'display_retro' | 'rounded' | 'typewriter' | 'techno';
export const TYPE_CLASSES: readonly TypeClass[] = ['script_brush', 'script_formal', 'script_casual', 'handwritten', 'marker', 'serif_high_contrast', 'serif_classic', 'serif_fat', 'serif_elegant_light', 'slab', 'sans_geometric', 'sans_humanist', 'sans_condensed', 'sans_condensed_caps', 'sans_heavy', 'sans_light', 'display_retro', 'rounded', 'typewriter', 'techno'];

export type LibraryFont = { family: string; pkg: string; weights: number[] };
export const FONT_LIBRARY: LibraryFont[] = [
  { family: 'Lobster', pkg: 'lobster', weights: [400] }, { family: 'Playfair Display', pkg: 'playfair-display', weights: [700, 800] }, { family: 'DM Serif Display', pkg: 'dm-serif-display', weights: [400] }, { family: 'Oswald', pkg: 'oswald', weights: [500, 700] },
  { family: 'Bebas Neue', pkg: 'bebas-neue', weights: [400] }, { family: 'Anton', pkg: 'anton', weights: [400] }, { family: 'Abril Fatface', pkg: 'abril-fatface', weights: [400] }, { family: 'Alfa Slab One', pkg: 'alfa-slab-one', weights: [400] },
  { family: 'Pacifico', pkg: 'pacifico', weights: [400] }, { family: 'Dancing Script', pkg: 'dancing-script', weights: [700] }, { family: 'Caveat', pkg: 'caveat', weights: [700] }, { family: 'Permanent Marker', pkg: 'permanent-marker', weights: [400] },
  { family: 'Special Elite', pkg: 'special-elite', weights: [400] }, { family: 'Fredoka', pkg: 'fredoka', weights: [400, 700] }, { family: 'Cormorant Garamond', pkg: 'cormorant-garamond', weights: [700] }, { family: 'Lora', pkg: 'lora', weights: [400, 700] },
  { family: 'Montserrat', pkg: 'montserrat', weights: [400, 700, 800] }, { family: 'Poppins', pkg: 'poppins', weights: [400, 700, 800] }, { family: 'DM Sans', pkg: 'dm-sans', weights: [400, 700, 800] }, { family: 'Space Grotesk', pkg: 'space-grotesk', weights: [400, 700] }, { family: 'Righteous', pkg: 'righteous', weights: [400] },
];

let registered = false;
/** Registers the whole library once. A family that cannot be found is skipped (Inter is used in its place). */
export async function registerLibrary(): Promise<void> {
  if (registered) return; const { GlobalFonts } = await import('@napi-rs/canvas'); const require = nodeModule.createRequire(path.join(process.cwd(), 'package.json'));
  for (const f of FONT_LIBRARY) for (const w of f.weights) { try { GlobalFonts.registerFromPath(require.resolve(`@fontsource/${f.pkg}/files/${f.pkg}-latin-${w}-normal.woff`), f.family); } catch { /* skipped */ } }
  registered = true;
}

const P = (id: string, label: string, display: string, displayWeight: number, body: string, feel: string[], width = 0.5): Pairing => ({ id, label, display, displayWeight, body, feel, width });
/** Pairings beyond the first few in tokens.ts: each a headline face with a body face that suits it. */
export const EXTRA_PAIRINGS: Pairing[] = [
  P('retro-slab', 'Alfa Slab One with Montserrat', 'Alfa Slab One', 400, 'Montserrat', ['retro', 'vintage', 'diner', 'burger', 'barbecue', 'bbq', 'brewery', 'barber', 'classic', 'heritage'], 0.6),
  P('poster-condensed', 'Bebas Neue with Inter', 'Bebas Neue', 400, FONT_FAMILY, ['poster', 'event', 'festival', 'sports', 'concert', 'tournament', 'sale', 'grand opening', 'announcement'], 0.38),
  P('heavy-condensed', 'Anton with DM Sans', 'Anton', 400, 'DM Sans', ['impact', 'heavy', 'strong', 'bold statement', 'moving', 'towing', 'demolition'], 0.4),
  P('editorial-fat', 'Abril Fatface with Lora', 'Abril Fatface', 400, 'Lora', ['magazine', 'fashion', 'editorial', 'boutique', 'bridal', 'fancy', 'glamour'], 0.55),
  P('luxe-light', 'Cormorant Garamond with Montserrat', 'Cormorant Garamond', 700, 'Montserrat', ['luxe', 'refined', 'jewellery', 'jewelry', 'spa retreat', 'fine dining', 'upscale', 'sophisticated'], 0.46),
  P('handwritten', 'Caveat with Poppins', 'Caveat', 700, 'Poppins', ['handwritten', 'handmade', 'farm', 'craft', 'organic', 'homemade', 'market', 'journal', 'personal'], 0.42),
  P('brush-marker', 'Permanent Marker with DM Sans', 'Permanent Marker', 400, 'DM Sans', ['marker', 'street', 'graffiti', 'urban', 'skate', 'fun fact', 'loud'], 0.55),
  P('casual-script', 'Pacifico with Poppins', 'Pacifico', 400, 'Poppins', ['beach', 'surf', 'summer', 'ice cream', 'smoothie', 'tropical', 'poolside', 'vacation', 'casual script'], 0.6),
  P('elegant-script', 'Dancing Script with Lora', 'Dancing Script', 700, 'Lora', ['florist', 'flowers', 'wedding script', 'invitation', 'romantic', 'calligraphy'], 0.45),
  P('typewriter', 'Special Elite with Lora', 'Special Elite', 400, 'Lora', ['typewriter', 'bookshop', 'letter', 'journalist', 'old school', 'newsletter', 'vintage paper'], 0.55),
  P('tech-grotesk', 'Space Grotesk with Inter', 'Space Grotesk', 700, FONT_FAMILY, ['startup', 'saas', 'app', 'digital', 'futuristic', 'coding', 'ai assistant'], 0.55),
  P('rounded-friendly', 'Fredoka with Poppins', 'Fredoka', 700, 'Poppins', ['kids', 'children', 'daycare', 'pet', 'puppy', 'toy', 'playful', 'preschool', 'fun'], 0.55),
  P('geometric-bold', 'Montserrat with Montserrat', 'Montserrat', 800, 'Montserrat', ['geometric', 'bold modern', 'brand new', 'startup energy'], 0.62),
  P('poppins-clean', 'Poppins with Poppins', 'Poppins', 700, 'Poppins', ['friendly modern', 'approachable', 'service', 'home service'], 0.6),
  P('retro-display', 'Righteous with DM Sans', 'Righteous', 400, 'DM Sans', ['70s', '60s', 'retro display', 'music', 'arcade', 'groovy', 'disco'], 0.55),
];

/** The headline face for a type class (from a reference image's type), with the body face that suits it. */
const CLASS_PAIRING: Record<TypeClass, string> = { script_brush: 'friendly-script', script_formal: 'elegant-script', script_casual: 'casual-script', handwritten: 'handwritten', marker: 'brush-marker', serif_high_contrast: 'elegant-serif', serif_classic: 'editorial-serif', serif_fat: 'editorial-fat', serif_elegant_light: 'luxe-light', slab: 'retro-slab', sans_geometric: 'geometric-bold', sans_humanist: 'poppins-clean', sans_condensed: 'bold-condensed', sans_condensed_caps: 'poster-condensed', sans_heavy: 'clean-sans', sans_light: 'clean-medium', display_retro: 'retro-display', rounded: 'rounded-friendly', typewriter: 'typewriter', techno: 'tech-grotesk' };
export const pairingIdForClass = (c: TypeClass) => CLASS_PAIRING[c];

/** What the owner asked for in words about the type: a style ("make it retro", "handwritten") or a family by name ("use Montserrat"). Null when they said nothing about type. */
const REQUEST_RULES: Array<[RegExp, string]> = [
  [/\b(?:typewriter|old[- ]school paper)\b/i, 'typewriter'], [/\b(?:retro|vintage|diner|70s|seventies)\b/i, 'retro-slab'], [/\b(?:hand[- ]?written|handwriting|hand[- ]?lettered)\b/i, 'handwritten'], [/\b(?:marker|graffiti|street style)\b/i, 'brush-marker'],
  [/\b(?:calligraphy|formal script|wedding script|romantic)\b/i, 'elegant-script'], [/\b(?:script|brush|cursive)\b/i, 'friendly-script'], [/\b(?:luxur\w+|refined|upscale|sophisticated|high[- ]end)\b/i, 'luxe-light'], [/\b(?:elegant|classic serif|serif)\b/i, 'elegant-serif'],
  [/\b(?:magazine|fashion|editorial|glam\w*)\b/i, 'editorial-fat'], [/\b(?:poster|big and bold|loud|event style|festival)\b/i, 'poster-condensed'], [/\b(?:impact|heavy|chunky)\b/i, 'heavy-condensed'], [/\b(?:tech|futuristic|startup)\b/i, 'tech-grotesk'],
  [/\b(?:playful|kids|childlike|cute)\b/i, 'rounded-friendly'], [/\b(?:beachy|summery|tropical)\b/i, 'casual-script'], [/\b(?:geometric|modern bold)\b/i, 'geometric-bold'], [/\b(?:friendly modern|approachable)\b/i, 'poppins-clean'],
];
export function requestedFamily(text: string): string | null { const t = text.toLowerCase(); const hit = FONT_LIBRARY.find((f) => new RegExp(`\\b${f.family.toLowerCase().replace(/ /g, '\\s+')}\\b`).test(t)); return hit ? hit.family : null; }
export function requestedPairingId(text: string): string | null { for (const [re, id] of REQUEST_RULES) if (re.test(text)) return id; return null; }
export const bodyOptions = (): string[] => [FONT_FAMILY, 'DM Sans', 'Lora', 'Montserrat', 'Poppins'];
