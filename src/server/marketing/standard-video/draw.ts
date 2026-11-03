import type { Image, SKRSContext2D } from '@napi-rs/canvas';
import { DESIGN_WIDTH, sizes, type Animation, type Background, type Easing, type Scene, type SceneElement, type TextElement, type VideoSpec } from './spec.js';
import { FONT_FAMILY } from './fonts.js';
import { drawCard } from './cards.js';

/**
 * Draws one frame of a Standard Video at a moment in time. Pure drawing: the same plan and time always give the same
 * picture, so videos can be rendered in any order, tested frame by frame, and repeated exactly.
 */
export type Assets = Map<string, Image>;

export const easings: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2),
  backOut: (t) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  /** a quick start that settles very softly: the deliberate, unhurried feel for text and cards */
  expoOut: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
};
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function rgbOf(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (hex) { const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1].slice(0, 6); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
/** A colour k of the way from a to b (0..1): how a gradient shifts slowly through the brand colours. */
export function mix(a: string, b: string, k: number): string { const x = rgbOf(a); const y = rgbOf(b); return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], k))).join(',')})`; }

/** 0 before an animation starts, 1 once it is finished. */
export function progressOf(animation: Animation | undefined, time: number): number {
  if (!animation || animation.type === 'none') return 1;
  const raw = clamp01((time - (animation.delay ?? 0)) / (animation.duration ?? 0.6));
  return easings[animation.easing ?? 'easeOut'](raw);
}

export const sceneStarts = (spec: VideoSpec): number[] => { let at = 0; return spec.scenes.map((scene) => { const start = at; at += scene.seconds; return start; }); };

function colorStops(spec: VideoSpec, background: Background, width: number, height: number, ctx: SKRSContext2D, time: number, duration: number, assets: Assets) {
  if (background.type === 'solid') { ctx.fillStyle = background.color; ctx.fillRect(0, 0, width, height); return; }
  if (background.type === 'gradient') {
    const angle = ((background.angle ?? 90) * Math.PI) / 180;
    const cx = width / 2; const cy = height / 2; const reach = Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * height / 2;
    const gradient = ctx.createLinearGradient(cx - Math.cos(angle) * reach, cy - Math.sin(angle) * reach, cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
    const k = clamp01(time / Math.max(0.1, duration));
    gradient.addColorStop(0, background.shift ? mix(background.from, background.shift.from, k) : background.from); gradient.addColorStop(1, background.shift ? mix(background.to, background.shift.to, k) : background.to);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height); return;
  }
  const image = assets.get(background.asset);
  ctx.fillStyle = spec.brand.primary; ctx.fillRect(0, 0, width, height);
  if (!image) return;
  const zoom = background.kenBurns ? background.kenBurns.from + (background.kenBurns.to - background.kenBurns.from) * clamp01(time / Math.max(0.1, duration)) : 1;
  const scale = Math.max(width / image.width, height / image.height) * zoom;
  // the pan moves the picture across the spare area around the frame, so no empty edge ever shows
  const k = clamp01(time / Math.max(0.1, duration)); const ease = easings.easeInOut(k);
  const slackX = Math.max(0, image.width * scale - width) / 2; const slackY = Math.max(0, image.height * scale - height) / 2;
  const panX = background.kenBurns?.panX ? lerp(background.kenBurns.panX[0], background.kenBurns.panX[1], ease) : 0;
  const panY = background.kenBurns?.panY ? lerp(background.kenBurns.panY[0], background.kenBurns.panY[1], ease) : 0;
  ctx.drawImage(image, (width - image.width * scale) / 2 - panX * slackX, (height - image.height * scale) / 2 - panY * slackY, image.width * scale, image.height * scale);
  if (background.overlay) { ctx.fillStyle = background.overlay; ctx.fillRect(0, 0, width, height); }
}

function roundedRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); }

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const attempt = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(attempt).width > maxWidth) { lines.push(line); line = word; } else line = attempt;
    }
    lines.push(line);
  }
  return lines;
}

/** Applies the entrance animation's movement and fade to everything drawn inside `draw`. */
function animated(ctx: SKRSContext2D, animation: Animation | undefined, time: number, s: number, bounds: { x: number; y: number; w: number; h: number }, draw: (progress: number) => void) {
  const p = progressOf(animation, time);
  if (p <= 0) return;
  ctx.save();
  const type = animation?.type ?? 'none';
  ctx.globalAlpha *= type === 'none' || type === 'typewriter' || type === 'grow' ? 1 : clamp01(p * 1.6);
  if (type === 'slide-up') ctx.translate(0, (1 - p) * 56 * s);
  if (type === 'slide-left') ctx.translate((1 - p) * 140 * s, 0);
  if (type === 'slide-right') ctx.translate(-(1 - p) * 140 * s, 0);
  if (type === 'float-in') { const k = 0.94 + 0.06 * p; ctx.translate(0, (1 - p) * 48 * s); ctx.translate(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2); ctx.scale(k, k); ctx.translate(-(bounds.x + bounds.w / 2), -(bounds.y + bounds.h / 2)); }
  if (type === 'grow') { ctx.translate(bounds.x, bounds.y); ctx.scale(Math.max(0.001, p), 1); ctx.translate(-bounds.x, -bounds.y); }
  if (type === 'pop') { const k = 0.7 + 0.3 * p; ctx.translate(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2); ctx.scale(k, k); ctx.translate(-(bounds.x + bounds.w / 2), -(bounds.y + bounds.h / 2)); }
  draw(p);
  ctx.restore();
}

function drawText(ctx: SKRSContext2D, el: TextElement, time: number, s: number) {
  ctx.font = `${el.weight ?? 700} ${el.size * s}px ${FONT_FAMILY}, sans-serif`;
  const maxWidth = (el.width ?? 900) * s;
  const lines = wrap(ctx, el.text, maxWidth);
  const lineHeight = el.size * s * (el.lineHeight ?? 1.15);
  const widest = Math.min(maxWidth, Math.max(...lines.map((line) => ctx.measureText(line).width)));
  const align = el.align ?? 'left';
  const left = align === 'center' ? el.x * s - widest / 2 : align === 'right' ? el.x * s - widest : el.x * s;
  const bounds = { x: left, y: el.y * s, w: widest, h: lineHeight * lines.length };
  animated(ctx, el.animation, time, s, bounds, (p) => {
    if (el.box) { const pad = el.box.padding * s; ctx.fillStyle = el.box.color; roundedRect(ctx, bounds.x - pad, bounds.y - pad * 0.6, bounds.w + pad * 2, bounds.h + pad * 1.2, (el.box.radius ?? 24) * s); ctx.fill(); }
    ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillStyle = el.color;
    if (el.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 18 * s; ctx.shadowOffsetY = 4 * s; }
    let remaining = el.animation?.type === 'typewriter' ? Math.floor(el.text.length * p) : Infinity;
    lines.forEach((line, index) => {
      const shown = remaining === Infinity ? line : line.slice(0, Math.max(0, remaining));
      remaining = remaining === Infinity ? Infinity : remaining - line.length - 1;
      const lineWidth = ctx.measureText(line).width;
      const x = align === 'center' ? bounds.x + (bounds.w - lineWidth) / 2 : align === 'right' ? bounds.x + bounds.w - lineWidth : bounds.x;
      if (shown) ctx.fillText(shown, x, bounds.y + index * lineHeight);
    });
  });
}

function drawIcon(ctx: SKRSContext2D, icon: 'check' | 'arrow' | 'star' | 'spark', x: number, y: number, size: number, color: string) {
  const cx = x + size / 2; const cy = y + size / 2; const r = size / 2;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = size * 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (icon === 'check') { ctx.moveTo(cx - r * 0.5, cy + r * 0.02); ctx.lineTo(cx - r * 0.12, cy + r * 0.4); ctx.lineTo(cx + r * 0.52, cy - r * 0.4); ctx.stroke(); }
  else if (icon === 'arrow') { ctx.moveTo(cx - r * 0.55, cy); ctx.lineTo(cx + r * 0.5, cy); ctx.moveTo(cx + r * 0.1, cy - r * 0.42); ctx.lineTo(cx + r * 0.52, cy); ctx.lineTo(cx + r * 0.1, cy + r * 0.42); ctx.stroke(); }
  else if (icon === 'star') { for (let i = 0; i < 10; i += 1) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rad = i % 2 ? r * 0.4 : r * 0.9; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } ctx.closePath(); ctx.fill(); }
  else { for (let i = 0; i < 8; i += 1) { const a = (i * Math.PI) / 4; ctx.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25); ctx.lineTo(cx + Math.cos(a) * r * (i % 2 ? 0.55 : 0.9), cy + Math.sin(a) * r * (i % 2 ? 0.55 : 0.9)); } ctx.stroke(); }
  ctx.restore();
}

/** Gentle continuous motion: elements with `float` bob slowly once they are on screen, each on its own rhythm. */
function drawElement(ctx: SKRSContext2D, spec: VideoSpec, el: SceneElement, time: number, s: number, width: number, height: number, assets: Assets, duration: number) {
  const amount = 'float' in el ? el.float ?? 0 : 0;
  if (!amount) return drawElementBase(ctx, spec, el, time, s, width, height, assets, duration);
  const phase = ((el as { x: number }).x + (el as { y: number }).y) / 170; const w = (time * Math.PI * 2) / 4.2 + phase;
  ctx.save(); ctx.translate(Math.cos(w * 0.8) * amount * 0.35 * s, Math.sin(w) * amount * s);
  drawElementBase(ctx, spec, el, time, s, width, height, assets, duration);
  ctx.restore();
}

function drawElementBase(ctx: SKRSContext2D, spec: VideoSpec, el: SceneElement, time: number, s: number, width: number, height: number, assets: Assets, duration: number) {
  if (el.type === 'text') return drawText(ctx, el, time, s);
  if (el.type === 'shape') {
    const k = clamp01(time / Math.max(0.1, duration));
    const b = { x: (el.x + (el.drift?.x ?? 0) * k) * s, y: (el.y + (el.drift?.y ?? 0) * k) * s, w: el.width * s, h: el.height * s };
    return animated(ctx, el.animation, time, s, b, () => { if (el.opacity !== undefined) ctx.globalAlpha *= el.opacity; if (el.gradient && el.shape === 'circle') { const g = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, 0, b.x + b.w / 2, b.y + b.h / 2, b.w / 2); g.addColorStop(0, el.gradient.from); g.addColorStop(1, el.gradient.to); ctx.fillStyle = g; } else if (el.gradient) { const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h); g.addColorStop(0, el.gradient.from); g.addColorStop(1, el.gradient.to); ctx.fillStyle = g; } else ctx.fillStyle = el.fill; if (el.shape === 'circle') { ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2); } else roundedRect(ctx, b.x, b.y, b.w, b.h, el.shape === 'rect' ? 0 : (el.radius ?? 24) * s); ctx.fill(); });
  }
  if (el.type === 'card') {
    const k = clamp01(time / Math.max(0.1, duration));
    const b = { x: (el.x + (el.drift?.x ?? 0) * k) * s, y: (el.y + (el.drift?.y ?? 0) * k) * s, w: el.width * s, h: el.height * s };
    return animated(ctx, el.animation, time, s, b, () => {
      if (el.tilt) { ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.rotate((el.tilt * Math.PI) / 180); ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2)); }
      drawCard(ctx, el, b, s, Math.max(0, time - (el.animation?.delay ?? 0)), spec.brand.accent);
    });
  }
  if (el.type === 'icon') {
    const k = clamp01(time / Math.max(0.1, duration));
    const x = (el.x + (el.drift?.x ?? 0) * k) * s; const y = (el.y + (el.drift?.y ?? 0) * k) * s; const size = el.size * s;
    return animated(ctx, el.animation, time, s, { x, y, w: size, h: size }, () => {
      if (el.disc) { ctx.fillStyle = el.disc; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill(); }
      drawIcon(ctx, el.icon, x, y, size, el.color);
    });
  }
  if (el.type === 'image') {
    const image = assets.get(el.asset); if (!image) return;
    const b = { x: el.x * s, y: el.y * s, w: el.width * s, h: el.height * s };
    return animated(ctx, el.animation, time, s, b, () => {
      ctx.save(); roundedRect(ctx, b.x, b.y, b.w, b.h, (el.radius ?? 0) * s); ctx.clip();
      const zoom = el.drift ? lerp(el.drift.from, el.drift.to, clamp01(time / Math.max(0.1, duration))) : 1;
      const scale = (el.fit === 'contain' ? Math.min : Math.max)(b.w / image.width, b.h / image.height) * zoom;
      ctx.drawImage(image, b.x + (b.w - image.width * scale) / 2, b.y + (b.h - image.height * scale) / 2, image.width * scale, image.height * scale);
      ctx.restore();
    });
  }
  // brand bar: logo and business name
  // kept clear of the areas Instagram, TikTok and Facebook cover with their own buttons and captions
  const barHeight = 150 * s; const designHeight = height / s; const y = (el.position === 'top' ? Math.min(250, designHeight * 0.12) : designHeight - 150 - Math.min(380, designHeight * 0.2)) * s;
  animated(ctx, el.animation, time, s, { x: 0, y, w: width, h: barHeight }, () => {
    const logo = spec.brand.logo ? assets.get(spec.brand.logo) : undefined;
    const x = 84 * s;
    if (logo) {
      // the logo sits on a soft white chip so it reads on any photo or colour; the name is not repeated next to it
      const h = 64 * s; const w = Math.min((logo.width / logo.height) * h, 300 * s); const pad = 14 * s;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 22 * s; ctx.shadowOffsetY = 6 * s; ctx.fillStyle = '#FFFFFF'; roundedRect(ctx, x, y + (barHeight - h) / 2 - pad, w + pad * 2, h + pad * 2, 22 * s); ctx.fill(); ctx.restore();
      ctx.drawImage(logo, x + pad, y + (barHeight - h) / 2, w, h);
    } else if (spec.brand.name) {
      ctx.font = `800 ${44 * s}px ${FONT_FAMILY}, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = spec.brand.textColor; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 12 * s; ctx.fillText(spec.brand.name, x, y + barHeight / 2, 880 * s);
    }
  });
}

function drawScene(ctx: SKRSContext2D, spec: VideoSpec, scene: Scene, localTime: number, width: number, height: number, assets: Assets) {
  const s = width / DESIGN_WIDTH;
  colorStops(spec, scene.background, width, height, ctx, localTime, scene.seconds, assets);
  for (const el of scene.elements) drawElement(ctx, spec, el, localTime, s, width, height, assets, scene.seconds);
}

/** Draws the picture at `time` seconds into the canvas. */
export function drawFrame(ctx: SKRSContext2D, spec: VideoSpec, assets: Assets, time: number): void {
  const { width, height } = sizes[spec.size];
  const starts = sceneStarts(spec);
  const last = spec.scenes.length - 1;
  let index = last;
  for (let i = 0; i <= last; i += 1) if (time < starts[i] + spec.scenes[i].seconds) { index = i; break; }
  const scene = spec.scenes[index]; const local = Math.max(0, time - starts[index]);
  ctx.save(); ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = spec.brand.primary; ctx.fillRect(0, 0, width, height);
  const next = spec.scenes[index + 1]; const tr = scene.transition;
  const into = tr && next ? (local - (scene.seconds - tr.seconds)) / tr.seconds : -1; // 0..1 while the next scene arrives
  if (!tr || !next || into <= 0) { drawScene(ctx, spec, scene, local, width, height, assets); ctx.restore(); return; }
  const p = easings.easeInOut(clamp01(into));
  ctx.save();
  if (tr.type === 'push') ctx.translate(-p * width * 0.35, 0);
  else if (tr.type === 'zoom-through') { ctx.translate(width / 2, height / 2); ctx.scale(1 + 0.1 * p, 1 + 0.1 * p); ctx.translate(-width / 2, -height / 2); }
  drawScene(ctx, spec, scene, local, width, height, assets);
  ctx.restore();
  ctx.save();
  if (tr.type === 'fade') ctx.globalAlpha = p;
  else if (tr.type === 'slide-left') ctx.translate((1 - p) * width, 0);
  else if (tr.type === 'slide-up') ctx.translate(0, (1 - p) * height);
  else if (tr.type === 'zoom') { ctx.globalAlpha = p; ctx.translate(width / 2, height / 2); ctx.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p); ctx.translate(-width / 2, -height / 2); }
  else if (tr.type === 'push') { ctx.translate((1 - p) * width, 0); }
  else if (tr.type === 'zoom-through') { ctx.globalAlpha = p; ctx.translate(width / 2, height / 2); ctx.scale(0.92 + 0.08 * p, 0.92 + 0.08 * p); ctx.translate(-width / 2, -height / 2); }
  else if (tr.type === 'wipe') { ctx.beginPath(); ctx.rect(0, 0, width * p, height); ctx.clip(); }
  drawScene(ctx, spec, next, 0, width, height, assets);
  ctx.restore(); ctx.restore();
}
