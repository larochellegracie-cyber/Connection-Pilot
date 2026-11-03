/**
 * The scene plan for a Standard Video: plain data describing backgrounds, text, images, shapes, animation and
 * transitions. It is rendered by drawing frames (see draw.ts), so a video costs computing time, not a per-video fee.
 * All positions and sizes are in "design units" for a 1080-wide video and are scaled to the real size.
 */
export const DESIGN_WIDTH = 1080;
export const sizes = { '1080x1920': { width: 1080, height: 1920 }, '720x1280': { width: 720, height: 1280 }, '540x960': { width: 540, height: 960 }, '1080x1080': { width: 1080, height: 1080 }, '1920x1080': { width: 1920, height: 1080 } } as const;
export type SizeKey = keyof typeof sizes;

export const MAX_SECONDS = 60;
export const MAX_SCENES = 12;
export const MAX_ELEMENTS = 20;

export type Easing = 'linear' | 'easeOut' | 'easeInOut' | 'backOut' | 'expoOut';
export type Animation = { type: 'none' | 'fade' | 'slide-up' | 'slide-left' | 'pop' | 'typewriter' | 'slide-right' | 'grow' | 'float-in'; /** seconds into the scene */ delay?: number; duration?: number; easing?: Easing };

/** Slow zoom from..to, plus an optional pan: panX/panY go from..to as fractions (-1..1) of the spare picture around the frame. */
export type KenBurns = { from: number; to: number; panX?: [number, number]; panY?: [number, number] };

export type Background =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; /** colours the gradient drifts towards over the scene (a subtle shift) */ shift?: { from: string; to: string }; /** degrees, 0 = left to right, 90 = top to bottom */ angle?: number }
  | { type: 'image'; asset: string; kenBurns?: KenBurns; /** a colour laid over the photo so text stays readable, e.g. rgba(11,31,68,0.45) */ overlay?: string };

export type TextElement = { type: 'text'; text: string; x: number; y: number; width?: number; size: number; weight?: 400 | 700 | 800; color: string; align?: 'left' | 'center' | 'right'; lineHeight?: number; shadow?: boolean; box?: { color: string; padding: number; radius?: number }; animation?: Animation };
export type ImageElement = { type: 'image'; asset: string; x: number; y: number; width: number; height: number; fit?: 'cover' | 'contain'; radius?: number; float?: number; /** slow zoom of the picture inside its frame, e.g. 1 to 1.1 */ drift?: { from: number; to: number }; animation?: Animation };
export type ShapeElement = { type: 'shape'; shape: 'rect' | 'roundRect' | 'circle'; x: number; y: number; width: number; height: number; fill: string; /** a top-to-bottom fade from one colour to another (for scrims behind text); `fill` is then only the fallback */ gradient?: { from: string; to: string }; radius?: number; /** a see-through shape draws at this strength, 0 to 1 */ opacity?: number; float?: number; /** slow movement across the scene in design units: a light parallax against the photo */ drift?: { x: number; y: number }; animation?: Animation };
/** A simple drawn symbol (no pictures needed). */
export type IconElement = { type: 'icon'; icon: 'check' | 'arrow' | 'star' | 'spark'; x: number; y: number; size: number; color: string; /** a coloured disc drawn behind the symbol */ disc?: string; float?: number; drift?: { x: number; y: number }; animation?: Animation };
/** The business's name and logo, drawn as a bar. */
export type BrandElement = { type: 'brand'; position: 'top' | 'bottom'; animation?: Animation };
/**
 * A designed UI card, drawn from a few words (no pictures needed): the kind of floating card, phone screen or badge seen in a
 * product walkthrough. Cards carry only words Pilot got from the business or the owner; the numbers on a calendar grid are just
 * a calendar, and invoice or chart "values" are drawn as neutral bars, never as made-up figures or prices.
 *   checklist  title + ticked rows (lines)           chat      speech bubbles; a line starting "<" is the customer, ">" the business
 *   calendar   month grid with one day highlighted    quote     invoice or quote with rows (lines) and a button
 *   plan       plan card: title, optional value, ticked lines, button      stat   one big value with a label
 *   chart      rising bars with no figures           screen    a phone showing a header and list rows (lines)
 *   pill       a small badge                         blank     an empty card used as a layer behind another
 */
export const cardKinds = ['checklist', 'chat', 'calendar', 'quote', 'plan', 'stat', 'chart', 'screen', 'pill', 'blank'] as const;
export type CardKind = (typeof cardKinds)[number];
export type CardElement = { type: 'card'; card: CardKind; x: number; y: number; width: number; height: number; title?: string; lines?: string[]; value?: string; button?: string; /** the day highlighted on a calendar */ highlight?: number; tone?: 'light' | 'accent' | 'dark'; /** a slight turn in degrees */ tilt?: number; opacity?: number; /** gentle continuous bobbing, in design units */ float?: number; drift?: { x: number; y: number }; animation?: Animation };
export type SceneElement = TextElement | ImageElement | ShapeElement | IconElement | CardElement | BrandElement;

export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-up' | 'zoom' | 'wipe' | 'push' | 'zoom-through';
export type Scene = { seconds: number; background: Background; elements: SceneElement[]; /** how this scene gives way to the next one */ transition?: { type: TransitionType; seconds: number } };

export type Brand = { name: string; primary: string; secondary: string; accent: string; textColor: string; /** the asset id of the logo, when there is one */ logo?: string };

export type VideoSpec = { version: 1; size: SizeKey; fps: number; brand: Brand; scenes: Scene[]; /** Standard videos are silent: sound is added in the platform's own app. */ audio: 'silent' };

export type ValidationResult = { ok: true; spec: VideoSpec } | { ok: false; error: string };

const colorPattern = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const assetPattern = /^[A-Za-z0-9_-]{1,64}$/;
const easings: readonly Easing[] = ['linear', 'easeOut', 'easeInOut', 'backOut', 'expoOut'];
const animations = ['none', 'fade', 'slide-up', 'slide-left', 'pop', 'typewriter', 'slide-right', 'grow', 'float-in'] as const;
const transitions: readonly TransitionType[] = ['none', 'fade', 'slide-left', 'slide-up', 'zoom', 'wipe', 'push', 'zoom-through'];

const fail = (error: string): ValidationResult => ({ ok: false, error });
const num = (value: unknown, min: number, max: number, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
const color = (value: unknown, label: string): string => { if (typeof value !== 'string' || !colorPattern.test(value.trim())) throw new Error(`${label} must be a colour like #0B1F44.`); return value.trim(); };
const asset = (value: unknown, label: string): string => { if (typeof value !== 'string' || !assetPattern.test(value)) throw new Error(`${label} is not a valid image name.`); return value; };
const str = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\u0000/g, '').replace(/[\u2010-\u2015]/g, '-').slice(0, max) : '');

function animation(raw: unknown): Animation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const type = (animations as readonly string[]).includes(a.type as string) ? a.type as Animation['type'] : 'none';
  return { type, delay: num(a.delay, 0, 30, 0), duration: num(a.duration, 0.05, 5, 0.6), easing: (easings as readonly string[]).includes(a.easing as string) ? a.easing as Easing : 'easeOut' };
}

const floatOf = (f: any) => (f === undefined ? {} : { float: num(f, 0, 60, 0) });
const driftOf = (d: any) => (d && typeof d === 'object' ? { drift: { x: num(d.x, -400, 400, 0), y: num(d.y, -400, 400, 0) } } : {});
const pair = (v: any, fallback: [number, number]): [number, number] => (Array.isArray(v) ? [num(v[0], -1, 1, fallback[0]), num(v[1], -1, 1, fallback[1])] : fallback);

function element(raw: unknown): SceneElement {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const pos = { x: num(e.x, -2000, 4000, 0), y: num(e.y, -2000, 4000, 0) };
  switch (e.type) {
    case 'text': {
      const text = str(e.text, 300);
      if (!text.trim()) throw new Error('A text element has no text.');
      return { type: 'text', text, ...pos, width: e.width === undefined ? undefined : num(e.width, 40, 2000, 900), size: num(e.size, 12, 300, 64), weight: [400, 700, 800].includes(e.weight) ? e.weight : 700, color: color(e.color ?? '#FFFFFF', 'Text colour'), align: ['left', 'center', 'right'].includes(e.align) ? e.align : 'left', lineHeight: num(e.lineHeight, 0.9, 2, 1.15), shadow: e.shadow === true, box: e.box && typeof e.box === 'object' ? { color: color(e.box.color, 'Box colour'), padding: num(e.box.padding, 0, 200, 24), radius: num(e.box.radius, 0, 200, 24) } : undefined, animation: animation(e.animation) };
    }
    case 'image': return { type: 'image', asset: asset(e.asset, 'Image'), ...pos, width: num(e.width, 1, 4000, 300), height: num(e.height, 1, 4000, 300), fit: e.fit === 'contain' ? 'contain' : 'cover', radius: num(e.radius, 0, 2000, 0), ...floatOf(e.float), ...(e.drift ? { drift: { from: num(e.drift.from, 1, 2, 1), to: num(e.drift.to, 1, 2, 1.08) } } : {}), animation: animation(e.animation) };
    case 'shape': return { type: 'shape', shape: ['rect', 'roundRect', 'circle'].includes(e.shape) ? e.shape : 'rect', ...pos, width: num(e.width, 1, 4000, 100), height: num(e.height, 1, 4000, 100), fill: color(e.fill, 'Shape colour'), ...(e.gradient ? { gradient: { from: color(e.gradient.from, 'Gradient start'), to: color(e.gradient.to, 'Gradient end') } } : {}), radius: num(e.radius, 0, 2000, 24), ...(e.opacity === undefined ? {} : { opacity: num(e.opacity, 0, 1, 1) }), ...floatOf(e.float), ...driftOf(e.drift), animation: animation(e.animation) };
    case 'icon': return { type: 'icon', icon: ['check', 'arrow', 'star', 'spark'].includes(e.icon) ? e.icon : 'check', ...pos, size: num(e.size, 10, 1000, 80), color: color(e.color, 'Icon colour'), ...(e.disc ? { disc: color(e.disc, 'Icon background') } : {}), ...floatOf(e.float), ...driftOf(e.drift), animation: animation(e.animation) };
    case 'card': {
      const lines = Array.isArray(e.lines) ? e.lines.map((l: unknown) => str(l, 70).trim()).filter(Boolean).slice(0, 6) : [];
      return { type: 'card', card: (cardKinds as readonly string[]).includes(e.card) ? e.card : 'blank', ...pos, width: num(e.width, 40, 2000, 700), height: num(e.height, 40, 2000, 400), ...(e.title ? { title: str(e.title, 60).trim() } : {}), ...(lines.length ? { lines } : {}), ...(e.value ? { value: str(e.value, 20).trim() } : {}), ...(e.button ? { button: str(e.button, 30).trim() } : {}), ...(e.highlight ? { highlight: Math.round(num(e.highlight, 1, 31, 15)) } : {}), tone: ['accent', 'dark'].includes(e.tone) ? e.tone : 'light', ...(e.tilt ? { tilt: num(e.tilt, -12, 12, 0) } : {}), ...(e.opacity === undefined ? {} : { opacity: num(e.opacity, 0, 1, 1) }), ...floatOf(e.float), ...driftOf(e.drift), animation: animation(e.animation) };
    }
    case 'brand': return { type: 'brand', position: e.position === 'top' ? 'top' : 'bottom', animation: animation(e.animation) };
    default: throw new Error('An element in a scene is not recognised.');
  }
}

function background(raw: unknown): Background {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  if (b.type === 'gradient') return { type: 'gradient', from: color(b.from, 'Gradient start'), to: color(b.to, 'Gradient end'), ...(b.shift ? { shift: { from: color(b.shift.from, 'Gradient shift'), to: color(b.shift.to, 'Gradient shift') } } : {}), angle: num(b.angle, 0, 360, 90) };
  if (b.type === 'image') return { type: 'image', asset: asset(b.asset, 'Background image'), kenBurns: b.kenBurns ? { from: num(b.kenBurns.from, 1, 2, 1), to: num(b.kenBurns.to, 1, 2, 1.12), ...(b.kenBurns.panX ? { panX: pair(b.kenBurns.panX, [0, 0]) } : {}), ...(b.kenBurns.panY ? { panY: pair(b.kenBurns.panY, [0, 0]) } : {}) } : undefined, overlay: b.overlay === undefined ? undefined : color(b.overlay, 'Overlay') };
  return { type: 'solid', color: color(b.color ?? '#0B1F44', 'Background colour') };
}

/** Checks a scene plan from anywhere (the planner, a test, an API) and returns a clean copy, or says what is wrong. Never throws. */
export function validateSpec(raw: unknown): ValidationResult {
  try {
    const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
    if (!(input.size in sizes)) return fail(`The video size must be one of ${Object.keys(sizes).join(', ')}.`);
    if (!Array.isArray(input.scenes) || input.scenes.length === 0) return fail('The video needs at least one scene.');
    if (input.scenes.length > MAX_SCENES) return fail(`A video can have at most ${MAX_SCENES} scenes.`);
    const brandIn = (input.brand && typeof input.brand === 'object' ? input.brand : {}) as Record<string, any>;
    const brand: Brand = { name: str(brandIn.name, 80).trim(), primary: color(brandIn.primary ?? '#0B1F44', 'Brand colour'), secondary: color(brandIn.secondary ?? '#2454D6', 'Second brand colour'), accent: color(brandIn.accent ?? '#6C98FF', 'Accent colour'), textColor: color(brandIn.textColor ?? '#FFFFFF', 'Text colour'), ...(brandIn.logo ? { logo: asset(brandIn.logo, 'Logo') } : {}) };
    const scenes: Scene[] = input.scenes.map((scene: Record<string, any>) => {
      const elements = Array.isArray(scene?.elements) ? scene.elements : [];
      if (elements.length > MAX_ELEMENTS) throw new Error(`A scene can have at most ${MAX_ELEMENTS} elements.`);
      const tr = scene?.transition && typeof scene.transition === 'object' ? scene.transition : null;
      const seconds = num(scene?.seconds, 0.5, MAX_SECONDS, 3);
      return { seconds, background: background(scene?.background), elements: elements.map(element), ...(tr && (transitions as readonly string[]).includes(tr.type) && tr.type !== 'none' ? { transition: { type: tr.type as TransitionType, seconds: Math.min(num(tr.seconds, 0.1, 2, 0.4), seconds) } } : {}) };
    });
    const total = scenes.reduce((sum, scene) => sum + scene.seconds, 0);
    if (total > MAX_SECONDS) return fail(`A video can be at most ${MAX_SECONDS} seconds long (this one is ${Math.round(total)}).`);
    return { ok: true, spec: { version: 1, size: input.size, fps: Math.round(num(input.fps, 12, 30, 30)), brand, scenes, audio: 'silent' } };
  } catch (error) { return fail(error instanceof Error ? error.message : 'The scene plan is not valid.'); }
}

export const totalSeconds = (spec: VideoSpec) => spec.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
export const assetsNeeded = (spec: VideoSpec): string[] => [...new Set([...(spec.brand.logo ? [spec.brand.logo] : []), ...spec.scenes.flatMap((scene) => [...(scene.background.type === 'image' ? [scene.background.asset] : []), ...scene.elements.flatMap((el) => (el.type === 'image' ? [el.asset] : []))])])];
