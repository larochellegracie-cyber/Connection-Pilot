import type { ContentItem, VideoConcept } from '@/lib/marketing-content.js';
import { validateSpec, type Brand, type Scene, type SizeKey, type VideoSpec } from './spec.js';

export type BrandKit = { name: string; primary: string; secondary: string; accent: string; logoUrl: string | null };

const defaults = { primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF' };

const hexToRgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6); const n = parseInt(full, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const luminance = (hex: string) => { const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const rgba = (hex: string, alpha: number) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${alpha})`; };

/** Reads up to three colours out of free text such as "navy #0B1F44, bright blue #2454D6". Anything else falls back to the Connection Pilot palette. */
export function parseBrandColors(text: string | null | undefined): { primary: string; secondary: string; accent: string } {
  const found = [...new Set((text?.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? []).map((value) => value.toUpperCase()))];
  return { primary: found[0] ?? defaults.primary, secondary: found[1] ?? defaults.secondary, accent: found[2] ?? defaults.accent };
}

export const sizeFor = (platform: ContentItem['platform']): SizeKey => (platform === 'linkedin' ? '1080x1080' : '1080x1920');

function brandFor(kit: BrandKit, hasLogo: boolean | string): Brand {
  return { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: kit.accent, textColor: luminance(kit.primary) > 0.55 ? '#0B1F44' : '#FFFFFF', ...(hasLogo ? { logo: typeof hasLogo === 'string' ? hasLogo : 'logo' } : {}) };
}

const transitionCycle = ['slide-left', 'fade', 'zoom', 'wipe'] as const;
const shorten = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);
const linesFor = (text: string, size: number, width = 900) => Math.max(1, Math.ceil((text.length * size * 0.52) / width));

/**
 * Turns a video plan (hook, scenes with on-screen text, call to action) into a Standard Video plan using the business's
 * brand colours, logo and photos. This is plain code, not an AI call, so building the plan costs nothing.
 */
export function specFromConcept({ concept, item, kit, hasLogo, photos = [] }: { concept: VideoConcept; item: Pick<ContentItem, 'platform' | 'hook' | 'cta'>; kit: BrandKit; hasLogo: boolean | string; photos?: string[] }): VideoSpec {
  const brand = brandFor(kit, hasLogo);
  const textColor = brand.textColor;
  const sceneIn = concept.scenes.filter((scene) => scene.onScreenText.trim() || scene.visual.trim());
  const scenes: Scene[] = sceneIn.map((scene, index) => {
    const headline = shorten((scene.onScreenText.trim() || (index === 0 ? item.hook : scene.visual)).trim(), 90);
    const sub = shorten((scene.voiceover ?? '').trim(), 140);
    const size = headline.length > 45 ? 84 : 104;
    const top = 640;
    const photo = photos.length ? photos[index % photos.length] : null;
    const elements: Scene['elements'] = [
      { type: 'brand', position: 'top', animation: { type: 'fade', duration: 0.5 } },
      { type: 'shape', shape: 'roundRect', x: 90, y: top - 50, width: 150, height: 14, fill: kit.accent, radius: 7, animation: { type: 'fade', delay: 0.05, duration: 0.4 } },
      { type: 'text', text: headline, x: 90, y: top, width: 900, size, weight: 800, color: textColor, align: 'left', shadow: !!photo, animation: { type: 'slide-up', delay: 0.15, duration: 0.6 } },
      ...(sub ? [{ type: 'text' as const, text: sub, x: 90, y: top + linesFor(headline, size) * size * 1.15 + 50, width: 860, size: 46, weight: 400 as const, color: textColor, align: 'left' as const, shadow: !!photo, animation: { type: 'fade' as const, delay: 0.7, duration: 0.6 } }] : []),
    ];
    return {
      seconds: Math.min(6, Math.max(2.5, scene.seconds)),
      background: photo ? { type: 'image', asset: photo, kenBurns: { from: 1, to: 1.12 }, overlay: rgba(kit.primary, 0.55) } : { type: 'gradient', from: index % 2 ? kit.secondary : kit.primary, to: index % 2 ? kit.primary : kit.secondary, angle: index % 2 ? 45 : 135 },
      elements, transition: { type: transitionCycle[index % transitionCycle.length], seconds: 0.45 },
    };
  });
  const cta = shorten(item.cta.trim() || 'Get in touch today', 80);
  scenes.push({
    seconds: 3.5,
    background: { type: 'gradient', from: kit.secondary, to: kit.primary, angle: 160 },
    elements: [
      { type: 'brand', position: 'top', animation: { type: 'fade', duration: 0.4 } },
      { type: 'text', text: cta, x: 540, y: 700, width: 860, size: 92, weight: 800, color: textColor, align: 'center', animation: { type: 'pop', delay: 0.1, duration: 0.6, easing: 'backOut' } },
      { type: 'shape', shape: 'roundRect', x: 240, y: 1180, width: 600, height: 120, fill: kit.accent, radius: 60, animation: { type: 'slide-up', delay: 0.5, duration: 0.5 } },
      ...(kit.name ? [{ type: 'text' as const, text: kit.name, x: 540, y: 1212, width: 560, size: 48, weight: 800 as const, color: luminance(kit.accent) > 0.5 ? '#0B1F44' : '#FFFFFF', align: 'center' as const, animation: { type: 'fade' as const, delay: 0.7, duration: 0.4 } }] : []),
    ],
  });
  const result = validateSpec({ version: 1, size: sizeFor(item.platform), fps: 30, brand, scenes, audio: 'silent' });
  if (!result.ok) throw new Error(result.error);
  return result.spec;
}

/** A short plan used to check that rendering works end to end. */
export function sampleSpec(kit: BrandKit, hasLogo: boolean): VideoSpec {
  const brand = brandFor(kit, hasLogo);
  const result = validateSpec({ version: 1, size: '720x1280', fps: 30, brand, audio: 'silent', scenes: [
    { seconds: 2, background: { type: 'gradient', from: kit.primary, to: kit.secondary, angle: 135 }, transition: { type: 'slide-left', seconds: 0.4 }, elements: [{ type: 'brand', position: 'top', animation: { type: 'fade' } }, { type: 'text', text: 'Standard Video works', x: 60, y: 560, width: 600, size: 76, weight: 800, color: brand.textColor, animation: { type: 'slide-up', delay: 0.1 } }] },
    { seconds: 2, background: { type: 'gradient', from: kit.secondary, to: kit.primary, angle: 45 }, elements: [{ type: 'brand', position: 'top' }, { type: 'text', text: 'Made on our own servers, with no per-video fee.', x: 360, y: 560, width: 560, size: 52, weight: 700, color: brand.textColor, align: 'center', animation: { type: 'pop', delay: 0.1 } }] },
  ] });
  if (!result.ok) throw new Error(result.error);
  return result.spec;
}
