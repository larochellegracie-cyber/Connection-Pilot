import { cleanLine } from '../explainer/storyboard.js';
import { containsAvoided, type DesignBlueprint } from '../reference/design.js';
import { findReferenceText, redact, type ReferenceText } from '../reference/protect.js';
import { validateSpec } from '../standard-video/spec.js';
import type { PlanResult } from '../standard-video/planner.js';
import { strategyText, type Strategy } from './strategy.js';
import type { BrandKit } from '../standard-video/templates.js';

/**
 * The concept of a fully custom video. For a creative request (or a subject the business's information says nothing about), Pilot does not take the usual
 * service-based plan (service cards, lists of openings and closings, a "book now" star). A model first invents the whole video from the request: how many
 * scenes, how long each runs, what each one draws, and the few words on screen. Plain code then checks every word (no invented prices, numbers, links or
 * claims) and the concept goes to the code writer, which draws every scene itself.
 */
/** The ready-made illustrations the drawing library has (pilot_props.py). */
export const PROP_KINDS = ['cake', 'cupcake', 'coffee', 'gift', 'house', 'tree', 'sun', 'water', 'wrench'] as const;
/**
 * The storyboard's contract for one scene: what the scene is for, what it shows, and the measurable decisions about how (composition, words, camera, crop, scrim, light, intensity). A small fixed
 * vocabulary so the code writer is not left to guess what a phrase means, and so the finished frames can be measured against it. The creative choices inside it are the model's.
 */
export const COMPOSITIONS = ['full_frame_image', 'detail_crop', 'typographic', 'split', 'centered_subject', 'graphic_motion', 'logo_card'] as const;
export const TEXT_KINDS = ['none', 'headline', 'headline_sub', 'type_only'] as const;
export const TEXT_POSITIONS = ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right', 'fill'] as const;
export const TEXT_SCALES = ['small', 'medium', 'large', 'dominant'] as const;
export const CAMERAS = ['push_in', 'pull_out', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'orbit', 'handheld', 'drift', 'static'] as const;
export const CROPS = ['wide', 'medium', 'tight', 'macro'] as const;
export const SCRIMS = ['none', 'light', 'heavy'] as const;
export const INTENSITIES = ['quiet', 'medium', 'intense'] as const;
export const CTAS = ['none', 'sign_off', 'call_to_action'] as const;
type OneOf<T extends readonly string[]> = T[number];
export type Shot = { /** what the scene does for the story */ purpose: string; /** this scene's own visual treatment (free: cinematic photo, glossy 3D render, flat illustration, kinetic type on colour...) */ style?: string; /** how the words are set in this scene (free: huge stacked caps, light serif italic, outlined word, ticker...) */ type_style?: string; /** its visual subject */ subject: string; /** where that subject sits in its picture (0..1 across, 0..1 down) */ subject_at?: { x: number; y: number }; composition?: OneOf<typeof COMPOSITIONS>; text?: OneOf<typeof TEXT_KINDS>; text_position?: OneOf<typeof TEXT_POSITIONS>; text_scale?: OneOf<typeof TEXT_SCALES>; camera?: OneOf<typeof CAMERAS>; crop?: OneOf<typeof CROPS>; scrim?: OneOf<typeof SCRIMS>; /** the light, in a few words */ lighting: string; intensity?: OneOf<typeof INTENSITIES>; cta?: OneOf<typeof CTAS> };

const pick = <T extends readonly string[]>(value: unknown, list: T): T[number] | undefined => (typeof value === 'string' && (list as readonly string[]).includes(value.trim().toLowerCase()) ? (value.trim().toLowerCase() as T[number]) : undefined);
/** The model's shot, cleaned: only known words are kept (an unknown one means "not specified", never a guess), and the fields are made to agree with each other. */
export function cleanShot(raw: unknown): Shot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>; const words = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const at = r.subject_at && typeof r.subject_at === 'object' ? { x: Number((r.subject_at as Record<string, unknown>).x), y: Number((r.subject_at as Record<string, unknown>).y) } : undefined;
  const shot: Shot = { purpose: words(r.purpose, 100), subject: words(r.subject, 100), lighting: words(r.lighting, 100) };
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) shot.subject_at = { x: Math.max(0, Math.min(1, at.x)), y: Math.max(0, Math.min(1, at.y)) };
  if (words(r.style, 80)) shot.style = words(r.style, 80);
  if (words(r.type_style, 80)) shot.type_style = words(r.type_style, 80);
  const set = <K extends keyof Shot>(key: K, value: Shot[K] | undefined) => { if (value !== undefined) shot[key] = value; };
  set('composition', pick(r.composition, COMPOSITIONS)); set('text', pick(r.text, TEXT_KINDS)); set('text_position', pick(r.text_position, TEXT_POSITIONS)); set('text_scale', pick(r.text_scale, TEXT_SCALES));
  set('camera', pick(r.camera, CAMERAS)); set('crop', pick(r.crop, CROPS)); set('scrim', pick(r.scrim, SCRIMS)); set('intensity', pick(r.intensity, INTENSITIES)); set('cta', pick(r.cta, CTAS));
  // fields that disagree with each other: typography that dominates the frame is centred and filling it; a scene with no words has no text position, scale or scrim for text
  if (shot.composition === 'typographic' && shot.text === 'none') shot.text = 'type_only';
  if (shot.composition === 'typographic' && !shot.text_scale) shot.text_scale = 'dominant';
  if (shot.composition === 'typographic' && !shot.text_position) shot.text_position = 'fill';
  if (shot.text === 'none') { delete shot.text_position; delete shot.text_scale; }
  return shot;
}

export type ConceptScene = { /** the storyboard's contract for this scene (see Shot) */ shot?: Shot; /** from a reference video: the layout and motion this scene must follow (where the hero sits, the camera, when words appear, the transition) */ direction?: string; transition?: string; role: 'hook' | 'scene' | 'closing'; seconds: number; headline: string; subtext: string; items: string[]; /** what this scene draws, in a few plain words */ visual: string; /** a photo (by id) this scene may use, or null */ photoId: string | null };
/** The look the SUBJECT calls for (a cake feels different from a pool): backdrop colours, two lights, two tones. The business's brand colours stay as the accent. */
export type MoodPalette = { bgA: string; bgB: string; glow: string; glow2: string; toneA: string; toneB: string; light: boolean; text?: string };
export type Concept = { /** the creative strategy this storyboard was made from (see strategy.ts) */ strategy?: Strategy; title: string; mood: string; palette: MoodPalette; scenes: ConceptScene[]; seconds: number };

/** Moods to start from when the model's own colours are unusable. */
export const MOOD_PRESETS: Array<{ words: RegExp; palette: MoodPalette }> = [
  { words: /\b(?:cake|dessert|sweet|cozy|cosy|warm|bak\w+|chocolate|treat|candy|coffee|cafe)\b/i, palette: { bgA: '#3A1D2A', bgB: '#1A0D14', glow: '#F2A65A', glow2: '#E8638C', toneA: '#F3E3C3', toneB: '#C98B5B', light: false } },
  { words: /\b(?:pool|water|fresh|summer|ocean|clean|splash|spa|aqua)\b/i, palette: { bgA: '#0B3C5D', bgB: '#061D2E', glow: '#4CC9F0', glow2: '#80ED99', toneA: '#BDEFFF', toneB: '#2AA9E0', light: false } },
  { words: /\b(?:luxur\w+|night|elegant|premium|gala|party|celebrat\w+|evening)\b/i, palette: { bgA: '#1B1330', bgB: '#0B0818', glow: '#C8A2FF', glow2: '#F4C95D', toneA: '#F4C95D', toneB: '#8E6BD8', light: false } },
  { words: /\b(?:bright|playful|fun|kids|colou?rful|birthday|spring|happy)\b/i, palette: { bgA: '#FFF1E6', bgB: '#FFD6C2', glow: '#FF8FA3', glow2: '#FFD166', toneA: '#FF6B6B', toneB: '#4ECDC4', light: true } },
  { words: /\b(?:garden|natural|earthy|green|eco|organic|outdoor|lawn|tree)\b/i, palette: { bgA: '#1F3A2B', bgB: '#0E1F16', glow: '#9BD38A', glow2: '#F2CC8F', toneA: '#F2CC8F', toneB: '#6BAA75', light: false } },
];
const hexOk = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].reduce((s, v, i) => { const c = v / 255; return s + (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]; }, 0); };
/** The model's palette if all its colours are real hex colours and the backdrop is clearly light or dark (so words read); else a preset for the mood or subject. */
export function cleanPalette(raw: unknown, moodText: string): MoodPalette {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const keys = ['bgA', 'bgB', 'glow', 'glow2', 'toneA', 'toneB'] as const;
  if (keys.every((key) => hexOk(p[key]))) {
    const palette = { bgA: (p.bgA as string).toUpperCase(), bgB: (p.bgB as string).toUpperCase(), glow: (p.glow as string).toUpperCase(), glow2: (p.glow2 as string).toUpperCase(), toneA: (p.toneA as string).toUpperCase(), toneB: (p.toneB as string).toUpperCase(), light: lum((p.bgA as string)) > 0.45 };
    const L = lum(palette.bgA); if (L < 0.12 || L > 0.55) return palette; // mid-tone backdrops make words hard to read
  }
  return (MOOD_PRESETS.find((preset) => preset.words.test(moodText)) ?? MOOD_PRESETS[2]).palette;
}
/** The palette in the form the drawing library reads (words are white on a dark backdrop, near-black on a light one). */
export const conceptPalette = (concept: Concept): Record<string, string | boolean> => ({ dark: !concept.palette.light, bg_a: concept.palette.bgA, bg_b: concept.palette.bgB, text: concept.palette.text ?? (concept.palette.light ? '#1B1B22' : '#FFFFFF'), glow: concept.palette.glow, glow2: concept.palette.glow2, scrim: concept.palette.bgB, tone_a: concept.palette.toneA, tone_b: concept.palette.toneB });
export type ConceptInput = {
  request: string; subject: string; seconds: number; business: { name: string; type: string; location: string; services: string[]; description: string; tone: string }; photos: Array<{ id: string; label: string; /** what looking at the picture found it shows, and how it should be used */ shows?: string; use?: string }>;
  /** a realistic picture of the subject itself (the business's own photo, or one generated for this request): it is the main visual of every scene */ heroPhoto?: { id: string; label: string };
  /** the owner's own style words ("dark", "dramatic", "premium"), platform and instructions: the look and pace the concept must follow */ style?: string[]; platform?: string; instructions?: string[];
  /** the creative strategy decided first: authoritative for the structure, pace, visual approach and assets of this storyboard (see strategy.ts) */ strategy?: Strategy;
  /** what the previous storyboard attempt got wrong against the strategy, so this one fixes it */ feedback?: string[];
  /** prop kinds the drawing library has */ props: readonly string[];
  /** 'motion': the video is built from invented graphics and app UI (task chips, cards that fill themselves in, counters, tick and cross lists), not photographs */ look?: 'photo' | 'motion';
  /** the design blueprint of a reference video the owner supplied: visual (colours, lighting, set, type, space) and motion (scene count, lengths, camera, transitions) */ reference?: DesignBlueprint;
  /** the reference's own text that must not appear anywhere in the concept (checked by code, and listed in the prompt) */ forbidden?: ReferenceText;
};
type Complete = (system: string, prompt: string) => Promise<string>;

const SCHEMA = `You are Pilot's creative director and colourist. A small business asked for a video that its usual templates do not suit, so you INVENT the whole video from the request: its structure, pacing, scenes and visuals. It will be drawn frame by frame with shapes and ready-made illustrations (props), in the business's brand colours.
Reply with ONLY JSON: {"title": string, "mood": "up to 6 words", "palette": {"bgA": "#RRGGBB", "bgB": "#RRGGBB", "glow": "#RRGGBB", "glow2": "#RRGGBB", "toneA": "#RRGGBB", "toneB": "#RRGGBB"}, "scenes": [{"role": "hook" | "scene" | "closing", "seconds": number, "headline": "up to 6 words, or empty", "subtext": "up to 10 words, or empty", "items": [up to 3 very short words or phrases, or empty], "visual": "what this scene draws and how it moves, up to 25 words", "shot": {"purpose": "what this scene does for the story, up to 12 words", "subject": "its visual subject, up to 12 words", "subject_at": {"x": 0 to 1 across, "y": 0 to 1 down} (where that subject sits in its picture; leave out when there is no picture), "composition": "full_frame_image" | "detail_crop" | "typographic" | "split" | "centered_subject" | "graphic_motion" | "logo_card", "text": "none" | "headline" | "headline_sub" | "type_only", "text_position": "top_left" | "top_center" | "top_right" | "middle_left" | "middle_center" | "middle_right" | "bottom_left" | "bottom_center" | "bottom_right" | "fill", "text_scale": "small" | "medium" | "large" | "dominant", "camera": "push_in" | "pull_out" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "orbit" | "handheld" | "drift" | "static", "crop": "wide" | "medium" | "tight" | "macro", "scrim": "none" | "light" | "heavy", "style": "this scene's own visual treatment, up to 10 words (cinematic photo, glossy 3D render, flat illustration, animated water, kinetic type on colour...): scenes of one film may differ in treatment while still feeling like one advertisement", "type_style": "how this scene's words are set, up to 10 words (huge stacked caps, light serif italic, one outlined word, small caps over a big number...): vary it from scene to scene with the concept", "lighting": "the light in up to 12 words", "intensity": "quiet" | "medium" | "intense", "cta": "none" | "sign_off" | "call_to_action"}, "transition": "whip" | "crosszoom" | "lightleak" | "slice" | "push" | "zoom" | "wipe" | "iris" | "fade" (how this scene hands over to the next), "photo": a photo id from the list, or null}]}.`;
const LEGACY_RULES = `Rules: 4 to 7 scenes whose seconds add up to the length asked. Make it about the SUBJECT OF THE REQUEST, as a short story with a clear beginning, build and finish (for example: an empty plate, the cake builds layer by layer, candles light, a sparkle, the sign-off). Do NOT turn it into an advert for the business's usual services: no lists of services, no "openings", "closings", "weekly maintenance" or "free quotes" unless the request itself is about them, and no "book now" or "call today" button unless the owner asked for a call to action or the subject is one of the business's own services (then the sign-off may carry ONE short, plain call to action, never an invented offer). Decide the pacing yourself (short punchy scenes or slow ones) to suit the style the owner asked for. Each scene's "shot" is a CONTRACT: the code writer will execute it exactly and the finished frames are measured against it, so ask only for what you want to see and make the fields agree (typographic means big type that fills the frame; text "none" means no words at all in that scene; a tight or macro crop needs subject_at; "dominant" type is 140 or more). Plan each scene's composition for the story, not from one layout: some scenes are a full-frame picture with no words at all, some a close crop, some big type, some a quiet moment; no two neighbouring scenes should be framed the same way unless the story needs it. The last scene ("closing") is a short sign-off: the business name as the headline and at most one warm line. PALETTE: choose the colours the SUBJECT calls for, not the business\'s own (a cake: warm cocoa, cream and rose with golden light; a pool: deep aqua with bright cyan; a celebration: deep violet and gold; something playful: a light peach backdrop with coral and teal). bgA and bgB are the backdrop (top and bottom) and must be clearly dark or clearly light, never mid-tone; glow and glow2 are two lights; toneA and toneB are two supporting colours. The business\'s brand colour is added as an accent automatically. Make each video look different from a generic template. Words on screen are few and playful; most of the video is picture and motion. Use only facts you are given. Never invent prices, discounts, numbers, dates, awards, reviews, phone numbers, web addresses or claims, and never add a trust claim (licensed, insured, certified, guaranteed, years of experience, "24/7", fastest, best, free estimates) that the request or the business's own information does not state. The call to action belongs to the film: build it on a picture, a live graphic or a moving background that has been part of the video, in the same visual language as the scenes before it, not on an empty gradient card; and vary the type from scene to scene (size, weight, position, animation and timing follow what each scene is doing; a headline is set big, supporting lines are never small print). Every scene must add something: a scene with no picture and no words is cut or merged. The closing scene is a designed ad frame (a button or pill, a moving background, a picture) that says plainly what the customer should do, using only contact details and facts the business actually gave. Do not use digits. Visuals may use these ready-made props: PROPS. Use a photo only when it clearly shows the subject.`;
/** Transitions during which the next scene is already on screen (the two overlap), and for how long. Must match the renderer (pilot_scenes.py). */
/** Sizes the scenes again so the video PLAYS the length asked (live transitions overlap), after anything has added, removed or re-timed scenes. */
export function refitSeconds(concept: Concept, goal: number): void {
  const scenes = concept.scenes; if (!scenes.length) return;
  const overlap = (secs: number[]) => secs.reduce((sum, s, i) => sum + (i < secs.length - 1 && LIVE_TRANSITIONS.has(scenes[i].transition ?? '') ? Math.min(LIVE_OVERLAP, s / 2) : 0), 0);
  const base = scenes.map((s) => s.seconds); const total = base.reduce((a, b) => a + b, 0) || 1; let aim = goal; let secs = base;
  for (let pass = 0; pass < 8; pass += 1) { secs = base.map((s) => Math.max(0.6, Math.round((s / total) * aim * 10) / 10)); const played = secs.reduce((a, b) => a + b, 0) - overlap(secs); if (Math.abs(played - goal) < 0.15) break; aim += goal - played; }
  scenes.forEach((s, i) => { s.seconds = secs[i]; }); concept.seconds = goal;
}
export const LIVE_TRANSITIONS = new Set(['whip', 'crosszoom', 'lightleak', 'slice']); export const LIVE_OVERLAP = 0.6;

const STRATEGY_RULES = `Rules: never production vocabulary on screen (no "panorama", "establishing shot", "hero", "scene 2", "overlay", "title card", "placeholder", "CTA"); a change from an illustrated world to the real photograph uses crosszoom or lightleak, as if travelling into it; headline and subtext are ONLY words a viewer should read (a hook, a name, a benefit, a number, a call to action), never narration of the graphic (not "follow the trail", not "the glow marks the spot": the graphic does that itself); leave words empty when a scene has no real copy; NEVER a description of the picture or shot (not "clock close-up", not "silhouette and van beams"): describe the picture in the visual field, and leave the words empty when the scene needs none. The CREATIVE STRATEGY below is AUTHORITATIVE: the storyboard is that strategy made concrete, and everything you write must agree with it. Turn its beats into scenes (a beat may be one scene or several quick cuts). The number of scenes is yours, from 1 to 14, and it comes FROM THE CREATIVE IDEA (a single continuous transformation is one scene; a rapid montage is many), and the scene lengths follow the pacing (slow: scenes of 4 seconds or more; measured: about 3 to 5; brisk: about 2 to 3; rapid: under 2) and add up to the length asked. The visual approach decides what the scenes are made of: photo_led (pictures carry it), graphic_led (invented graphics, cards, counters, type and shapes carry it: set "photo" to null in every scene except at most one), mixed (both), typographic (type carries it). Follow the asset plan: use a picture only in its planned role and in no more scenes than planned; a scene without a picture is a graphic_motion, typographic or logo_card scene with photo null; never give a scene a picture just to fill it. Follow the typography, colour and light, transition, call-to-action and ending decisions. Follow the strategy's visual language, and give each scene its own "style" (its treatment may differ from its neighbours while the film stays one advertisement); never let every scene share one placement, one move and one treatment. Each scene's "shot" says whether it has any words. Do NOT turn the video into an advert for the business's usual services unless the request is about them; ask the viewer for something only if the strategy's call to action does, in plain words from the request or the business's own information, never an invented offer. The business's name or logo must be present by the end (the code adds the logo mark to the last scene), so the last scene needs words only if the ending calls for them. Each scene's "shot" is a CONTRACT: the code writer will execute it exactly and the finished frames are measured against it, so ask only for what you want to see and make the fields agree (typographic means big type that fills the frame; text "none" means no words at all in that scene; a tight or macro crop needs subject_at; "dominant" type is 140 or more). PALETTE: choose the colours the strategy's colour and light call for (and the subject), not the business's own. bgA and bgB are the backdrop (top and bottom) and must be clearly dark or clearly light, never mid-tone; glow and glow2 are two lights; toneA and toneB are two supporting colours. The business's brand colour is added as an accent automatically. Words on screen are few. Use only facts you are given. Never invent prices, discounts, numbers, dates, awards, reviews, phone numbers, web addresses or claims. Do not use digits. Visuals may use these ready-made props: PROPS. Use a photo only when it clearly shows the subject.`;

export const LIVE_OR_PLAIN = ['whip', 'crosszoom', 'lightleak', 'push', 'zoom', 'wipe', 'iris', 'fade'] as const;
const trimWords = (value: string, max: number) => value.split(/\s+/).filter(Boolean).slice(0, max).join(' ');

/** Checks and cleans a model's concept. Returns null when too little of it is usable. */
export function sanitizeConcept(raw: unknown, input: ConceptInput): Concept | null {
  const body = (raw && typeof raw === 'object' ? raw : {}) as { title?: unknown; mood?: unknown; scenes?: unknown };
  if (!Array.isArray(body.scenes)) return null;
  const known = [input.request, input.subject, input.business.name, input.business.type, input.business.location].join(' ');
  const ids = new Set(input.photos.map((photo) => photo.id)); const used = new Set<string>();
  const scenes: ConceptScene[] = [];
  const strat = input.strategy; const unusable = new Set((strat?.assets.plan ?? []).filter((p) => p.role === 'unused').map((p) => p.id));
  for (const entry of body.scenes.slice(0, strat ? 14 : 7)) {
    const s = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const visual = typeof s.visual === 'string' ? s.visual.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!visual) continue;
    const hero = input.heroPhoto?.id;
    // with a strategy a scene has the picture the storyboard names, or none (a scene is never given the hero just to fill it); without one the older rule stands
    const photo = strat ? (typeof s.photo === 'string' && ids.has(s.photo) && !unusable.has(s.photo) ? s.photo : null) : (typeof s.photo === 'string' && ids.has(s.photo) && (s.photo === hero || !used.has(s.photo)) ? s.photo : (hero ?? null)); if (photo && photo !== hero) used.add(photo);
    scenes.push({ role: s.role === 'hook' || s.role === 'closing' ? s.role : 'scene', seconds: strat ? Math.max(0.6, Math.min(8, Number(s.seconds) || 3)) : Math.max(1.5, Math.min(6, Number(s.seconds) || 3)), headline: trimWords(cleanLine(s.headline, 44, known), 6), subtext: trimWords(cleanLine(s.subtext, 70, known), 10), items: (Array.isArray(s.items) ? s.items : []).map((item) => trimWords(cleanLine(item, 26, known), 4)).filter((item) => item.length >= 2).slice(0, 3), visual, photoId: photo, ...(cleanShot(s.shot) ? { shot: cleanShot(s.shot) } : {}), ...(() => { const direction = typeof s.direction === 'string' ? s.direction.replace(/\s+/g, ' ').trim().slice(0, 200) : ''; const composition = typeof s.composition === 'string' ? s.composition.replace(/\s+/g, ' ').trim().slice(0, 260) : ''; const joined = [direction, composition ? `COMPOSITION: ${composition}` : ''].filter(Boolean).join('. '); return joined ? { direction: joined } : {}; })(), ...(typeof s.transition === 'string' && (LIVE_OR_PLAIN as readonly string[]).includes(s.transition) ? { transition: s.transition } : {}) });
  }
  if (scenes.length < (strat ? 1 : input.reference ? Math.min(3, input.reference.sceneCount) : 3)) return null;
  // without a strategy it ends on one sign-off that carries the business's name; with one the model's own structure stands (first scene the hook, last the ending) and the business is present through the logo mark the writer is required to draw in the last scene
  let all: ConceptScene[];
  if (strat) all = scenes.map((scene, i) => ({ ...scene, role: i === 0 ? 'hook' as const : i === scenes.length - 1 ? 'closing' as const : 'scene' as const }));
  else {
    const body2 = scenes.filter((scene) => scene.role !== 'closing').slice(0, 6); const last = scenes.filter((scene) => scene.role === 'closing').at(-1);
    const closing: ConceptScene = { ...(last ?? { seconds: 3, subtext: '', items: [], visual: 'the business logo settles in the middle with a soft glow', photoId: null }), role: 'closing', headline: input.business.name, subtext: last?.subtext ?? '', items: [] };
    all = [...body2.map((scene, i) => ({ ...scene, role: i === 0 ? 'hook' as const : 'scene' as const })), closing];
  }
  // lengths: scaled to the length asked
  const total = all.reduce((sum, scene) => sum + scene.seconds, 0) || 1; const goal = Math.max(6, Math.min(60, input.seconds));
  // a live transition (whip, cross-zoom, light leak, slice) makes the next scene begin while the last is still leaving, so those seconds are played once, not twice: the scenes are sized so the VIDEO runs the length asked
  const floor = strat ? 0.6 : 1.5; const lengths = (g: number) => all.map((scene) => Math.max(floor, Math.round((scene.seconds / total) * g * 10) / 10));
  const overlap = (secs: number[]) => secs.reduce((sum, s, i) => sum + (i < secs.length - 1 && LIVE_TRANSITIONS.has(all[i].transition ?? '') ? Math.min(LIVE_OVERLAP, s / 2) : 0), 0);
  let aim = goal; let secs = lengths(aim);
  for (let pass = 0; pass < 6; pass += 1) { const played = secs.reduce((a, b) => a + b, 0) - overlap(secs); if (Math.abs(played - goal) < 0.15) break; aim += goal - played; secs = lengths(aim); }
  const fitted = all.map((scene, i) => ({ ...scene, seconds: secs[i] }));
  // the words on screen follow the shot's text decision, so the storyboard never says one thing and shows another: no words means none, a headline-only shot has no supporting line, and the sign-off always has words
  for (const scene of fitted) {
    const shot = scene.shot; if (!shot) continue;
    if (!strat && scene.role === 'closing' && (!shot.text || shot.text === 'none')) shot.text = scene.subtext ? 'headline_sub' : 'headline';
    // a scene that has no picture cannot be a picture composition
    if (strat && !scene.photoId && shot.composition && ['full_frame_image', 'detail_crop', 'centered_subject', 'split'].includes(shot.composition)) { shot.composition = 'graphic_motion'; delete shot.crop; delete shot.subject_at; if (shot.camera && shot.camera !== 'static') shot.camera = 'static'; }
    if (shot.text === 'none') { scene.headline = ''; scene.subtext = ''; scene.items = []; }
    else if (shot.text === 'headline' || shot.text === 'type_only') scene.subtext = '';
    else if (!shot.text) shot.text = scene.headline || scene.subtext ? (scene.subtext ? 'headline_sub' : 'headline') : 'none';
  }
  const ref = input.reference;
  const allowed = [input.request, input.business.name, input.business.type, input.business.location, input.business.services.join(' ')].join(' ');
  if (ref) {
    // follow the reference: its scene count and lengths, and for each scene the layout and motion it called for; and nothing of the reference's own words
    const wanted = Math.max(3, Math.min(8, ref.sceneCount));
    while (fitted.length > wanted) fitted.splice(fitted.length - 2, 1);
    fitted.forEach((scene, i) => {
      const spec = ref.motion.scenes[Math.min(i === fitted.length - 1 ? ref.motion.scenes.length - 1 : i, ref.motion.scenes.length - 1)];
      scene.seconds = Math.max(1.5, spec.seconds * (Math.max(6, Math.min(60, input.seconds)) / Math.max(1, ref.totalSeconds)));
      scene.transition = spec.transition;
      scene.direction = [spec.product ? `hero ${spec.product.size} at ${spec.product.placement.replace('_', ' ')}` : '', spec.headline ? `headline ${spec.headline.size} ${spec.headline.align} in the ${spec.headline.position}` : 'no headline', `camera ${spec.camera.replace('_', ' ')}`, spec.objectMotion && `object: ${spec.objectMotion}`, spec.textTiming && `words: ${spec.textTiming}`].filter(Boolean).join('; ');
      for (const key of ['headline', 'subtext'] as const) if (containsAvoided(scene[key], ref.avoid, allowed) || findReferenceText([{ where: key, text: scene[key] }], input.forbidden ?? ref.forbidden).length) scene[key] = '';
      scene.items = scene.items.filter((item) => !containsAvoided(item, ref.avoid, allowed) && !findReferenceText([{ where: 'item', text: item }], input.forbidden ?? ref.forbidden).length);
    });
  }
  const mood = (typeof body.mood === 'string' ? body.mood : '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { title: (typeof body.title === 'string' ? body.title : input.subject).replace(/\s+/g, ' ').trim().slice(0, 80), mood, palette: ref ? ref.visual.palette : cleanPalette((body as { palette?: unknown }).palette, `${mood} ${input.subject}`), scenes: fitted, seconds: Math.round((fitted.reduce((sum, scene) => sum + scene.seconds, 0) - overlap(secs)) * 10) / 10, ...(strat ? { strategy: strat } : {}) };
}

/** Every piece of a concept that is on screen or goes to the model that draws it, labelled by where it is. */
export const conceptSources = (concept: Concept): Array<{ where: string; text: string }> => [{ where: 'title', text: concept.title }, ...concept.scenes.flatMap((scene, i) => [{ where: `scene ${i + 1} headline`, text: scene.headline }, { where: `scene ${i + 1} subtext`, text: scene.subtext }, ...scene.items.map((item) => ({ where: `scene ${i + 1} item`, text: item })), { where: `scene ${i + 1} visual`, text: scene.visual }])];
/** The last resort when regenerating did not clear it: the offending words are taken out of the concept. */
export const redactConcept = (concept: Concept, forbidden: ReferenceText): Concept => ({ ...concept, title: redact(concept.title, forbidden), scenes: concept.scenes.map((scene) => ({ ...scene, headline: redact(scene.headline, forbidden), subtext: redact(scene.subtext, forbidden), items: scene.items.map((item) => redact(item, forbidden)).filter(Boolean), visual: redact(scene.visual, forbidden) })) });

/** One call to the model, with one retry if the reply is not usable. */
export async function writeConcept(input: ConceptInput, complete: Complete): Promise<Concept | null> {
  const b = input.business;
  const prompt = `THE BUSINESS\nName: ${b.name}\nType: ${b.type}\nPlace: ${b.location || 'not given'}\nVoice: ${b.tone || 'friendly and plain'}\n\nPHOTOS YOU MAY USE (by id)\n${input.photos.length ? input.photos.map((photo) => `${photo.id}: ${photo.label}${photo.shows ? ` (shows: ${photo.shows}${photo.use ? `; best use: ${photo.use}` : ''})` : ''}`).join('\n') : 'none'}\n\nTHE REQUEST\n"${input.request.slice(0, 400)}"\nSubject: ${input.subject}\nLength: ${input.seconds} seconds in total.${input.platform ? `\nPlatform: ${input.platform}` : ''}${input.style?.length ? `\nSTYLE THE OWNER ASKED FOR (follow it in the palette, pacing, type and motion): ${input.style.join(', ')}` : ''}${input.instructions?.length ? `\nOWNER'S INSTRUCTIONS: ${input.instructions.join('; ').slice(0, 300)}` : ''}`;
  const heroText = input.heroPhoto ? `\n\nHERO PHOTO: ${input.heroPhoto.id} (${input.heroPhoto.label}) is a realistic picture of the subject itself. It is the MAIN VISUAL of most scenes (at least three: set "photo" to its id). Each picture in the list says what it SHOWS and its best use: in one or two scenes, where another listed picture's content suits what that scene says, set "photo" to that picture instead, so the video does not show one picture five times (never use a picture marked skip, background or branding as a scene's main visual). The video is that photograph in motion, with close-up crops, slow camera moves, a light sweep and glow, depth and brand colour, and a few words. Do NOT describe the subject being built or drawn from shapes or illustrations; describe how the PHOTOGRAPH moves and is framed (wide push-in, macro crop of the top, slow pan across, a gleam of light crossing it; never a photo in a box or card).` : '';
  const ref = input.reference;
  const refText = ref ? `\n\nREFERENCE DESIGN (the owner showed a video to copy the LOOK and MOTION of; follow it closely, but every word, product and brand is this business's own and the reference's content is never copied)\nFormat ${ref.format}, ${ref.totalSeconds} seconds in exactly ${ref.sceneCount} scenes, ${ref.pacing} pace. Mood: ${ref.visual.mood}. Lighting: ${ref.visual.lighting}. Set: ${ref.visual.background}. Headline type: ${ref.visual.typography}. Negative space: ${ref.visual.negativeSpace}. Hierarchy: ${ref.visual.hierarchy}. Overall motion: ${ref.motion.overall}.\nThe colours are fixed by the reference and measured from its frames: backdrop ${ref.visual.colours?.background ?? ref.visual.palette.bgA}, floor ${ref.visual.colours?.floor ?? ref.visual.palette.bgB}, light ${ref.visual.colours?.glow ?? ref.visual.palette.glow}, hero ${ref.visual.colours?.hero ?? ref.visual.palette.toneA}, accent ${ref.visual.colours?.accent ?? ref.visual.palette.toneB}, words ${ref.visual.palette.text ?? 'ink'}; the light is ${ref.visual.colours?.temperature ?? 'warm'} (warmth ${ref.visual.colours?.warmth ?? 0}). Do not invent colours (you may leave "palette" out). Scenes in order:\n${ref.motion.scenes.map((scene, i) => `${i + 1}. ${scene.role}, ${Math.round(scene.seconds * 10) / 10}s, transition ${scene.transition}; ${scene.product ? `hero product ${scene.product.size}, ${scene.product.placement.replace('_', ' ')}` : 'no hero product'}; ${scene.headline ? `headline ${scene.headline.size} in the ${scene.headline.position}` : 'no headline'}; camera ${scene.camera.replace('_', ' ')}; ${scene.objectMotion || 'object builds or turns gently'}; ${scene.textTiming || 'words ease in'}`).join('\n')}\nThe hero of the scenes is the business's own product from the request (use its own photo only if the list above offers one). Never write any of these (they belong to the reference): ${[...(input.forbidden ?? ref.forbidden).brands, ...(input.forbidden ?? ref.forbidden).words, ...((input.forbidden ?? ref.forbidden).slogans ?? []).map((p) => `"${p}"`), ...ref.avoid].filter((w, i, all) => all.indexOf(w) === i).join(', ') || '(none)'}.` : '';
  const motionText = input.look === 'motion' ? `\n\nLOOK: MOTION GRAPHICS, like a clean product-explainer video or an offer post, NOT photographs with words over them. Invent each scene as a graphic idea and say in "visual" what it draws and how it moves: for example a swirl of the business's tasks around a head silhouette that resolves into the business, an app card whose fields type themselves in, a schedule that builds and a button that is clicked, a short list of crosses and ticks, a gradient offer card with a number that rolls up, an editorial headline with an italic accent word. Alternate a dark scene and a light scene. Set "photo" to null in every scene except at most one full-frame payoff scene, and only if a photograph is clearly the right visual. Use only numbers and claims that are in the request or the business's information.` : '';
  const strategyBlock = input.strategy ? `\n\nCREATIVE STRATEGY (decided first; authoritative)\n${strategyText(input.strategy)}${input.feedback?.length ? `\n\nYOUR LAST STORYBOARD DID NOT FOLLOW THIS STRATEGY. Fix exactly this:\n${input.feedback.map((item) => `- ${item}`).join('\n')}` : ''}` : '';
  const system = `${SCHEMA}\n${input.strategy ? STRATEGY_RULES : LEGACY_RULES}`.replace('PROPS', input.props.join(', ')) + refText + (input.strategy ? '' : input.look === 'motion' ? motionText : heroText);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { const parsed = JSON.parse(/\{[\s\S]*\}/.exec(await complete(system, prompt + strategyBlock))?.[0] ?? ''); const concept = sanitizeConcept(parsed, input); if (concept) return concept; } catch { /* try once more */ }
  }
  return null;
}

/** What the rest of the pipeline (caption, Library, storyboard, the code writer) needs, shaped like a planned video, from a concept. */
export function conceptPlan(concept: Concept, kit: BrandKit, photos: Array<{ id: string; label: string }>, size: '1080x1920' | '1080x1080' | '1920x1080' = '1080x1920'): PlanResult {
  const spec = validateSpec({ version: 1, size, fps: 30, audio: 'silent', brand: { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: kit.accent, textColor: '#FFFFFF' }, scenes: [{ seconds: 1, background: { type: 'solid', color: kit.primary }, elements: [] }] });
  if (!spec.ok) throw new Error(spec.error);
  const used = photos.filter((photo) => concept.scenes.some((scene) => scene.photoId === photo.id));
  const first = concept.scenes[0]; const last = concept.scenes.at(-1)!;
  return { spec: spec.spec, platform: 'instagram', summary: { durationSeconds: concept.seconds, size, sceneCount: concept.scenes.length, hook: first.headline || concept.title, cta: last.subtext || last.headline, scenes: concept.scenes.map((scene) => ({ role: scene.role === 'closing' ? 'cta' : scene.role === 'hook' ? 'hook' : 'detail', seconds: scene.seconds, headline: scene.headline, subtext: scene.subtext, items: scene.items, visual: scene.direction ? `${scene.visual}. LAYOUT AND MOTION: ${scene.direction}` : scene.visual, photo: null, photoId: scene.photoId, transition: scene.transition ?? 'fade', ...(scene.shot ? { shot: scene.shot } : {}) })), photosUsed: used.map((photo) => ({ id: photo.id, label: photo.label })) }, copy: { hook: first.headline || concept.title, caption: '', cta: last.subtext || last.headline, hashtags: [] }, notes: [], reasoning: concept.mood, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } } as unknown as PlanResult;
}
