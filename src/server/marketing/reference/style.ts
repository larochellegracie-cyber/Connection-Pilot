import type { Geometry, ReferenceMeasures, Segment } from './analyze.js';
import { buildDesignBlueprint, type DesignBlueprint } from './design.js';
import { buildStyledSpec, MONTAGE_VARIETY, shotVariety, type StyledSpec } from './styled.js';
import { cleanReferenceText, type ReferenceText } from './protect.js';
import type { LogoPosition, LogoPrint } from './logo.js';
import { TYPE_CLASSES, type TypeClass } from '../post-design/fonts.js';

/**
 * The style of a reference video, in words Pilot can build from: the look (light or dark), how its text moves, how its scenes are laid out, how it
 * changes between scenes and how fast it goes. A vision model looks at the key frames once (and is told to describe the DESIGN only, never to quote
 * the reference's words, brand names or numbers); plain code checks its answer and works out the blueprint (scene kinds, lengths and transitions)
 * from the measurements. Without a vision model the blueprint is worked out from the measurements alone.
 */
export const layouts = ['product_hero', 'hero_text_card', 'orbit', 'bubbles', 'character_intro', 'form_ui', 'schedule_ui', 'chat_ui', 'photo_full', 'checklist', 'statement', 'cta'] as const;
export type Layout = (typeof layouts)[number];
export const textTreatments = ['word_swap', 'kinetic_headline', 'typed', 'captions', 'static'] as const;
export type TextTreatment = (typeof textTreatments)[number];
export const cardKinds = ['bars', 'list', 'line', 'none'] as const;
export type CardKind = (typeof cardKinds)[number];
export const transitionKinds = ['cut', 'fade', 'slide', 'zoom', 'wipe'] as const;

/** How one scene is built, as the vision step describes it: the floating elements (how many, what shape), the headline's place and size, the character, and which way things turn. */
/** What a product-advert scene is built from: where the hero object sits and how big, how the camera and the object move, and when the words appear. */
export type ProductDesign = { placement: 'center' | 'low_center' | 'high_center' | 'left' | 'right'; size: 'small' | 'medium' | 'large'; camera: 'static' | 'push_in' | 'pull_out' | 'pan' | 'orbit' | 'rise'; objectMotion: string; textTiming: string };
export type SceneDesign = { product?: ProductDesign | null; elements: number; shape: 'disc' | 'chip' | 'card' | 'icon' | 'dot' | 'none'; headline: { position: 'top' | 'upper' | 'middle' | 'lower' | 'bottom'; align: 'left' | 'center' | 'right'; size: 's' | 'm' | 'l' | 'xl' } | null; character: { position: 'top' | 'center' | 'left' | 'right' | 'bottom'; size: 'small' | 'medium' | 'large' } | null; rotation: 'clockwise' | 'counter' | 'none' };

/** How a reference video is made as a MONTAGE (shots of pictures or footage with motion, overlays and words): the type of its text and how it comes in, the overlays on top of the picture, how the camera moves and how the shots join, and how the rhythm builds. Design only. */
export type VideoStyle = {
  text: { position: 'top' | 'upper' | 'middle' | 'lower' | 'bottom' | 'none'; align: 'left' | 'center' | 'right'; case: 'sentence' | 'upper' | 'title'; weight: 'light' | 'regular' | 'bold' | 'black'; size: 's' | 'm' | 'l' | 'xl'; effect: 'static' | 'fade' | 'slide' | 'kinetic' | 'typed' | 'pop' | 'captions'; box: 'none' | 'pill' | 'bar' | 'outline' | 'underline' | 'highlight'; font: TypeClass; colour: 'light' | 'dark' | 'accent' };
  overlays: Array<'lower_third' | 'progress_bar' | 'frame' | 'logo_bug' | 'scrim_bottom' | 'scrim_top' | 'light_leak' | 'letterbox' | 'vignette' | 'film_grain' | 'flash' | 'counter'>;
  camera: 'still' | 'slow_push' | 'ken_burns' | 'handheld' | 'whip_pans' | 'zoom_punches' | 'mixed'; cuts: 'hard_cuts' | 'dissolves' | 'whips' | 'wipes' | 'zoom_punches' | 'mixed'; rhythm: 'steady' | 'accelerating' | 'beat_cuts' | 'slow_build'; footage: 'photos' | 'live_footage' | 'graphics' | 'screen_recording' | 'mixed'; mood: string;
};
export type StyleProfile = {
  /** the montage style (text, overlays, camera, cuts, rhythm), for videos made of shots */ video?: VideoStyle;
  feel: string; theme: 'light' | 'dark'; textTreatment: TextTreatment; motion: string; transitions: Array<(typeof transitionKinds)[number]>;
  usesCharacter: boolean; usesPhotos: boolean; hasVoiceover: boolean | null;
  /** how its floating elements are arranged, how strong its glow is, and whether it has depth (elements at different distances) */ arrangement: 'orbit' | 'scattered' | 'grid' | 'stack' | 'none'; glow: 'none' | 'soft' | 'strong'; depth: 'flat' | 'layered';
  /** the colours it is mostly made of (background first), measured from its frames */ palette: string[];
  scenes: Array<{ layout: Layout; card: CardKind; notes: string; design?: SceneDesign }>;
  /** what kind of video it is: a product advert (a hero object on a lit set), an interface explainer, a photo story or moving text */ kind?: 'product_scene' | 'ui_explainer' | 'photo_story' | 'text_motion';
  /** the set and the type, in words (design only: never the reference's own words) */ lighting?: string; background?: string; typography?: string; negativeSpace?: 'low' | 'medium' | 'high';
  /** brand names and distinctive words visible in the reference, kept ONLY so they can be kept out of anything Pilot makes from it */ avoid?: string[];
  /** whether the reference shows a logo, and where (its fingerprint is kept in the analysis so the finished video can be checked for it) */ logo?: { present: boolean; position: LogoPosition };
  /** the reference's own text as a structured list (brand names, words, whole lines): NONE of it may appear in anything made from the reference unless the owner's own words use it. Checked by plain code (protect.ts), not by a prompt. */ referenceText?: ReferenceText;
  source: 'vision' | 'measured';
};

export type ReferenceAnalysis = { /** the fingerprint of the reference's logo (a tiny pattern, not the picture), so a finished video can be checked for it */ logoPrint?: LogoPrint; id: string; fileName: string; createdAt: string; measures: Omit<ReferenceMeasures, 'segments'> & { segments: Array<Omit<Segment, 'frame'>> }; style: StyleProfile; pacing: 'fast' | 'medium' | 'slow'; averageSceneSeconds: number };

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T => (typeof value === 'string' && (list as readonly string[]).includes(value.trim().toLowerCase()) ? value.trim().toLowerCase() as T : fallback);

export const pacingOf = (measures: Pick<ReferenceMeasures, 'seconds'> & { segments: unknown[] }): 'fast' | 'medium' | 'slow' => {
  const average = measures.seconds / Math.max(1, measures.segments.length);
  return average < 2.8 ? 'fast' : average > 6 ? 'slow' : 'medium';
};

const SYSTEM = `You study a reference video's DESIGN so a different business can make a new video in the same style. You are shown its key frames, in order, four to a sheet, with the length of each part.
Describe only how it is made, never what it says. Do not quote any words, names, brands, prices or numbers that appear in it.
Reply with ONLY JSON:
{"kind": "product_scene" (a product advert: a hero object on a lit set) | "ui_explainer" (interface mockups, forms, schedules, chats, floating labels) | "photo_story" | "text_motion", "lighting": "up to 14 words on the light", "background": "up to 14 words on the set and backdrop colours", "typography": "up to 14 words on the headline type: weight, case, size", "negative_space": "low" | "medium" | "high", "logo": {"present": true|false (a brand logo, sign or wordmark is visible), "position": "top_left"|"top_center"|"top_right"|"bottom_left"|"bottom_center"|"bottom_right"|"center"},
 "reference_text": {"brand_names": ["every business, brand or product name visible in the video, including any logo wording"], "words": ["other distinctive words visible, single words"], "phrases": [{"text": "each headline or line of text visible, written out exactly", "kind": "slogan" (a tagline, catchphrase, or any line that names the brand, a place, a number or a contact) | "descriptive" (ordinary wording about the product, such as a plain caption)}]} (this lists the reference's own text ONLY so Pilot can keep it OUT of anything made from it; list everything you can read),
 "video": {"text": {"position": "top"|"upper"|"middle"|"lower"|"bottom"|"none" (where the words sit), "align": "left"|"center"|"right", "case": "sentence"|"upper"|"title", "weight": "light"|"regular"|"bold"|"black", "size": "s"|"m"|"l"|"xl", "effect": "static"|"fade"|"slide" (slides in)|"kinetic" (words rise in one by one)|"typed"|"pop" (scales in)|"captions" (spoken-word captions, the current word highlighted), "box": "none"|"pill" (a rounded label behind)|"bar" (a band behind)|"outline"|"underline"|"highlight" (a marker block behind a word), "font": one of "script_brush","script_formal","script_casual","handwritten","marker","serif_high_contrast","serif_classic","serif_fat","serif_elegant_light","slab","sans_geometric","sans_humanist","sans_condensed","sans_condensed_caps","sans_heavy","sans_light","display_retro","rounded","typewriter","techno", "colour": "light"|"dark"|"accent"},
   "overlays": [any of "lower_third" (a name-and-title band), "progress_bar", "frame" (a border), "logo_bug" (a small logo in a corner), "scrim_bottom", "scrim_top", "light_leak", "letterbox" (black bars), "vignette", "film_grain", "flash" (white flashes on cuts), "counter"],
   "camera": "still"|"slow_push"|"ken_burns" (slow pans and zooms on stills)|"handheld"|"whip_pans"|"zoom_punches"|"mixed", "cuts": "hard_cuts"|"dissolves"|"whips"|"wipes"|"zoom_punches"|"mixed", "rhythm": "steady"|"accelerating"|"beat_cuts" (cuts on a beat)|"slow_build", "footage": "photos"|"live_footage"|"graphics"|"screen_recording"|"mixed", "mood": "up to 8 words on the mood"},
 "feel": "up to 12 words on the overall feel", "theme": "light" | "dark", "text_treatment": "word_swap" (a headline whose key word keeps changing) | "kinetic_headline" (big words animate in) | "typed" (text types on) | "captions" (spoken-word captions) | "static",
 "motion": "up to 14 words on how things move", "transitions": ["cut" | "fade" | "slide" | "zoom" | "wipe", ...],
 "arrangement": "orbit" (elements circle round a centre) | "scattered" | "grid" | "stack" | "none", "glow": "none" | "soft" | "strong" (light blooming behind things), "depth": "flat" | "layered" (elements at different distances, a 3D feel),
 "uses_character": true | false (a mascot or character), "uses_photos": true | false (photos or footage fill the frame), "has_voiceover": true | false | null (null if you cannot tell),
 "scenes": [one per frame, in order: {"layout": "product_hero" (ONE hero product or object, large and lit on a styled set, with a bold headline and little else) | "hero_text_card" (a headline with a clean interface card or chart beneath) | "orbit" (labels, icons or discs arranged in a circle round a central character or logo) | "bubbles" (floating labels or chips) | "character_intro" (a character or logo with a title) | "form_ui" (a form being filled in) | "schedule_ui" (a calendar or schedule) | "chat_ui" (a chat conversation) | "photo_full" (a full-frame photo or footage with text) | "checklist" (a short list of points) | "statement" (a plain big statement on a colour) | "cta" (the closing call to action), "card": "bars" | "list" | "line" | "none" (what the interface card shows, if any), "notes": "up to 12 words on its look", "product": {"placement": "center"|"low_center"|"high_center"|"left"|"right", "size": "small"|"medium"|"large", "camera": "static"|"push_in"|"pull_out"|"pan"|"orbit"|"rise", "object_motion": "up to 12 words on HOW the hero moves, in general terms that name no object, brand or scene content (for example: builds up in stages from below with a soft bounce; turns slowly; drifts in and settles)", "text_timing": "up to 12 words on when the words appear"} or null when there is no hero object, "elements": how many separate floating elements (discs, chips, icons) are on screen at once, "element_shape": "disc" | "chip" | "card" | "icon" (a symbol with no or little text) | "dot" | "none", "headline": {"position": "top"|"upper"|"middle"|"lower"|"bottom" (where its main words sit, top of the frame to bottom), "align": "left"|"center"|"right", "size": "s"|"m"|"l"|"xl"} or null if no words, "character": {"present": true|false, "position": "top"|"center"|"left"|"right"|"bottom", "size": "small"|"medium"|"large"} or null, "rotation": "clockwise"|"counter"|"none" (which way circling elements turn)}]}`;

const cleanDesign = (scene: any): SceneDesign | undefined => {
  if (!scene || typeof scene !== 'object') return undefined;
  const head = scene.headline && typeof scene.headline === 'object' ? scene.headline : null; const char = scene.character && typeof scene.character === 'object' && scene.character.present !== false ? scene.character : null;
  const n = Math.round(Number(scene.elements));
  return {
    elements: Number.isFinite(n) ? Math.max(0, Math.min(14, n)) : 0, shape: oneOf(scene.element_shape, ['disc', 'chip', 'card', 'icon', 'dot', 'none'] as const, 'none'),
    headline: head ? { position: oneOf(head.position, ['top', 'upper', 'middle', 'lower', 'bottom'] as const, 'lower'), align: oneOf(head.align, ['left', 'center', 'right'] as const, 'center'), size: oneOf(head.size, ['s', 'm', 'l', 'xl'] as const, 'l') } : null,
    character: char && typeof char.position === 'string' ? { position: oneOf(char.position, ['top', 'center', 'left', 'right', 'bottom'] as const, 'center'), size: oneOf(char.size, ['small', 'medium', 'large'] as const, 'medium') } : null,
    rotation: oneOf(scene.rotation, ['clockwise', 'counter', 'none'] as const, 'clockwise'),
    product: scene.product && typeof scene.product === 'object' ? { placement: oneOf(scene.product.placement, ['center', 'low_center', 'high_center', 'left', 'right'] as const, 'low_center'), size: oneOf(scene.product.size, ['small', 'medium', 'large'] as const, 'medium'), camera: oneOf(scene.product.camera, ['static', 'push_in', 'pull_out', 'pan', 'orbit', 'rise'] as const, 'static'), objectMotion: text(scene.product.object_motion, 90), textTiming: text(scene.product.text_timing, 90) } : null,
  };
};

export const OVERLAYS = ['lower_third', 'progress_bar', 'frame', 'logo_bug', 'scrim_bottom', 'scrim_top', 'light_leak', 'letterbox', 'vignette', 'film_grain', 'flash', 'counter'] as const;
/** A VideoStyle with every value valid: the model's where usable, the measured look and motion everywhere else. */
export function cleanVideoStyle(raw: unknown, fallback: VideoStyle): VideoStyle {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>; const t = (v.text && typeof v.text === 'object' ? v.text : {}) as Record<string, any>;
  const pick = <T extends string>(value: unknown, list: readonly T[], base: T): T => { const k = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''; return (list as readonly string[]).includes(k) ? (k as T) : base; };
  const overlays = (Array.isArray(v.overlays) ? v.overlays : []).map((o: unknown) => String(o).trim().toLowerCase().replace(/[\s-]+/g, '_')).filter((o: string): o is VideoStyle['overlays'][number] => (OVERLAYS as readonly string[]).includes(o)).filter((o: string, i: number, all: string[]) => all.indexOf(o) === i).slice(0, 6);
  const rawFont = String(t.font ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_'); const font = ((TYPE_CLASSES as readonly string[]).includes(rawFont) ? rawFont : fallback.text.font) as TypeClass;
  return {
    text: { position: pick(t.position, ['top', 'upper', 'middle', 'lower', 'bottom', 'none'] as const, fallback.text.position), align: pick(t.align, ['left', 'center', 'right'] as const, fallback.text.align), case: pick(t.case, ['sentence', 'upper', 'title'] as const, fallback.text.case), weight: pick(t.weight, ['light', 'regular', 'bold', 'black'] as const, fallback.text.weight), size: pick(t.size, ['s', 'm', 'l', 'xl'] as const, fallback.text.size), effect: pick(t.effect, ['static', 'fade', 'slide', 'kinetic', 'typed', 'pop', 'captions'] as const, fallback.text.effect), box: pick(t.box, ['none', 'pill', 'bar', 'outline', 'underline', 'highlight'] as const, fallback.text.box), font, colour: pick(t.colour ?? t.color, ['light', 'dark', 'accent'] as const, fallback.text.colour) },
    overlays: Array.isArray(v.overlays) ? overlays : fallback.overlays, camera: pick(v.camera, ['still', 'slow_push', 'ken_burns', 'handheld', 'whip_pans', 'zoom_punches', 'mixed'] as const, fallback.camera), cuts: pick(v.cuts, ['hard_cuts', 'dissolves', 'whips', 'wipes', 'zoom_punches', 'mixed'] as const, fallback.cuts), rhythm: pick(v.rhythm, ['steady', 'accelerating', 'beat_cuts', 'slow_build'] as const, fallback.rhythm), footage: pick(v.footage, ['photos', 'live_footage', 'graphics', 'screen_recording', 'mixed'] as const, fallback.footage), mood: text(v.mood, 80) || fallback.mood,
  };
}
/** The montage style as far as measuring alone can tell. */
export function measuredVideoStyle(measures: ReferenceMeasures | ReferenceAnalysis['measures']): VideoStyle {
  const look = measures.look; const hard = measures.segments.filter((s) => s.boundary === 'cut').length; const soft = measures.segments.filter((s) => s.boundary === 'dissolve').length; const fast = pacingOf(measures) === 'fast';
  const overlays: VideoStyle['overlays'] = [...(look && look.letterbox > 0.03 ? ['letterbox' as const] : []), ...(look && look.vignette > 0.18 ? ['vignette' as const] : []), ...(look && look.grain > 0.35 ? ['film_grain' as const] : []), 'scrim_bottom'];
  return { text: { position: 'lower', align: 'left', case: fast ? 'upper' : 'sentence', weight: 'bold', size: 'l', effect: fast ? 'pop' : 'fade', box: 'none', font: 'sans_heavy', colour: 'light' }, overlays, camera: measures.segments.some((s) => (s.motion ?? 0) > 30) ? 'handheld' : 'slow_push', cuts: soft > hard ? 'dissolves' : hard ? 'hard_cuts' : 'mixed', rhythm: fast ? 'beat_cuts' : 'steady', footage: 'photos', mood: look ? `${look.tint === 'neutral' ? 'natural' : look.tint.replace('_', ' ')} look` : 'natural' };
}

/** Checks and cleans the model's answer; anything unusable is dropped and the measured fallback fills the gap. */
export function sanitizeStyle(raw: unknown, measured: StyleProfile, count: number): StyleProfile {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const scenes = (Array.isArray(value.scenes) ? value.scenes : []).slice(0, count).map((scene: any, i: number) => ({ layout: oneOf(scene?.layout, layouts, measured.scenes[i]?.layout ?? 'statement'), card: oneOf(scene?.card, cardKinds, 'none'), notes: text(scene?.notes, 120), ...(cleanDesign(scene) ? { design: cleanDesign(scene)! } : {}) }));
  while (scenes.length < count) scenes.push(measured.scenes[scenes.length] ?? { layout: 'statement', card: 'none', notes: '' });
  const transitions = (Array.isArray(value.transitions) ? value.transitions : []).map((t: unknown) => oneOf(t, transitionKinds, 'fade')).filter((t: string, i: number, all: string[]) => all.indexOf(t) === i).slice(0, 4);
  return {
    feel: text(value.feel, 100) || measured.feel, theme: value.theme === 'dark' ? 'dark' : value.theme === 'light' ? 'light' : measured.theme, textTreatment: oneOf(value.text_treatment, textTreatments, measured.textTreatment),
    motion: text(value.motion, 120) || measured.motion, transitions: transitions.length ? transitions : measured.transitions, usesCharacter: value.uses_character === true, usesPhotos: value.uses_photos === true,
    hasVoiceover: typeof value.has_voiceover === 'boolean' ? value.has_voiceover : null, scenes, source: 'vision', video: cleanVideoStyle(value.video, measured.video ?? measuredVideoStyle({ seconds: 0, segments: [] } as never)),
    kind: oneOf(value.kind, ['product_scene', 'ui_explainer', 'photo_story', 'text_motion'] as const, 'ui_explainer'), lighting: text(value.lighting, 120), background: text(value.background, 120), typography: text(value.typography, 120), negativeSpace: oneOf(value.negative_space, ['low', 'medium', 'high'] as const, 'medium'), logo: value.logo && value.logo.present === true ? { present: true, position: oneOf(value.logo.position, ['top_left', 'top_center', 'top_right', 'bottom_left', 'bottom_center', 'bottom_right', 'center'] as const, 'top_left') } : { present: false, position: 'top_left' as const }, referenceText: cleanReferenceText(value.reference_text), avoid: (Array.isArray(value.seen_words) ? value.seen_words : []).map((w: unknown) => text(w, 40)).filter((w: string) => w.length >= 3).slice(0, 12),
    arrangement: oneOf(value.arrangement, ['orbit', 'scattered', 'grid', 'stack', 'none'] as const, measured.arrangement), glow: oneOf(value.glow, ['none', 'soft', 'strong'] as const, measured.glow), depth: oneOf(value.depth, ['flat', 'layered'] as const, measured.depth), palette: measured.palette,
  };
}

/** The style as far as measuring alone can tell (used as the fallback and to fill gaps): light or dark from brightness, scene kinds from position and motion. */
export function measuredStyle(measures: ReferenceMeasures | ReferenceAnalysis['measures']): StyleProfile {
  const segments = measures.segments; const bright = segments.reduce((sum, s) => sum + s.brightness, 0) / Math.max(1, segments.length);
  const pace = pacingOf(measures);
  const scenes = segments.map((segment, i) => ({ layout: (i === segments.length - 1 ? 'cta' : i === 0 && segments.length > 2 ? 'statement' : 'hero_text_card') as Layout, card: 'bars' as CardKind, notes: `${segment.brightness > 0.6 ? 'light' : 'dark'} scene, ${segment.motion > 4 ? 'lots of' : 'gentle'} movement` }));
  return { feel: `${bright > 0.6 ? 'clean and light' : 'bold and dark'}, ${pace} pace`, theme: bright > 0.55 ? 'light' : 'dark', arrangement: 'none', glow: bright > 0.55 ? 'none' : 'soft', depth: 'flat', palette: [...new Set(segments.flatMap((s) => s.colours))].slice(0, 6), textTreatment: pace === 'fast' ? 'kinetic_headline' : 'word_swap', motion: pace === 'fast' ? 'quick cuts and fast movement' : 'smooth, steady movement', transitions: pace === 'fast' ? ['cut'] : ['fade'], usesCharacter: false, usesPhotos: false, hasVoiceover: measures.speechWordsPerMinute === null ? null : measures.speechWordsPerMinute > 40, scenes, video: measuredVideoStyle(measures), source: 'measured' };
}

export type SheetModel = (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }>;

export async function describeStyle(measures: ReferenceMeasures, sheets: Buffer[], model?: SheetModel): Promise<StyleProfile> {
  const fallback = measuredStyle(measures);
  if (!model || !sheets.length) return fallback;
  const prompt = `The video is ${measures.seconds} seconds, ${measures.vertical ? 'vertical' : 'horizontal'}, with ${measures.segments.length} parts. The frames are the middle of each part, in order. Part lengths in seconds: ${measures.segments.map((s) => s.seconds).join(', ')}. Give exactly ${measures.segments.length} entries in "scenes".`;
  // the model can stall or answer badly once: it is asked a second time before the measured guess is used (which cannot tell a product advert from anything else)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const reply = await model(SYSTEM, prompt, sheets); const parsed = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? ''); return sanitizeStyle(parsed, fallback, measures.segments.length); } catch { /* once more */ }
  }
  return fallback;
}

// ---- the blueprint ---------------------------------------------------------------------------------------------------------------------

export type SlotType = 'hero' | 'swap' | 'orbit' | 'intro' | 'chaos' | 'form' | 'schedule' | 'chat' | 'steps' | 'photo' | 'cta';
/** The measured layout of a scene, ready for the scene library: where the centre is, the size of the circle, how fast it turns, where the headline sits and how big it is, and how quickly things build up. */
export type Geo = { cx: number; cy: number; rx: number; ry: number; speed: number; charR: number; headY: number; align: 'left' | 'center'; headSize: number; stagger: number; shape: 'disc' | 'icon'; count: number };
export type Slot = { /** how the vision step described this scene (for a product advert: where the hero object sits, the camera, when words appear) */ design?: SceneDesign; geo: Geo; type: SlotType; seconds: number; /** how many of the reference's cuts this scene stands for (the key word of a swap scene changes this many times) */ parts: number; card: Exclude<CardKind, 'none'>; transition: 'fade' | 'wipe' | 'iris' | 'zoom' | 'push'; note: string };
export type Blueprint = { /** the shot-by-shot plan of a montage reference (camera, joins, grade, overlays, text), for the styled engine */ styled?: StyledSpec; /** which renderer the reference calls for: 'custom' (a product advert, drawn by the custom code path), 'styled' (a montage of pictures with the reference's camera, cuts, grade and text) or 'explainer' (interface scenes) */ engine: 'custom' | 'explainer' | 'styled'; /** for a custom reference: the full visual and motion design */ design?: DesignBlueprint; /** how strong the glow is (0.4 to 2.2) and what arrangement of floating elements the reference has */ look: { glow: number; depth: boolean; arrangement: StyleProfile['arrangement'] }; theme: 'light' | 'dark'; pacing: 'fast' | 'medium' | 'slow'; textTreatment: TextTreatment; slots: Slot[]; voice: boolean; musicStyle: string[]; summary: string; referenceSeconds: number };

const SLOT_FOR: Record<Layout, SlotType> = { product_hero: 'hero', hero_text_card: 'swap', orbit: 'orbit', bubbles: 'chaos', character_intro: 'intro', form_ui: 'form', schedule_ui: 'schedule', chat_ui: 'chat', photo_full: 'photo', checklist: 'steps', statement: 'steps', cta: 'cta' };
const TRANSITION_FOR: Record<(typeof transitionKinds)[number], Slot['transition']> = { cut: 'fade', fade: 'fade', slide: 'push', zoom: 'zoom', wipe: 'wipe' };

/** Time each kind of scene needs at least, so a quick reference never produces scenes too short to read. */
const FLOOR: Record<SlotType, number> = { hero: 2.4, orbit: 5.5, swap: 4.2, intro: 3.6, chaos: 4.5, form: 6, schedule: 5.5, chat: 6, steps: 3.6, photo: 3.2, cta: 3.2 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const HEAD_Y = { top: 0.16, upper: 0.42, middle: 0.5, lower: 0.585, bottom: 0.7 } as const; const HEAD_SIZE = { s: 76, m: 90, l: 104, xl: 120 } as const; const CHAR_R = { small: 92, medium: 118, large: 150 } as const;
const CHAR_AT = { top: [0.5, 0.22], center: [0.5, 0.34], left: [0.3, 0.34], right: [0.7, 0.34], bottom: [0.5, 0.48] } as const;

/** The layout numbers for one scene: from what the vision step saw where it could say, otherwise from what was measured in the frames. */
export function geoFor(geometry: Geometry | undefined, design: SceneDesign | undefined): Geo {
  const at = design?.character ? CHAR_AT[design.character.position] : geometry ? [clamp(geometry.subject.x, 0.3, 0.7), clamp(geometry.subject.y, 0.2, 0.42)] : [0.5, 0.31];
  const headY = design?.headline ? HEAD_Y[design.headline.position] : 0.585;
  const rx = clamp((geometry?.subject.spread ?? 0.24) * 1080 * 1.5, 290, 430); let ry = rx * 0.55;
  const bottom = at[1] * 1920 + ry + 120; if (bottom > headY * 1920 - 40) ry = Math.max(120, headY * 1920 - 40 - 120 - at[1] * 1920);
  const early = geometry ? (geometry.activity.slice(0, 3).reduce((a, b) => a + b, 0) / 3) : 1;
  return {
    cx: Math.round(at[0] * 100) / 100, cy: Math.round(at[1] * 100) / 100, rx: Math.round(rx), ry: Math.round(ry), speed: design?.rotation === 'counter' ? -0.3 : design?.rotation === 'none' ? 0.1 : 0.32, charR: design?.character ? CHAR_R[design.character.size] : 118,
    headY, align: design?.headline?.align === 'left' ? 'left' : 'center', headSize: design?.headline ? HEAD_SIZE[design.headline.size] : 100, stagger: early < 0.7 ? 0.22 : early > 1.25 ? 0.1 : 0.16, shape: design?.shape === 'icon' ? 'icon' : 'disc',
    count: design?.elements ? clamp(design.elements, 4, 10) : 8,
  };
}

/**
 * The plan for the new video taken from the reference: the same kind of scenes in the same order, each about as long as the reference's, with the same
 * look (light or dark) and kind of change between them. Parts of the reference that are the same layout one after another (a key word swapping over the
 * same card) become one scene. `photos` says whether pictures are available for scenes that need them; `targetSeconds` stretches or squeezes the whole.
 */
export function buildBlueprint(analysis: ReferenceAnalysis, { photos, targetSeconds, voice, allowed = '' }: { photos: boolean; targetSeconds?: number | null; voice?: boolean | null; /** the business's own words and the owner's request: a word of the reference that also appears here is not kept out */ allowed?: string }): Blueprint {
  const { measures, style } = analysis; const parts = measures.segments;
  const slots: Slot[] = [];
  parts.forEach((part, i) => {
    const scene = style.scenes[i] ?? { layout: 'statement' as Layout, card: 'none' as CardKind, notes: '' };
    let type = SLOT_FOR[scene.layout];
    // a scene the model called a headline-over-card but described as a mascot or character is an intro, and floating labels or chips are bubbles
    if (type === 'swap' && /\b(?:mascot|character|avatar|robot)\b/i.test(scene.notes)) type = 'intro';
    else if (type === 'swap' && /\b(?:chips?|bubbles?|floating labels?|pills?)\b/i.test(scene.notes) && !/\b(?:chart|graph|card)\b/i.test(scene.notes)) type = 'chaos';
    // floating elements the reference arranges in a circle are an orbit, whatever the model called the scene
    if ((type === 'chaos' || type === 'intro' || type === 'swap') && (/\b(?:orbit\w*|circular|circle of|in a circle|ring of|radial|around (?:the|a) (?:centre|center|mascot|character|logo|globe))\b/i.test(scene.notes) || (style.arrangement === 'orbit' && type === 'intro'))) type = 'orbit';
    if (type === 'photo' && !photos) type = 'steps';
    const before = slots[slots.length - 1];
    // two neighbouring parts that look the same (same place for the main detail, same brightness) are one scene however the model labelled them
    const last = parts[i - 1]; const alike = !!(before && last?.geometry && part.geometry && Math.hypot(last.geometry.subject.x - part.geometry.subject.x, last.geometry.subject.y - part.geometry.subject.y) < 0.07 && Math.abs(last.brightness - part.brightness) < 0.08 && last.geometry.placement === part.geometry.placement);
    if (alike && before && type !== 'cta' && before.type !== 'cta') type = before.type;
    if (before && before.type === type && type === 'swap') { before.seconds += part.seconds; before.parts += 1; return; }
    // the same circle of elements for several parts in a row is one scene (up to about ten seconds), not the same scene again and again
    if (before && before.type === 'orbit' && type === 'orbit' && before.seconds + part.seconds <= 10) { before.seconds += part.seconds; before.parts += 1; return; }
    const transition = TRANSITION_FOR[style.transitions[i % Math.max(1, style.transitions.length)] ?? 'fade'];
    slots.push({ ...(scene.design ? { design: scene.design } : {}), geo: geoFor(part.geometry, scene.design), type, seconds: part.seconds, parts: 1, card: scene.card === 'none' ? (['bars', 'list', 'line'] as const)[slots.length % 3] : scene.card, transition, note: scene.notes });
  });
  // a story that opens and closes: it always ends on a call to action
  if (slots.at(-1)?.type !== 'cta') slots.push({ geo: geoFor(undefined, undefined), type: 'cta', seconds: 3.6, parts: 1, card: 'bars', transition: 'fade', note: 'closing call to action' });
  while (slots.length > 8) { const at = slots.findIndex((slot, i) => i > 0 && i < slots.length - 1 && slot.type === 'steps'); slots.splice(at > 0 ? at : slots.length - 2, 1); }
  // lengths: the reference's own, scaled to the length asked for (if any), never below what each kind of scene needs
  const total = slots.reduce((sum, slot) => sum + slot.seconds, 0) || 1;
  const goal = Math.min(60, Math.max(8, targetSeconds ?? Math.min(measures.seconds, 45)));
  for (const slot of slots) slot.seconds = Math.round(Math.max(FLOOR[slot.type], (slot.seconds / total) * goal) * 10) / 10;
  const pacing = pacingOf(measures);
  const wantsVoice = voice ?? (style.hasVoiceover === true || (measures.speechWordsPerMinute ?? 0) > 40);
  const musicStyle = [pacing === 'fast' ? 'fast' : pacing === 'slow' ? 'calm' : 'bright', style.theme === 'dark' ? 'dark' : 'bright'];
  const look = { glow: style.glow === 'strong' ? 1.7 : style.glow === 'soft' ? 1.15 : 0.8, depth: style.depth === 'layered', arrangement: style.arrangement };
  // a product advert is drawn by the custom code path; anything else by the explainer scenes (a hero scene there becomes a photo or a list)
  const heroShare = slots.filter((slot) => slot.type === 'hero').length / Math.max(1, slots.length);
  // a montage of different pictures (however a model labelled it) is made as one; a product advert keeps one set and one backdrop
  const varied = shotVariety(measures) >= MONTAGE_VARIETY; const montage = (style.kind === 'photo_story' || style.kind === 'text_motion' || (style.usesPhotos && style.kind !== 'ui_explainer') || (varied && style.kind !== 'ui_explainer')) && !style.usesCharacter && !!style.video && process.env.PILOT_VIDEO_STYLE_TRANSFER !== 'off';
  const engine: Blueprint['engine'] = (style.kind === 'product_scene' || heroShare >= 0.5) && !(varied && montage) ? 'custom' : montage ? 'styled' : 'explainer';
  if (engine === 'explainer') for (const slot of slots) if (slot.type === 'hero') slot.type = photos ? 'photo' : 'steps';
  const design = engine === 'custom' || engine === 'styled' ? buildDesignBlueprint(analysis, slots, { totalSeconds: Math.round(slots.reduce((sum, slot) => sum + slot.seconds, 0) * 10) / 10, allowed }) : undefined;
  return { engine, ...(design ? { design } : {}), ...(engine === 'styled' ? { styled: buildStyledSpec(analysis, targetSeconds) } : {}), look, theme: style.theme, pacing, textTreatment: style.textTreatment, slots, voice: wantsVoice, musicStyle, referenceSeconds: measures.seconds, summary: describeAnalysis(analysis, slots) };
}

const NAMES: Record<SlotType, string> = { hero: 'hero product on a lit set', orbit: 'elements circling the character, with glow and depth', swap: 'headline with a changing word over a UI card', intro: 'character/logo intro', chaos: 'floating task bubbles', form: 'form that fills in', schedule: 'schedule that builds itself', chat: 'chat', steps: 'short list of points', photo: 'full-frame photo', cta: 'closing call to action' };
export const slotName = (type: SlotType) => NAMES[type];

/** A plain-words summary of what Pilot learned, shown to the owner. */
export function describeAnalysis(analysis: ReferenceAnalysis, slots?: Slot[]): string {
  const { measures, style } = analysis;
  const lines = [
    `${Math.round(measures.seconds)} seconds, ${measures.vertical ? 'vertical' : 'horizontal'}, ${measures.segments.length} parts, ${analysis.pacing} pace (about ${analysis.averageSceneSeconds.toFixed(1)} seconds per scene).`,
    `Look: ${style.theme} background, ${style.feel}${style.glow !== 'none' ? `, ${style.glow} glow` : ''}${style.depth === 'layered' ? ', layered depth' : ''}${style.arrangement !== 'none' ? `, ${style.arrangement} arrangement of elements` : ''}. Text: ${style.textTreatment.replace(/_/g, ' ')}. Motion: ${style.motion}.`,
    measures.hasAudio ? `Sound: ${measures.speechWordsPerMinute ? 'a voiceover and music' : style.hasVoiceover ? 'a voiceover' : 'music or sound'}.` : 'Sound: none.',
  ];
  if (slots) lines.push(`Scenes I will make: ${slots.map((slot) => `${NAMES[slot.type]} (${slot.seconds}s)`).join(' → ')}.`);
  return lines.join(' ');
}
