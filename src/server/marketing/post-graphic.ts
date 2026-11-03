import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { PostImage } from '@/lib/marketing-content.js';
import { drawFrame } from './standard-video/draw.js';
import { loadAssets } from './standard-video/assets.js';
import { pickLogo } from './standard-video/business-assets.js';
import { paletteFor } from './standard-video/plan-layout.js';
import { ffmpegAvailable } from './standard-video/ffmpeg.js';
import { ensureFonts } from './standard-video/fonts.js';
import { videoLink } from './standard-video/jobs.js';
import { renderVideoSpec } from './standard-video/render.js';
import { validateSpec, sizes, type VideoSpec } from './standard-video/spec.js';
import { getMediaStorage, type MediaStorage } from './standard-video/storage.js';
import type { BrandKit } from './standard-video/templates.js';
import { loadBrandKit } from './store.js';

/**
 * The visual for a post. Two cases, both drawn on this server with the Standard Video engine (no image service, no cost):
 *  - the business has a suitable photo of its own: the photo is used as it is (never altered or redrawn), with the business's
 *    name, the post's headline and its call to action animated over it and a slow zoom;
 *  - it has none: a branded animated graphic made only of the business's colours, logo and name, the post's words, and
 *    simple shapes. Nothing in it can be mistaken for a real place, vehicle, crew, product or result.
 * Each is made as a short silent MP4 (the motion) and, for the graphic, a still of its finished frame (what shows while it
 * loads and wherever a still is needed). If the video encoder is unavailable, the still alone is used.
 */
const SECONDS = 4;
const rgba = (hex: string, alpha: number) => { const h = hex.replace('#', ''); const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6); const n = parseInt(full, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; };
const luminance = (hex: string) => { const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].reduce((sum, v, i) => { const c = v / 255; return sum + [0.2126, 0.7152, 0.0722][i] * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); }, 0); };
/** The bundled font has no glyph for the non-breaking hyphen and other fancy punctuation, so they are swapped for plain ones. */
const plain = (value: string) => value.replace(/[‐-―−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const shorten = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/** Each variation changes the colour direction and layout, so "make a new picture" gives something visibly different. */
const VARIANTS = 3;
const variantOf = (variant: number) => ((variant % VARIANTS) + VARIANTS) % VARIANTS;

export function visualSpec({ kit, hook, cta, variant = 0, hasLogo, photoAsset, artwork = false, aiImage = false }: { kit: BrandKit; hook: string; cta: string; variant?: number; hasLogo: string | false; photoAsset?: string; /** the picture is Pilot's own generated artwork: shown with a lighter wash so it reads as the design */ artwork?: boolean; /** the picture is a realistic AI-generated image: a gentle deep-brand wash keeps the words readable */ aiImage?: boolean }): VideoSpec {
  const v = variantOf(variant);
  const onPhoto = !!photoAsset;
  const textColor = onPhoto ? '#FFFFFF' : luminance(kit.primary) > 0.55 ? '#0B1F44' : '#FFFFFF';
  const headline = shorten(plain(hook) || plain(kit.name), 90);
  const size = headline.length > 60 ? 76 : headline.length > 38 ? 92 : 108;
  const ctaFull = plain(cta);
  const firstSentence = ctaFull.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? ctaFull; // the whole first sentence, never cut off mid-way when it fits
  const ctaText = shorten(firstSentence.length <= 100 ? firstSentence : ctaFull, 100);
  const align = v === 1 ? 'center' : 'left';
  const x = align === 'center' ? 540 : 90;
  const result = validateSpec({
    version: 1, size: '1080x1080', fps: 30, audio: 'silent',
    brand: { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: kit.accent, textColor, ...(hasLogo ? { logo: hasLogo } : {}) },
    scenes: [{
      seconds: SECONDS,
      background: onPhoto
        ? { type: 'image', asset: photoAsset, kenBurns: { from: 1, to: 1.12 }, overlay: aiImage ? rgba(paletteFor(kit).bgA, 0.4) : artwork ? rgba(paletteFor(kit).bgA, 0.22) : rgba(kit.primary, 0.5) }
        : { type: 'gradient', from: v === 2 ? kit.secondary : kit.primary, to: v === 2 ? kit.primary : kit.secondary, angle: [135, 160, 45][v] },
      elements: [
        { type: 'brand', position: 'top', animation: { type: 'fade', duration: 0.5 } },
        // decorative shapes only: nothing here can be mistaken for a real place, vehicle or product
        ...(onPhoto ? [] : [
          { type: 'shape' as const, shape: 'circle' as const, x: 620, y: 520, width: 640, height: 640, fill: rgba(kit.accent, 0.2), animation: { type: 'fade' as const, duration: 1.2 } },
          { type: 'shape' as const, shape: 'circle' as const, x: -160, y: 760, width: 420, height: 420, fill: rgba(kit.accent, 0.13), animation: { type: 'fade' as const, delay: 0.3, duration: 1.2 } },
        ]),
        { type: 'shape', shape: 'roundRect', x: align === 'center' ? 465 : 90, y: 330, width: 150, height: 14, fill: kit.accent, radius: 7, animation: { type: 'fade', delay: 0.1, duration: 0.4 } },
        { type: 'text', text: headline, x, y: 380, width: 900, size, weight: 800, color: textColor, align, shadow: onPhoto, animation: { type: 'slide-up', delay: 0.2, duration: 0.7 } },
        ...(ctaText ? [{ type: 'text' as const, text: ctaText, x, y: 860, width: 900, size: 44, weight: 700 as const, color: textColor, align: align as 'left' | 'center', shadow: onPhoto, box: { color: rgba(kit.accent, onPhoto ? 0.7 : 0.33), padding: 26, radius: 40 }, animation: { type: 'pop' as const, delay: 0.9, duration: 0.6, easing: 'backOut' as const } }] : []),
      ],
    }],
  });
  if (!result.ok) throw new Error(result.error);
  return result.spec;
}

const STILL_AT = SECONDS - 0.05; // after every entrance has finished

async function drawStill(spec: VideoSpec, assets: Parameters<typeof drawFrame>[2]): Promise<Buffer> {
  await ensureFonts();
  const { createCanvas } = await import('@napi-rs/canvas');
  const { width, height } = sizes[spec.size];
  const canvas = createCanvas(width, height);
  drawFrame(canvas.getContext('2d'), spec, assets, STILL_AT);
  return canvas.toBuffer('image/jpeg', 90);
}

/** Renders the animation to an MP4 in this business's own storage. Returns its link, or null if it could not be made (the still is then used alone). */
async function renderMotion(tenantId: string, spec: VideoSpec, assets: Parameters<typeof drawFrame>[2], storage: MediaStorage): Promise<string | null> {
  if (!ffmpegAvailable()) return null;
  const id = randomUUID();
  let temp: string | null = null;
  try {
    temp = await storage.makeTempDir(id);
    const out = path.join(temp, 'post.mp4');
    await renderVideoSpec({ spec, assets, outPath: out, timeoutMs: 60_000 });
    await storage.saveVideo(tenantId, id, out);
    return videoLink(id);
  } catch (error) {
    console.error('post motion failed', error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 200) : 'unknown');
    return null;
  } finally { if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined); }
}

/** The id of the business's own photo in a `/api/marketing/assets/<id>` link. */
const photoIdOf = (photo: PostImage) => photo.url.split('/').pop() ?? '';

export async function createPostVisual({ tenantId, hook, cta, variant = 0, photo, motion = true, storage = getMediaStorage(), kit, generatedKind = 'artwork' }: { generatedKind?: 'ai-image' | 'artwork'; tenantId: string; hook: string; cta: string; variant?: number; /** the business's own photo to use as it is */ photo?: PostImage | null; motion?: boolean; storage?: MediaStorage; kit?: BrandKit }): Promise<PostImage> {
  const brandKit = kit ?? await loadBrandKit(tenantId);
  const logoId = pickLogo(await storage.listAssets(tenantId), brandKit.logoUrl);
  const photoAsset = photo ? photoIdOf(photo) : undefined;
  const { assets, missing } = await loadAssets({ ids: [...(logoId ? [logoId] : []), ...(photoAsset ? [photoAsset] : [])], tenantId, storage, logoUrl: brandKit.logoUrl });
  const usePhoto = !!photo && !!photoAsset && !missing.includes(photoAsset);
  const spec = visualSpec({ kit: brandKit, hook, cta, variant, hasLogo: logoId && assets.has(logoId) ? logoId : false, photoAsset: usePhoto ? photoAsset : undefined, artwork: photo?.source === 'generated' && generatedKind !== 'ai-image', aiImage: photo?.source === 'generated' && generatedKind === 'ai-image' });
  const link = motion ? await renderMotion(tenantId, spec, assets, storage) : null;
  const withMotion = link ? { motion: link } : {};
  if (usePhoto) return { ...photo!, ...withMotion }; // the original photo stays exactly as uploaded; the motion is a separate presentation of it
  const id = randomUUID();
  await storage.putImage(tenantId, id, await drawStill(spec, assets));
  return { url: `/api/marketing/media/images/${id}.jpg`, prompt: `Branded graphic made from the business’s colours, logo and the post’s words. Layout #${variantOf(variant)}`, source: 'graphic', ...withMotion };
}
