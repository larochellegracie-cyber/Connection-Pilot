import { sizes, validateSpec, DESIGN_WIDTH, type Background, type CardElement, type Scene, type SceneElement, type SizeKey, type TransitionType, type VideoSpec } from './spec.js';
import type { BrandKit } from './templates.js';

/**
 * The planner's decisions in plain terms (what each scene says, which picture it shows, how it moves), and the fixed
 * layouts that turn them into a Standard Video plan. The AI only chooses among these options; positions, sizes, colours and
 * safe margins are set here, so every plan it produces can be drawn and looks consistent.
 */
export type SceneRole = 'hook' | 'product' | 'detail' | 'offer' | 'cta';
export type PlannedScene = { role: SceneRole; seconds: number; headline: string; subtext: string; /** an uploaded picture's id, or null for the brand background */ asset: string | null; photoStyle: 'full' | 'card'; layout: 'bottom' | 'center' | 'top'; animation: 'slide-up' | 'pop' | 'fade' | 'typewriter'; transition: TransitionType; /** which designed card shows this scene's idea when there is no photo */ visual?: Visual; /** short true phrases the card lists (services, benefits), at most 4 */ items?: string[] };
export const visualOptions = ['checklist', 'chat', 'calendar', 'quote', 'plan', 'chart', 'screen'] as const;
export type Visual = (typeof visualOptions)[number];
export type VideoPlan = { size: SizeKey; durationSeconds: number; scenes: PlannedScene[] };

export const animationOptions = ['slide-up', 'pop', 'fade', 'typewriter'] as const;
export const transitionOptions = ['fade', 'slide-left', 'push', 'zoom-through'] as const;
export const layoutOptions = ['bottom', 'center', 'top'] as const;

const hexToRgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6); const n = parseInt(full, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (hex: string, alpha: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${alpha})`; };
const lum = (hex: string) => { const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const linesFor = (text: string, size: number, width: number) => Math.max(1, Math.ceil((text.length * size * 0.64) / width));

/** Estimated height of wrapped text, in design units. */
const textBlock = (text: string, size: number, width: number, lineHeight = 1.15) => linesFor(text, size, width) * size * lineHeight;

const defaultVisuals: Visual[] = ['checklist', 'chat', 'calendar', 'quote', 'plan', 'screen'];

// ---- colour: a calm base from the brand, the brand's own colours as accents -----------------------------------------------------

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
/** `k` of the way from colour a to colour b. */
const mixHex = (a: string, b: string, k: number) => { const x = hexToRgb(a); const y = hexToRgb(b); return toHex(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k); };
const darken = (hex: string) => { let c = hex; for (let i = 0; i < 12 && lum(c) > 0.07; i += 1) c = mixHex(c, '#000000', 0.18); return c; };
const contrast = (a: string, b: string) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export type Palette = { dark: boolean; bgA: string; bgB: string; text: string; soft: string; accent: string; onAccent: string; glow: string; glow2: string; scrim: string };

/**
 * One calm base and the brand's other colours used sparingly. The base is the brand's own darkest colour (deepened a little if it is not dark
 * enough for white text), or a pale tint of the lightest for an all-light brand. The brand's main colour, when it is not the base, is the
 * highlight (bars, ticks, buttons, the calendar day); the remaining colour is a soft glow. A bright main colour is never darkened into a
 * muddy brown, and orange-and-blue brands are never blended into one gradient.
 */
export function paletteFor(kit: BrandKit): Palette {
  const colours = [kit.primary, kit.secondary, kit.accent].filter((colour, i, all) => all.indexOf(colour) === i);
  const darkest = [...colours].sort((a, b) => lum(a) - lum(b))[0];
  const dark = lum(darkest) <= 0.5;
  const bgA = dark ? (lum(darkest) <= 0.1 ? darkest : darken(darkest)) : mixHex(kit.primary, '#FFFFFF', 0.9);
  const bgB = dark ? mixHex(bgA, '#000000', 0.45) : mixHex(kit.primary, '#FFFFFF', 0.72);
  const text = dark ? '#FFFFFF' : '#0B1F44';
  const rest = colours.filter((colour) => colour !== darkest);
  const accent = [kit.primary, kit.accent, kit.secondary].filter((colour) => colour !== darkest).find((colour) => contrast(colour, bgA) >= 3) ?? rest[0] ?? kit.accent;
  const glow = rest.find((colour) => colour !== accent) ?? mixHex(accent, '#FFFFFF', 0.25);
  return { dark, bgA, bgB, text, soft: rgba(text, 0.78), accent, onAccent: lum(accent) > 0.5 ? '#0B1F44' : '#FFFFFF', glow, glow2: accent, scrim: dark ? bgA : '#0B1F44' };
}

// ---- the words: one clear headline, one quieter line ----------------------------------------------------------------------------

const MARGIN = 84; const COLUMN = DESIGN_WIDTH - MARGIN * 2;
const headSizeFor = (text: string, boost = 0) => (text.length <= 16 ? 112 : text.length <= 26 ? 100 : text.length <= 40 ? 88 : 76) + boost;
const HEAD_LINE = 1.08;
const slow = (delay: number, duration = 0.95) => ({ type: 'slide-up' as const, delay, duration, easing: 'expoOut' as const });

/**
 * A short accent line, then the headline (bold, large), then the supporting line (lighter, smaller, quieter). They arrive one after another.
 * Returns the elements and their height so the caller can place the block.
 */
function textStack({ headline, subtext, x, y, width, size, color, soft, accent, align = 'left', delay }: { headline: string; subtext: string; x: number; y: number; width: number; size: number; color: string; soft: string; accent: string; align?: 'left' | 'center'; delay: number }): { elements: SceneElement[]; height: number } {
  const headHeight = textBlock(headline, size, width, HEAD_LINE); const barX = align === 'center' ? x + width / 2 - 48 : x;
  const elements: SceneElement[] = [
    { type: 'shape', shape: 'roundRect', x: barX, y, width: 96, height: 10, fill: accent, radius: 5, animation: { type: 'grow', delay, duration: 0.7, easing: 'expoOut' } },
    { type: 'text', text: headline, x: align === 'center' ? x + width / 2 : x, y: y + 38, width, size, weight: 800, lineHeight: HEAD_LINE, color, align, animation: slow(delay + 0.2) },
  ];
  let height = 38 + headHeight;
  if (subtext) { elements.push({ type: 'text', text: subtext, x: align === 'center' ? x + width / 2 : x, y: y + 38 + headHeight + 24, width, size: 42, weight: 400, lineHeight: 1.25, color: soft, align, animation: slow(delay + 0.6, 0.9) }); height += 24 + textBlock(subtext, 42, width, 1.25); }
  return { elements, height };
}

type Ctx = { scene: PlannedScene; index: number; plan: VideoPlan; kit: BrandKit; pal: Palette; H: number; safeTop: number; safeBottom: number; flip: boolean; cards: boolean };

const gradientBg = (pal: Palette, angle: number): Background => ({ type: 'gradient', from: pal.bgA, to: pal.bgB, angle, shift: { from: mixHex(pal.bgA, pal.glow, pal.dark ? 0.16 : 0.1), to: pal.bgB } });

/** Soft colour behind the content: two large, very faint discs that drift slowly. Depth without clutter. */
const glows = (pal: Palette, H: number, flip: boolean): SceneElement[] => [
  { type: 'shape', shape: 'circle', x: flip ? -380 : 480, y: H * 0.02, width: 980, height: 980, fill: pal.glow, gradient: { from: rgba(pal.glow, pal.dark ? 0.34 : 0.26), to: rgba(pal.glow, 0) }, drift: { x: flip ? 50 : -50, y: 44 }, animation: { type: 'fade', duration: 1.4 } },
  { type: 'shape', shape: 'circle', x: flip ? 520 : -360, y: H * 0.54, width: 860, height: 860, fill: pal.glow2, gradient: { from: rgba(pal.glow2, pal.dark ? 0.26 : 0.2), to: rgba(pal.glow2, 0) }, drift: { x: flip ? -44 : 44, y: -50 }, animation: { type: 'fade', delay: 0.2, duration: 1.4 } },
];

/** The business name or logo, last so it is always on top. */
const brandBar = (): SceneElement => ({ type: 'brand', position: 'top', animation: { type: 'fade', delay: 0.15, duration: 0.8 } });

/** Full-bleed photo that zooms and pans slowly, with the words on a soft fade of the brand colour at the bottom. */
function heroScene({ scene, index, kit, pal, H, safeBottom, flip }: Ctx, photo: string): { background: Background; elements: SceneElement[] } {
  const stack = textStack({ headline: scene.headline, subtext: scene.subtext, x: MARGIN, y: 0, width: COLUMN, size: headSizeFor(scene.headline, index === 0 ? 8 : 0), color: '#FFFFFF', soft: 'rgba(255,255,255,0.82)', accent: pal.accent, delay: 0.5 });
  const top = Math.max(H * 0.5, safeBottom - 30 - stack.height);
  const lifted = stack.elements.map((el) => ({ ...el, y: (el as { y: number }).y + top }) as SceneElement);
  return {
    background: { type: 'image', asset: photo, kenBurns: { from: 1.02, to: 1.2, panX: flip ? [0.7, -0.7] : [-0.7, 0.7], panY: flip ? [-0.35, 0.35] : [0.35, -0.35] }, overlay: rgba(pal.scrim, 0.1) },
    elements: [{ type: 'shape', shape: 'rect', x: 0, y: H * 0.3, width: DESIGN_WIDTH, height: H * 0.7 + 2, fill: pal.scrim, gradient: { from: rgba(pal.scrim, 0), to: rgba(pal.scrim, 0.94) }, animation: { type: 'fade', delay: 0.1, duration: 1.1 } }, ...lifted],
  };
}

/** The photo in a rounded frame that floats slightly and zooms inside it; the words sit below, the whole block centred. */
function frameScene({ scene, pal, H, safeTop, safeBottom, flip }: Ctx, photo: string): { background: Background; elements: SceneElement[] } {
  const zoneTop = safeTop + 150; const zoneH = safeBottom - zoneTop;
  const stack = textStack({ headline: scene.headline, subtext: scene.subtext, x: MARGIN, y: 0, width: COLUMN, size: headSizeFor(scene.headline), color: pal.text, soft: pal.soft, accent: pal.accent, delay: 0.6 });
  const cardH = Math.max(360, Math.min(780, zoneH - stack.height - 64)); const y0 = zoneTop + Math.max(0, (zoneH - (cardH + 64 + stack.height)) * 0.55);
  const textTop = y0 + cardH + 64;
  return {
    background: gradientBg(pal, flip ? 200 : 150),
    elements: [...glows(pal, H, flip),
      { type: 'shape', shape: 'roundRect', x: MARGIN + 6, y: y0 + 30, width: COLUMN - 12, height: cardH, fill: '#000000', opacity: 0.3, radius: 48, float: 6, animation: { type: 'fade', delay: 0.15, duration: 0.9 } },
      { type: 'image', asset: photo, x: MARGIN, y: y0, width: COLUMN, height: cardH, fit: 'cover', radius: 44, drift: { from: 1.02, to: 1.18 }, float: 6, animation: { type: 'float-in', delay: 0.1, duration: 1.1, easing: 'expoOut' } },
      ...stack.elements.map((el) => ({ ...el, y: (el as { y: number }).y + textTop }) as SceneElement)],
  };
}

/** The photo bleeds off the top; a rounded brand-colour panel slides up over its lower edge and carries the words. */
function splitScene({ scene, pal, H, safeBottom, flip }: Ctx, photo: string): { background: Background; elements: SceneElement[] } {
  const photoH = H * 0.56; const panelTop = photoH - 30;
  const stack = textStack({ headline: scene.headline, subtext: scene.subtext, x: MARGIN, y: 0, width: COLUMN, size: headSizeFor(scene.headline), color: pal.text, soft: pal.soft, accent: pal.accent, delay: 0.7 });
  const textTop = panelTop + Math.max(72, (safeBottom - panelTop - stack.height) / 2); // centred in the part of the panel that is clear of the platforms' own buttons
  return {
    background: gradientBg(pal, 170),
    elements: [
      { type: 'image', asset: photo, x: 0, y: 0, width: DESIGN_WIDTH, height: photoH + 70, fit: 'cover', radius: 0, drift: { from: 1.03, to: flip ? 1.2 : 1.16 }, animation: { type: 'fade', duration: 0.9 } },
      { type: 'shape', shape: 'roundRect', x: 0, y: panelTop, width: DESIGN_WIDTH, height: H - panelTop + 80, fill: pal.bgA, radius: 64, animation: { type: 'slide-up', delay: 0.2, duration: 1.05, easing: 'expoOut' } },
      ...stack.elements.map((el) => ({ ...el, y: (el as { y: number }).y + textTop }) as SceneElement)],
  };
}

/** No photo: a headline block, then one floating card that shows the idea, all centred between the brand bar and the lower safe area. */
function demoScene({ scene, index, plan, kit, pal, H, safeTop, safeBottom, flip }: Ctx): { background: Background; elements: SceneElement[] } {
  const visual: Visual = scene.visual ?? (scene.role === 'hook' ? 'screen' : defaultVisuals[(index + (scene.role === 'offer' ? 4 : 0)) % defaultVisuals.length]);
  const zoneTop = safeTop + 150; const zoneH = safeBottom - zoneTop;
  const stack = textStack({ headline: scene.headline, subtext: visual === 'calendar' ? '' : scene.subtext, x: MARGIN, y: 0, width: COLUMN, size: headSizeFor(scene.headline) - 8, color: pal.text, soft: pal.soft, accent: pal.accent, delay: 0.15 });
  const gap = 72; const room = Math.max(380, zoneH - stack.height - gap);
  const others = plan.scenes.filter((other, i) => i !== index && other.role !== 'cta' && other.role !== 'hook').map((other) => other.headline);
  const items = (scene.items?.length ? scene.items : [scene.headline, ...others]).slice(0, 4);
  const intro = { type: 'float-in' as const, delay: 0.7, duration: 1.1, easing: 'expoOut' as const };
  const cw = 872; const cx = (DESIGN_WIDTH - cw) / 2;
  const title = ({ checklist: 'What you get', chat: kit.name, calendar: scene.subtext || 'Pick a day', quote: 'Your quote', plan: 'The plan', chart: 'Over time', screen: kit.name || 'Pilot' } as Record<Visual, string>)[visual];
  const heightFor = (max: number) => Math.min(max, room);
  const cardH = visual === 'screen' ? heightFor(800) : visual === 'calendar' ? heightFor(720) : visual === 'chat' ? heightFor(560) : heightFor(660);
  const y0 = zoneTop + Math.max(0, (zoneH - (stack.height + gap + cardH)) * 0.5);
  const cardY = y0 + stack.height + gap;

  const card: CardElement = visual === 'chat'
    ? { type: 'card', card: 'chat', x: cx, y: cardY, width: cw, height: cardH, title, lines: [`< Can you help with ${scene.headline.toLowerCase().replace(/[?!.]+$/, '')}?`, '> Yes, let’s get that sorted.', ...(items[1] ? [`< ${items[1]}?`] : [])].slice(0, 3), animation: intro, float: 7 }
    : visual === 'calendar' ? { type: 'card', card: 'calendar', x: cx, y: cardY, width: cw, height: cardH, title, highlight: 18, animation: intro, float: 7, tilt: flip ? 1.5 : -1.5 }
    : visual === 'quote' ? { type: 'card', card: 'quote', x: cx, y: cardY, width: cw, height: cardH, title, lines: items, button: 'Send', animation: intro, float: 7 }
    : visual === 'plan' ? { type: 'card', card: 'plan', x: cx, y: cardY, width: cw, height: cardH, title: scene.role === 'offer' ? 'Special' : title, lines: items, button: kit.name ? `Ask ${buttonLabel(kit.name)}`.slice(0, 28) : 'Ask us', animation: intro, float: 7 }
    : visual === 'chart' ? { type: 'card', card: 'chart', x: cx, y: cardY, width: cw, height: cardH, title, animation: intro, float: 7 }
    : visual === 'screen' ? { type: 'card', card: 'screen', x: (DESIGN_WIDTH - 500) / 2, y: cardY, width: 500, height: cardH, title, lines: items, button: 'Book', animation: intro, float: 6 }
    : { type: 'card', card: 'checklist', x: cx, y: cardY, width: cw, height: cardH, title, lines: items, animation: intro, float: 7 };

  return {
    background: gradientBg(pal, flip ? 200 : 150),
    elements: [...glows(pal, H, flip), ...stack.elements.map((el) => ({ ...el, y: (el as { y: number }).y + y0 }) as SceneElement),
      // a faded card behind the main one adds depth and moves a little against it (parallax)
      ...(visual === 'screen' ? [] : [{ type: 'card', card: 'blank', x: card.x + (flip ? 40 : -40), y: card.y + 44, width: card.width, height: card.height, tilt: flip ? -3 : 3, opacity: 0.16, drift: { x: flip ? -26 : 26, y: 14 }, animation: { type: 'float-in', delay: 0.5, duration: 1.1, easing: 'expoOut' } } as SceneElement]),
      card],
  };
}

/** An offer on an accent block that grows in, centred. */
function offerScene({ scene, pal, H, safeTop, safeBottom, flip }: Ctx): { background: Background; elements: SceneElement[] } {
  const size = Math.min(headSizeFor(scene.headline), 96); const inner = textBlock(scene.headline, size, COLUMN - 96, HEAD_LINE); const badgeH = inner + 150;
  const sub = scene.subtext ? textBlock(scene.subtext, 42, COLUMN, 1.25) + 40 : 0; const zoneTop = safeTop + 150; const zoneH = safeBottom - zoneTop;
  const y0 = zoneTop + Math.max(0, (zoneH - badgeH - sub) * 0.45);
  return {
    background: gradientBg(pal, flip ? 200 : 150),
    elements: [...glows(pal, H, flip),
      { type: 'shape', shape: 'roundRect', x: MARGIN, y: y0, width: COLUMN, height: badgeH, fill: pal.accent, radius: 56, float: 5, animation: { type: 'grow', delay: 0.2, duration: 0.9, easing: 'expoOut' } },
      { type: 'text', text: scene.headline, x: MARGIN + 48, y: y0 + 75, width: COLUMN - 96, size, weight: 800, lineHeight: HEAD_LINE, color: pal.onAccent, align: 'left', animation: slow(0.7) },
      ...(scene.subtext ? [{ type: 'text', text: scene.subtext, x: MARGIN, y: y0 + badgeH + 40, width: COLUMN, size: 42, weight: 400, lineHeight: 1.25, color: pal.soft, align: 'left', animation: slow(1.1, 0.9) } as SceneElement] : [])],
  };
}

/** The call to action: the photo (or a star) in a ring, the headline, and a button with the business name. */
/** The business name for a button: the part before " & " or " and " when the full name is long, so it fits on one line. */
export const buttonLabel = (name: string) => { const n = name.trim(); return n.length <= 22 ? n : n.split(/\s+(?:&|and)\s+/i)[0].trim().slice(0, 26); };

function ctaScene({ scene, kit, pal, H, safeTop, safeBottom, flip }: Ctx, photo: string | null): { background: Background; elements: SceneElement[] } {
  const size = headSizeFor(scene.headline) - 4; const headH = textBlock(scene.headline, size, COLUMN - 40, HEAD_LINE); const ring = 360; const buttonH = 124;
  const total = ring + 76 + headH + 76 + buttonH; const zoneTop = safeTop + 140; const zoneH = safeBottom - zoneTop;
  const y0 = zoneTop + Math.max(0, (zoneH - total) * 0.5);
  const headY = y0 + ring + 76; const buttonY = headY + headH + 76; const label = buttonLabel(kit.name ?? ''); const long = label.length > 14;
  return {
    background: gradientBg(pal, 165),
    elements: [...glows(pal, H, flip),
      ...(photo
        ? [{ type: 'shape', shape: 'circle', x: 540 - ring / 2 - 14, y: y0 - 14, width: ring + 28, height: ring + 28, fill: pal.accent, float: 5, animation: { type: 'pop', delay: 0.1, duration: 0.9, easing: 'backOut' } } as SceneElement,
           { type: 'image', asset: photo, x: 540 - ring / 2, y: y0, width: ring, height: ring, fit: 'cover', radius: ring / 2, drift: { from: 1.02, to: 1.16 }, float: 5, animation: { type: 'pop', delay: 0.15, duration: 0.9, easing: 'backOut' } } as SceneElement]
        : [{ type: 'icon', icon: 'star', x: 540 - ring / 4, y: y0 + ring / 4, size: ring / 2, color: pal.onAccent, disc: pal.accent, float: 8, animation: { type: 'pop', delay: 0.1, duration: 0.9, easing: 'backOut' } } as SceneElement]),
      { type: 'text', text: scene.headline, x: 540, y: headY, width: COLUMN - 40, size, weight: 800, lineHeight: HEAD_LINE, color: pal.text, align: 'center', animation: slow(0.5) },
      { type: 'shape', shape: 'roundRect', x: 220, y: buttonY, width: 640, height: buttonH, fill: pal.accent, radius: buttonH / 2, float: 4, animation: { type: 'slide-up', delay: 1.0, duration: 0.9, easing: 'expoOut' } },
      ...(label ? [{ type: 'text', text: label, x: 500, y: buttonY + (long ? 42 : 34), width: 440, size: long ? 38 : 48, weight: 800, color: pal.onAccent, align: 'center', animation: { type: 'fade', delay: 1.3, duration: 0.6 } } as SceneElement] : []),
      { type: 'icon', icon: 'arrow', x: 220 + 640 - 120, y: buttonY + 22, size: 80, color: pal.onAccent, drift: { x: 14, y: 0 }, animation: { type: 'fade', delay: 1.4, duration: 0.6 } }],
  };
}

/** Plain, clear text-only layout for formats too short for cards (wide and square videos): headline and supporting line, centred in the safe area. */
function textScene({ scene, pal, H, safeTop, safeBottom, flip }: Ctx): { background: Background; elements: SceneElement[] } {
  const stack = textStack({ headline: scene.headline, subtext: scene.subtext, x: MARGIN, y: 0, width: COLUMN, size: Math.min(headSizeFor(scene.headline), H < 800 ? 72 : 96), color: pal.text, soft: pal.soft, accent: pal.accent, delay: 0.3 });
  const top = safeTop + 80 + Math.max(0, (safeBottom - safeTop - 80 - stack.height) * 0.5);
  return { background: gradientBg(pal, flip ? 200 : 150), elements: [...glows(pal, H, flip), ...stack.elements.map((el) => ({ ...el, y: (el as { y: number }).y + top }) as SceneElement)] };
}

const calmTransition = (type: TransitionType): TransitionType => (type === 'fade' || type === 'push' || type === 'zoom-through' || type === 'slide-left' ? type : type === 'wipe' || type === 'slide-up' ? 'push' : 'zoom-through');

/**
 * Turns the planned scenes into a Standard Video plan. Every scene is composed by code from what it is (hook, detail, offer, call to action),
 * whether a matching photo exists, and where it sits in the video, so a video never repeats one look:
 *   with a photo   hook: full-bleed photo, slow zoom and pan, words on a soft fade of the brand colour
 *                  later photo scenes alternate: a floating framed photo / a photo that bleeds off the top with a panel sliding up / full-bleed again
 *   without a photo a headline block and one floating UI card (checklist, chat, calendar, quote, plan, phone screen) with a faded card behind it
 *   ending         the call to action: ringed photo (or a star), headline, button with an arrow
 * One calm base colour from the brand with its other colours as highlights and glows; everything is centred in the safe area, one idea per scene,
 * and the words arrive one after another with slow, settling motion. All positions are set here, so any plan the AI chooses can be drawn.
 */
export function buildSpec({ plan, kit, logoId, assetMissing = [] }: { plan: VideoPlan; kit: BrandKit; logoId: string | null; assetMissing?: string[] }): VideoSpec {
  const { width, height } = sizes[plan.size];
  const H = (height / width) * DESIGN_WIDTH;                         // the design height in 1080-wide units
  const safeTop = Math.min(250, H * 0.12); const safeBottom = H - Math.min(380, H * 0.2);
  const pal = paletteFor(kit);
  const last = plan.scenes.length - 1;
  const cards = H >= 900;                                            // tall videos have room for card layouts
  const photoStyles = ['frame', 'split', 'hero'] as const; let photoScenes = 0;
  const firstPhoto = plan.scenes.map((scene) => scene.asset).find((asset): asset is string => !!asset && !assetMissing.includes(asset)) ?? null;

  const scenes: Scene[] = plan.scenes.map((scene, index) => {
    const photo = scene.asset && !assetMissing.includes(scene.asset) ? scene.asset : null;
    const ctx: Ctx = { scene, index, plan, kit, pal, H, safeTop, safeBottom, flip: index % 2 === 1, cards };
    let built: { background: Background; elements: SceneElement[] };
    if (scene.role === 'cta' || index === last) built = ctaScene(ctx, photo ?? firstPhoto); // the ending reuses the video's first photo when it has none of its own
    else if (photo) {
      const style = index === 0 || !cards ? 'hero' : photoStyles[photoScenes % photoStyles.length]; photoScenes += index === 0 ? 0 : 1;
      built = style === 'frame' ? frameScene(ctx, photo) : style === 'split' ? splitScene(ctx, photo) : heroScene(ctx, photo);
    } else if (!cards) built = textScene(ctx);
    else if (scene.role === 'offer') built = offerScene(ctx);
    else built = demoScene(ctx);
    return { seconds: scene.seconds, background: built.background, elements: [...built.elements, brandBar()], ...(index < last ? { transition: { type: calmTransition(scene.transition), seconds: 0.6 } } : {}) };
  });

  const result = validateSpec({ version: 1, size: plan.size, fps: 30, brand: { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: pal.accent, textColor: pal.dark ? '#FFFFFF' : '#0B1F44', ...(logoId ? { logo: logoId } : {}) }, scenes, audio: 'silent' });
  if (!result.ok) throw new Error(result.error);
  return result.spec;
}
