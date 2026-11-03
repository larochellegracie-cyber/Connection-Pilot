import type { ImageMeasures } from './analyze.js';
import { cleanReferenceText, type ReferenceText } from '../reference/protect.js';
import type { LogoPosition, LogoPrint } from '../reference/logo.js';
import { TYPE_CLASSES, type TypeClass } from '../post-design/fonts.js';

/**
 * The design of a reference image, in words and as a blueprint Pilot can draw from. A vision model looks at the picture once and is told to describe the
 * DESIGN only (never to quote its words, brand names, logos or people); plain code checks its answer, so every value is one Pilot can draw. Without a
 * vision model the blueprint comes from the measurements alone. The reference's own content is never part of it.
 */
export const aspects = ['1:1', '4:5', '3:4', '9:16', '16:9'] as const; export type Aspect = (typeof aspects)[number];
export type Blueprint = {
  aspect: Aspect; tone: 'dark' | 'light';
  background: { kind: 'solid' | 'gradient' | 'photo'; direction: 'vertical' | 'diagonal' | 'radial'; vignette: boolean };
  subject: { placement: 'center' | 'left' | 'right' | 'top' | 'bottom' | 'full_bleed'; scale: number; shape: 'rect' | 'rounded' | 'circle' | 'arch'; frame: 'none' | 'border' | 'card' | 'shadow' };
  headline: { position: 'top' | 'center' | 'bottom' | 'left'; align: 'left' | 'center' | 'right'; size: 'xxl' | 'xl' | 'l' | 'm' | 's'; weight: 400 | 700 | 800; caps: boolean; spacing: number };
  subline: boolean; cta: { style: 'pill' | 'bar' | 'text' | 'outline' | 'none'; position: 'bottom' | 'below_text' };
  accents: Array<'rule' | 'frame' | 'corner_marks' | 'glow' | 'dots' | 'band' | 'badge'>;
  logo: 'top_left' | 'top_center' | 'bottom_center' | 'none';
  /** how dark the shade over a full-frame photo is (0 to 0.85) */ overlay: number; /** space round the edge, as a fraction of the shorter side */ margin: number;
  /** whether the words are drawn at all (the owner can ask to remove the text) */ text: boolean;
  /** how much darker (below 0) or lighter (above 0) than the brand's own tone the picture is, -0.5 to 0.5 */ shift: number;
  mood: string[];
};
/** How the reference is built as a SOCIAL POST, in terms Pilot's post designer can rebuild for any business (structure, type, colour treatment, photo treatment, elements). Design only: never the reference's words or brand. */
export type PostSpec = {
  structure: 'centered_product' | 'text_top_photo_bottom' | 'photo_full_bleed_overlay' | 'split' | 'grid' | 'quote' | 'offer' | 'banner' | 'benefits' | 'type_only';
  align: 'left' | 'center'; headlineCase: 'sentence' | 'upper' | 'title'; headlineFont: TypeClass; tracking: 'tight' | 'normal' | 'wide'; headlineEffect: 'none' | 'highlight' | 'underline' | 'shadow'; headlineSize: 'xl' | 'l' | 'm'; accentWord: boolean; eyebrow: boolean;
  photo: { shape: 'rect' | 'rounded' | 'circle' | 'arch' | 'none' | 'cutout'; bleed: boolean; frame: 'none' | 'offset' | 'border' | 'shadow'; position: 'top' | 'center' | 'bottom' | 'left' | 'right' };
  elements: Array<'keyline_frame' | 'soft_shapes' | 'badge' | 'rule' | 'pill_label' | 'handwritten_note' | 'arrow' | 'grain' | 'corner_marks' | 'logo_top' | 'logo_bottom'>;
  /** large decorative shapes in the background (a corner circle, a ring, a wave along the bottom, dots, stripes, a blob) */ shapes: Array<{ kind: 'circle' | 'ring' | 'blob' | 'stripes' | 'dots' | 'wave' | 'rounded_rect' | 'arch' | 'burst'; anchor: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' | 'left' | 'right' | 'top' | 'bottom'; size: 's' | 'm' | 'l'; colour: 'accent' | 'dark' | 'light' | 'white' }>;
  /** a badge (a round or starburst label) and where */ badge: { shape: 'circle' | 'burst'; anchor: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' } | null;
  button: 'pill' | 'bar' | 'text' | 'none'; spacing: 'airy' | 'balanced' | 'tight'; background: 'flat' | 'gradient' | 'soft_shapes' | 'textured' | 'photo'; textPosition: 'top' | 'center' | 'bottom'; scrim: 'none' | 'bottom' | 'top' | 'left' | 'all';
};
export const POST_STRUCTURES = ['centered_product', 'text_top_photo_bottom', 'photo_full_bleed_overlay', 'split', 'grid', 'quote', 'offer', 'banner', 'benefits', 'type_only'] as const;
const POST_ELEMENTS = ['keyline_frame', 'soft_shapes', 'badge', 'rule', 'pill_label', 'handwritten_note', 'arrow', 'grain', 'corner_marks', 'logo_top', 'logo_bottom'] as const;
export type ImageStyleProfile = {
  /** the reference rebuilt as a post: structure, type, photo treatment, elements (see PostSpec) */ post?: PostSpec;
  aspectRatio: string; visualStyle: string; layout: string; composition: string; colorPalette: string[]; lighting: string; typography: string; textPlacement: string; subjectPlacement: string;
  graphicElements: string[]; mood: string; visualHierarchy: string; designBlueprint: string; recommendedLayouts: string[]; socialSuitability: string; photographyOrGraphic: 'photography' | 'graphic design' | 'mixed';
  blueprint: Blueprint; source: 'vision' | 'measured';
  /** what the picture is: a product advert (one hero product), an announcement/offer, a quote, a photo post */ kind?: 'product_ad' | 'announcement' | 'quote' | 'photo_post' | 'other';
  /** the hierarchy of the words (which is biggest, what follows), spacing and margins, shadows, in words: design only */ textHierarchy?: string; spacing?: string; shadows?: string; background?: string;
  /** short rules for a designer ("keep the headline in the top third", "one hero, lots of empty space"): the design, never the reference's content */ designRules?: string[];
  /** whether the reference shows a logo and where; the fingerprint is kept in the analysis so the new picture can be checked for it */ logo?: { present: boolean; position: LogoPosition };
  /** the reference's own text: kept ONLY to keep it out of anything made from it */ referenceText?: ReferenceText;
};
export type ReferenceImageAnalysis = { /** the reference logo's fingerprint (a tiny grey pattern, not the picture) */ logoPrint?: LogoPrint; id: string; fileName: string; createdAt: string; measures: ImageMeasures; style: ImageStyleProfile };

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/["“”`<>]/g, '').replace(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+/g, '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (value: unknown, count: number, max: number) => (Array.isArray(value) ? value : []).map((item) => clean(item, max)).filter(Boolean).filter((item, i, all) => all.indexOf(item) === i).slice(0, count);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (typeof value === 'string' && (options as readonly string[]).includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() as T : fallback);
const num = (value: unknown, lo: number, hi: number, fallback: number) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.min(hi, Math.max(lo, Number(value))) : fallback);

/** A blueprint with every field valid. Anything missing or unusable is taken from `base`. */
export function cleanBlueprint(raw: unknown, base: Blueprint): Blueprint {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const bg = (v.background ?? {}) as Record<string, any>; const sub = (v.subject ?? {}) as Record<string, any>; const head = (v.headline ?? {}) as Record<string, any>; const cta = (v.cta ?? {}) as Record<string, any>;
  const weight = Number(head.weight); const accents = (Array.isArray(v.accents) ? v.accents : base.accents).map((a: unknown) => oneOf(a, ['rule', 'frame', 'corner_marks', 'glow', 'dots', 'band', 'badge'] as const, 'rule')).filter((a: string, i: number, all: string[]) => all.indexOf(a) === i).slice(0, 4);
  return {
    aspect: oneOf(v.aspect, aspects, base.aspect), tone: v.tone === 'light' ? 'light' : v.tone === 'dark' ? 'dark' : base.tone,
    background: { kind: oneOf(bg.kind, ['solid', 'gradient', 'photo'] as const, base.background.kind), direction: oneOf(bg.direction, ['vertical', 'diagonal', 'radial'] as const, base.background.direction), vignette: typeof bg.vignette === 'boolean' ? bg.vignette : base.background.vignette },
    subject: { placement: oneOf(sub.placement, ['center', 'left', 'right', 'top', 'bottom', 'full_bleed'] as const, base.subject.placement), scale: num(sub.scale, 0.3, 1, base.subject.scale), shape: oneOf(sub.shape, ['rect', 'rounded', 'circle', 'arch'] as const, base.subject.shape), frame: oneOf(sub.frame, ['none', 'border', 'card', 'shadow'] as const, base.subject.frame) },
    headline: { position: oneOf(head.position, ['top', 'center', 'bottom', 'left'] as const, base.headline.position), align: oneOf(head.align, ['left', 'center', 'right'] as const, base.headline.align), size: oneOf(head.size, ['xxl', 'xl', 'l', 'm', 's'] as const, base.headline.size), weight: weight === 400 || weight === 700 || weight === 800 ? weight : base.headline.weight, caps: typeof head.caps === 'boolean' ? head.caps : base.headline.caps, spacing: num(head.spacing, 0, 0.3, base.headline.spacing) },
    subline: typeof v.subline === 'boolean' ? v.subline : base.subline, cta: { style: oneOf(cta.style, ['pill', 'bar', 'text', 'outline', 'none'] as const, base.cta.style), position: oneOf(cta.position, ['bottom', 'below_text'] as const, base.cta.position) },
    accents, logo: oneOf(v.logo, ['top_left', 'top_center', 'bottom_center', 'none'] as const, base.logo), overlay: num(v.overlay, 0, 0.85, base.overlay), margin: num(v.margin, 0.03, 0.16, base.margin), text: typeof v.text === 'boolean' ? v.text : base.text, shift: num(v.shift, -0.5, 0.5, base.shift),
    mood: list(v.mood, 4, 24).length ? list(v.mood, 4, 24) : base.mood,
  };
}

const nearestAspect = (label: string): Aspect => (['1:1', '4:5', '3:4', '9:16', '16:9'] as const).includes(label as Aspect) ? label as Aspect : label === '2:3' ? '3:4' : label === '5:4' || label === '4:3' ? '1:1' : label === '3:2' ? '16:9' : '4:5';

/** The blueprint as far as measuring alone can tell. */
export function measuredBlueprint(m: ImageMeasures): Blueprint {
  const dark = m.brightness < 0.45;
  const text = m.calmest === 'top' ? 'top' : m.calmest === 'bottom' ? 'bottom' : 'center';
  return {
    aspect: nearestAspect(m.aspectRatio), tone: dark ? 'dark' : 'light',
    background: { kind: m.backgroundKind, direction: 'vertical', vignette: dark && m.contrast > 0.2 },
    subject: { placement: m.placement, scale: m.placement === 'full_bleed' ? 1 : 0.62, shape: 'rounded', frame: 'shadow' },
    headline: { position: m.placement === 'full_bleed' ? 'bottom' : text, align: 'center', size: m.contrast > 0.28 ? 'l' : 'xl', weight: 800, caps: false, spacing: 0 },
    subline: true, cta: { style: 'pill', position: 'bottom' }, accents: m.saturation > 0.3 ? ['rule'] : [], logo: 'top_left', overlay: m.placement === 'full_bleed' ? 0.45 : 0, margin: 0.07, text: true, shift: 0,
    mood: [dark ? 'bold' : 'clean', m.saturation > 0.45 ? 'vibrant' : 'calm'],
  };
}

/** The post structure from the measurements alone (used with no vision model, and to fill anything the model left out). */
export function measuredPost(m: ImageMeasures, bp: Blueprint): PostSpec {
  const full = m.placement === 'full_bleed' || (m.photographic && m.backgroundKind === 'photo');
  return { structure: full ? 'photo_full_bleed_overlay' : m.placement === 'left' || m.placement === 'right' ? 'split' : m.placement === 'bottom' ? 'text_top_photo_bottom' : 'centered_product', align: bp.headline.align === 'left' ? 'left' : 'center', headlineCase: bp.headline.caps ? 'upper' : 'sentence', headlineFont: bp.headline.weight >= 800 ? 'sans_heavy' : 'sans_light', tracking: bp.headline.spacing > 0.08 ? 'wide' : 'normal', headlineEffect: 'none', shapes: [], badge: null, headlineSize: bp.headline.size === 'xxl' || bp.headline.size === 'xl' ? 'xl' : bp.headline.size === 'l' ? 'l' : 'm', accentWord: false, eyebrow: false,
    photo: { shape: full ? 'rect' : bp.subject.shape === 'circle' ? 'circle' : bp.subject.shape === 'arch' ? 'arch' : bp.subject.shape === 'rounded' ? 'rounded' : 'rect', bleed: full, frame: bp.subject.frame === 'card' ? 'shadow' : bp.subject.frame, position: m.placement === 'left' || m.placement === 'right' || m.placement === 'top' || m.placement === 'bottom' ? m.placement : 'center' },
    elements: [...(bp.accents.includes('frame') ? ['keyline_frame' as const] : []), ...(bp.accents.includes('rule') ? ['rule' as const] : []), ...(bp.accents.includes('glow') ? ['soft_shapes' as const] : [])], button: bp.cta.style === 'bar' ? 'bar' : bp.cta.style === 'text' ? 'text' : bp.cta.style === 'none' ? 'none' : 'pill', spacing: bp.margin >= 0.1 ? 'airy' : bp.margin <= 0.05 ? 'tight' : 'balanced', background: full ? 'photo' : bp.background.kind === 'gradient' ? 'gradient' : 'flat', textPosition: bp.headline.position === 'bottom' ? 'bottom' : bp.headline.position === 'center' ? 'center' : 'top', scrim: full ? (bp.headline.position === 'top' ? 'top' : bp.headline.position === 'left' ? 'left' : 'bottom') : 'none' };
}
/** A PostSpec with every value valid: what the model said where it is usable, the measured structure everywhere else. */
export function cleanPostSpec(raw: unknown, fallback: PostSpec): PostSpec {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>; const photo = (v.photo && typeof v.photo === 'object' ? v.photo : {}) as Record<string, any>;
  const pick = <T extends string>(value: unknown, options: readonly T[], base: T): T => (typeof value === 'string' && (options as readonly string[]).includes(value.trim().toLowerCase().replace(/[\s-]+/g, '_')) ? (value.trim().toLowerCase().replace(/[\s-]+/g, '_') as T) : base);
  const elements = (Array.isArray(v.elements) ? v.elements : []).map((e: unknown) => String(e).trim().toLowerCase().replace(/[\s-]+/g, '_')).filter((e: string): e is PostSpec['elements'][number] => (POST_ELEMENTS as readonly string[]).includes(e)).filter((e: string, i: number, all: string[]) => all.indexOf(e) === i).slice(0, 8);
  // where the photo and the words actually are decides the plain structures (a model names these more reliably by area than by label)
  const area = pick(v.photoArea ?? v.photo_area, ['full', 'left_half', 'right_half', 'top_half', 'bottom_half', 'inset_center', 'none'] as const, 'inset_center'); const hasArea = typeof (v.photoArea ?? v.photo_area) === 'string'; const named = pick(v.structure, POST_STRUCTURES, fallback.structure);
  const plain = ['centered_product', 'text_top_photo_bottom', 'photo_full_bleed_overlay', 'split', 'type_only'].includes(named); const derived: PostSpec['structure'] = area === 'full' ? 'photo_full_bleed_overlay' : area === 'left_half' || area === 'right_half' || area === 'top_half' ? 'split' : area === 'bottom_half' ? 'text_top_photo_bottom' : area === 'none' ? 'type_only' : 'centered_product';
  const structure = hasArea && plain ? derived : named; const photoPos = area === 'left_half' ? 'left' : area === 'right_half' ? 'right' : area === 'top_half' ? 'top' : area === 'bottom_half' ? 'bottom' : null;
  const headAlign = pick(v.headlineAlign ?? v.headline_align ?? v.align, ['left', 'center', 'right'] as const, fallback.align); const alignment: 'left' | 'center' = headAlign === 'left' ? 'left' : 'center';
  return {
    structure, align: alignment, headlineCase: pick(v.headlineCase ?? v.headline_case, ['sentence', 'upper', 'title'] as const, fallback.headlineCase),
    headlineFont: ((): TypeClass => { const raw = String(v.headlineFont ?? v.headline_font ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); const alias: Record<string, TypeClass> = { script: 'script_brush', serif: 'serif_high_contrast', sans_bold: 'sans_heavy', display_rounded: 'rounded', sans: 'sans_humanist', condensed: 'sans_condensed', handwriting: 'handwritten' }; const c = (alias[raw] ?? raw) as TypeClass; return (TYPE_CLASSES as readonly string[]).includes(c) ? c : fallback.headlineFont; })(),
    tracking: pick(v.tracking, ['tight', 'normal', 'wide'] as const, fallback.tracking), headlineEffect: pick(v.headlineEffect ?? v.headline_effect, ['none', 'highlight', 'underline', 'shadow'] as const, fallback.headlineEffect),
    shapes: (Array.isArray(v.shapes) ? v.shapes : []).slice(0, 5).map((sh: any) => ({ kind: pick(sh?.kind, ['circle', 'ring', 'blob', 'stripes', 'dots', 'wave', 'rounded_rect', 'arch', 'burst'] as const, 'circle'), anchor: pick(sh?.anchor, ['top_left', 'top_right', 'bottom_left', 'bottom_right', 'center', 'left', 'right', 'top', 'bottom'] as const, 'top_left'), size: pick(sh?.size, ['s', 'm', 'l'] as const, 'm'), colour: pick(sh?.colour ?? sh?.color, ['accent', 'dark', 'light', 'white'] as const, 'accent') })),
    badge: v.badge && typeof v.badge === 'object' ? { shape: pick(v.badge.shape, ['circle', 'burst'] as const, 'circle'), anchor: pick(v.badge.anchor, ['top_left', 'top_right', 'bottom_left', 'bottom_right'] as const, 'top_right') } : null, headlineSize: pick(v.headlineSize ?? v.headline_size, ['xl', 'l', 'm'] as const, fallback.headlineSize), accentWord: typeof v.accentWord === 'boolean' ? v.accentWord : typeof v.accent_word === 'boolean' ? v.accent_word : fallback.accentWord, eyebrow: typeof v.eyebrow === 'boolean' ? v.eyebrow : fallback.eyebrow,
    photo: { shape: structure === 'photo_full_bleed_overlay' || structure === 'split' ? 'rect' : pick(photo.shape, ['rect', 'rounded', 'circle', 'arch', 'none', 'cutout'] as const, fallback.photo.shape), bleed: structure === 'photo_full_bleed_overlay' || structure === 'split' ? true : typeof photo.bleed === 'boolean' ? photo.bleed : fallback.photo.bleed, frame: pick(photo.frame, ['none', 'offset', 'border', 'shadow'] as const, fallback.photo.frame), position: photoPos ?? pick(photo.position, ['top', 'center', 'bottom', 'left', 'right'] as const, fallback.photo.position) },
    elements: elements.length || Array.isArray(v.elements) ? elements : fallback.elements, button: pick(v.button, ['pill', 'bar', 'text', 'none'] as const, fallback.button), spacing: pick(v.spacing, ['airy', 'balanced', 'tight'] as const, fallback.spacing), background: pick(v.background, ['flat', 'gradient', 'soft_shapes', 'textured', 'photo'] as const, fallback.background), textPosition: ['top', 'bottom', 'center'].includes(String(v.textArea ?? v.text_area)) ? (String(v.textArea ?? v.text_area) as 'top' | 'bottom' | 'center') : pick(v.textPosition ?? v.text_position, ['top', 'center', 'bottom'] as const, fallback.textPosition), scrim: pick(v.scrim, ['none', 'bottom', 'top', 'left', 'all'] as const, fallback.scrim),
  };
}

export function measuredProfile(m: ImageMeasures): ImageStyleProfile {
  const blueprint = measuredBlueprint(m);
  return {
    aspectRatio: m.aspectRatio, visualStyle: `${m.photographic ? 'photographic' : 'graphic'}, ${blueprint.tone} and ${m.saturation > 0.4 ? 'colourful' : 'muted'}`, layout: `${m.placement.replace('_', ' ')} subject, text in the ${m.calmest} area`, composition: `${m.orientation} picture, main detail ${m.placement.replace('_', ' ')}`,
    colorPalette: m.palette.map((p) => p.hex), lighting: m.brightness < 0.35 ? 'low-key, dark' : m.brightness > 0.65 ? 'bright and even' : 'balanced', typography: 'bold sans-serif headline', textPlacement: `${blueprint.headline.position}, ${blueprint.headline.align}`, subjectPlacement: m.placement.replace('_', ' '),
    graphicElements: blueprint.accents, mood: blueprint.mood.join(', '), visualHierarchy: 'headline first, then the picture, then the call to action', designBlueprint: `${blueprint.tone} ${blueprint.background.kind} background, ${m.placement.replace('_', ' ')} subject, ${blueprint.headline.position} headline`,
    recommendedLayouts: [`${blueprint.headline.position} headline with ${m.placement.replace('_', ' ')} picture`], socialSuitability: m.aspectRatio === '1:1' || m.aspectRatio === '4:5' ? 'suits Instagram and Facebook posts' : m.aspectRatio === '9:16' ? 'suits stories and reels' : 'suits link and cover images',
    photographyOrGraphic: m.photographic ? 'photography' : 'graphic design', blueprint, source: 'measured', post: measuredPost(m, blueprint),
  };
}

const SYSTEM = `You study a reference image's DESIGN so a different business can make its own new picture in the same visual style. You are never copying it.
Describe only how it is designed, never what it says or shows. Do not quote any words, names, brands, logos, prices or numbers in the design fields, and do not name or describe any real person. The ONE exception is the reference_text field, which lists the text only so it can be kept out.
Reply with ONLY JSON:
{"visualStyle": "up to 14 words", "layout": "up to 16 words", "composition": "up to 16 words", "lighting": "up to 12 words", "typography": "up to 14 words (serif/sans/script/display, weight, case, spacing)", "textPlacement": "up to 14 words", "subjectPlacement": "up to 12 words",
 "graphicElements": ["up to 5 short names, e.g. thin gold rule, rounded card, soft shadow"], "mood": "up to 8 words (premium, playful, minimal, bold, luxury, casual...)", "visualHierarchy": "up to 16 words", "designBlueprint": "one sentence, up to 30 words, that tells a designer how to build it for any business", "recommendedLayouts": ["up to 3 short layout ideas that use the same design"], "socialSuitability": "up to 14 words", "photographyOrGraphic": "photography" | "graphic design" | "mixed",
 "kind": "product_ad" (one hero product on a styled background) | "announcement" (an offer, news or event) | "quote" | "photo_post" | "other", "textHierarchy": "up to 16 words: which words are biggest and what follows", "spacing": "up to 14 words on margins, gaps and empty space", "shadows": "up to 12 words", "background": "up to 14 words", "designRules": ["up to 5 short rules a designer would follow to build the same design for any business"],
 "logo": {"present": true|false (a brand logo, sign or wordmark is visible), "position": "top_left"|"top_center"|"top_right"|"bottom_left"|"bottom_center"|"bottom_right"|"center"},
 "reference_text": {"brand_names": ["every business, brand or product name visible, including logo wording"], "words": ["other distinctive single words visible"], "phrases": [{"text": "each headline or line of text visible, written out exactly", "kind": "slogan" (a tagline, catchphrase, or any line naming the brand, a place, a number or a contact) | "descriptive" (ordinary wording about the product)}]} (this lists the reference's own text ONLY so Pilot can keep it OUT of anything made from it; list everything you can read),
 "post": {"photoArea": "full" (a photo fills the whole frame) | "left_half" | "right_half" | "top_half" | "bottom_half" | "inset_center" (a photo or product sits in the middle with background colour around it) | "none", "textArea": "over_photo" | "left_column" | "right_column" | "top" | "bottom" | "center", "headlineAlign": "left" | "center" | "right" (look at where each line of the headline starts: lines that start at the same left edge are left-aligned; lines centred on the picture are centre-aligned. Be exact),
   "structure": "centered_product" (one product/subject centred under or over a headline) | "text_top_photo_bottom" (words at the top, a photo block below) | "photo_full_bleed_overlay" (a photo fills the frame with words over it) | "split" (photo on one half, words on the other) | "grid" (several photos in a grid) | "quote" | "offer" (a big price or offer) | "banner" (event or seasonal banner) | "benefits" (a short list of points with icons) | "type_only" (words and shapes, no photo),
   "align": "left"|"center", "headlineCase": "sentence"|"upper"|"title", "headlineFont": "script_brush" (bold brush or retro script) | "script_formal" (thin formal calligraphy) | "script_casual" (loose casual script) | "handwritten" (pen handwriting) | "marker" (felt-tip marker) | "serif_high_contrast" (thick-and-thin classic serif) | "serif_classic" | "serif_fat" (very heavy display serif) | "serif_elegant_light" (light, refined serif) | "slab" (slab serif) | "sans_geometric" (circles and straight lines, like Futura or Montserrat) | "sans_humanist" | "sans_condensed" | "sans_condensed_caps" (tall narrow poster capitals) | "sans_heavy" (heavy grotesque) | "sans_light" | "display_retro" (rounded retro display) | "rounded" (soft rounded letters) | "typewriter" | "techno",
   "tracking": "tight"|"normal"|"wide" (the space between the letters), "headlineEffect": "none"|"highlight" (a marker block behind a word) | "underline" (a line under a word) | "shadow",
   "shapes": [up to 4 large decorative background shapes, each {"kind": "circle"|"ring"|"blob"|"stripes"|"dots"|"wave"|"rounded_rect"|"arch"|"burst", "anchor": "top_left"|"top_right"|"bottom_left"|"bottom_right"|"center"|"left"|"right"|"top"|"bottom", "size": "s"|"m"|"l", "colour": "accent"|"dark"|"light"|"white"}], "badge": null or {"shape": "circle"|"burst", "anchor": "top_left"|"top_right"|"bottom_left"|"bottom_right"}, "headlineSize": "xl"|"l"|"m", "accentWord": true|false (one word of the headline is in a second colour), "eyebrow": true|false (a small label near the headline),
   "photo": {"shape": "rect"|"rounded"|"circle"|"arch"|"none"|"cutout", "bleed": true|false (touches the edges), "frame": "none"|"offset" (an outline offset behind it)|"border"|"shadow", "position": "top"|"center"|"bottom"|"left"|"right"},
   "elements": [any of "keyline_frame" (a thin frame inside the edge), "soft_shapes" (large soft round shapes in the background), "badge", "rule" (a short rule), "pill_label" (a small rounded label), "handwritten_note", "arrow" (a hand-drawn arrow), "grain" (paper texture), "corner_marks", "logo_top", "logo_bottom"],
   "button": "pill"|"bar"|"text"|"none", "spacing": "airy" (lots of empty space) | "balanced" | "tight", "background": "flat"|"gradient"|"soft_shapes"|"textured"|"photo", "textPosition": "top"|"center"|"bottom", "scrim": "none"|"bottom"|"top"|"left"|"all" (a dark or light shade under words that sit on a photo)},
 "blueprint": {"tone": "dark"|"light", "background": {"kind": "solid"|"gradient"|"photo", "direction": "vertical"|"diagonal"|"radial", "vignette": true|false}, "subject": {"placement": "center"|"left"|"right"|"top"|"bottom"|"full_bleed", "scale": 0.3 to 1 (share of the width), "shape": "rect"|"rounded"|"circle"|"arch", "frame": "none"|"border"|"card"|"shadow"},
  "headline": {"position": "top"|"center"|"bottom"|"left", "align": "left"|"center"|"right", "size": "xl"|"l"|"m"|"s", "weight": 400|700|800, "caps": true|false, "spacing": 0 to 0.3 (letter spacing in em)}, "subline": true|false, "cta": {"style": "pill"|"bar"|"text"|"outline"|"none", "position": "bottom"|"below_text"},
  "accents": ["rule"|"frame"|"corner_marks"|"glow"|"dots"|"band"|"badge", up to 4], "logo": "top_left"|"top_center"|"bottom_center"|"none", "overlay": 0 to 0.85 (shade over a full-frame photo), "margin": 0.03 to 0.16, "mood": ["up to 4 single words"]}}`;

export type ImageModel = (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }>;

export function sanitizeProfile(raw: unknown, m: ImageMeasures): ImageStyleProfile {
  const base = measuredProfile(m); const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const blueprint = cleanBlueprint({ ...(v.blueprint ?? {}), aspect: nearestAspect(m.aspectRatio) }, base.blueprint);
  const kind = oneOf(v.photographyOrGraphic, ['photography', 'graphic design', 'mixed'] as const, base.photographyOrGraphic);
  const f = (key: string, max: number, fallback: string) => clean(v[key], max) || fallback;
  return {
    aspectRatio: m.aspectRatio, visualStyle: f('visualStyle', 120, base.visualStyle), layout: f('layout', 140, base.layout), composition: f('composition', 140, base.composition), colorPalette: m.palette.map((p) => p.hex), lighting: f('lighting', 100, base.lighting), typography: f('typography', 120, base.typography),
    textPlacement: f('textPlacement', 120, base.textPlacement), subjectPlacement: f('subjectPlacement', 100, base.subjectPlacement), graphicElements: list(v.graphicElements, 5, 40).length ? list(v.graphicElements, 5, 40) : base.graphicElements, mood: f('mood', 70, base.mood), visualHierarchy: f('visualHierarchy', 140, base.visualHierarchy),
    designBlueprint: f('designBlueprint', 260, base.designBlueprint), recommendedLayouts: list(v.recommendedLayouts, 3, 100).length ? list(v.recommendedLayouts, 3, 100) : base.recommendedLayouts, socialSuitability: f('socialSuitability', 120, base.socialSuitability), photographyOrGraphic: kind, blueprint, source: 'vision',
    kind: oneOf(v.kind, ['product_ad', 'announcement', 'quote', 'photo_post', 'other'] as const, 'other'), textHierarchy: f('textHierarchy', 140, base.visualHierarchy), spacing: clean(v.spacing, 120), shadows: clean(v.shadows, 100), background: clean(v.background, 120), designRules: list(v.designRules, 5, 120),
    logo: v.logo && typeof v.logo === 'object' ? { present: v.logo.present === true, position: oneOf(v.logo.position, ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right', 'center'] as const, 'top_left') } : { present: false, position: 'top_left' },
    referenceText: cleanReferenceText(v.reference_text), post: cleanPostSpec(v.post, measuredPost(m, blueprint)),
  };
}

export async function describeDesign(measures: ImageMeasures, picture: Buffer, model?: ImageModel): Promise<ImageStyleProfile> {
  if (!model) return measuredProfile(measures);
  const prompt = `The picture is ${measures.width} by ${measures.height} (${measures.aspectRatio}), ${measures.orientation}. Measured: brightness ${measures.brightness}, contrast ${measures.contrast}, ${measures.photographic ? 'looks photographic' : 'looks like a drawn graphic'}, main detail ${measures.placement.replace('_', ' ')}, calmest area ${measures.calmest}. Describe its design.`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const reply = await model(SYSTEM, prompt, [picture]); return sanitizeProfile(JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? ''), measures); } catch { /* once more */ }
  }
  return measuredProfile(measures);
}

/** A short plain-words summary of what Pilot learned, shown to the owner. */
export function summariseDesign(analysis: Pick<ReferenceImageAnalysis, 'style' | 'measures'>): string {
  const { style, measures } = analysis;
  return `${measures.aspectRatio} ${style.photographyOrGraphic}, ${style.mood}. ${style.layout}. Type: ${style.typography}. Colours: ${style.blueprint.tone} background. I’ll use this design for your business: your own words, photos, logo and colours.`;
}
