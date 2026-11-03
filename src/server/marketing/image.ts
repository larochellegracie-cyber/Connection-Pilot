import { createOpenAI } from '@ai-sdk/openai';
import { generateImage } from 'ai';
import { getSecret } from '#airo/secrets';
import { platformSpecs, type PlatformId, type PostImage } from '@/lib/marketing-content.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BusinessBrief } from './store.js';
import { rankAssets } from './standard-video/business-assets.js';
import { getMediaStorage, type MediaStorage } from './standard-video/storage.js';
import { createPostVisual } from './post-graphic.js';
import { createDesignedPost, type DesignedPost } from './post-design/index.js';
import { ensureGeneratedVisual, type PictureMakerLike } from './generated-visual.js';
import { loadBrandKit } from './store.js';
import { renderCodePost, wantsCodePost } from './code-video/post.js';

export type Picture = { bytes: Uint8Array };
/** Makes one picture from a description. It is injectable so tests never spend anything. */
export type PictureMaker = (prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536') => Promise<Picture>;

const MODEL = 'gpt-image-1-mini';

/** Uses the same OpenAI connection Pilot already writes with. Nothing else is needed. */
export const openAiPictureMaker: PictureMaker = async (prompt, size) => {
  const apiKey = getSecret('OPENAI_API_KEY');
  if (!apiKey || typeof apiKey !== 'string') throw new Error('The picture connection is not set up.');
  const result = await generateImage({ model: createOpenAI({ apiKey }).image(MODEL), prompt, size, providerOptions: { openai: { quality: 'medium', output_format: 'jpeg' } } });
  return { bytes: result.image.uint8Array };
};

/** Used only when the owner explicitly asked for an AI-generated picture, so people may appear if they asked for them. */
const EXPLICIT_RULES = 'Create one polished picture for a small business\'s social media post, as the business owner asked. There must be NO text, letters, numbers, logos, signs or watermarks anywhere in the picture. If people are asked for, show them naturally and do not depict any real person or recognisable brand. Do not make a before-and-after comparison, and do not show specific results, prices or claims about the work. Natural light, uncluttered composition, a clear focal point.';

const sizeFor = (platform: PlatformId) => (platform === 'instagram' ? '1024x1024' : platform === 'tiktok' ? '1024x1536' : '1536x1024') as '1024x1024' | '1536x1024' | '1024x1536';

/** Pilot never makes pictures that could mislead customers about the business's real work. */
const RULES = 'Create one polished marketing picture for a small business\'s social media post. There must be NO text, letters, numbers, logos, signs or watermarks anywhere in the picture. Do not show any people at all, no faces and no workers, so it cannot suggest a particular crew or person. Do not make a before-and-after comparison, and do not show specific results, prices or claims about the work. Natural light, uncluttered composition, a clear focal point with some calm space.';

/** The full description sent to the image maker: the safety rules, the business, the topic and the scene Pilot described. */
export function pictureDescription({ brief, platform, topic, scene, hook, variation, explicit }: { brief: Pick<BusinessBrief, 'businessName' | 'businessType' | 'location' | 'services' | 'brandVoice'>; platform: PlatformId; topic: string; scene: string; hook: string; variation?: boolean; explicit?: boolean }): string {
  const about = [brief.businessType && `a ${brief.businessType.toLowerCase()} business`, brief.location && `in ${brief.location}`].filter(Boolean).join(' ');
  const mood = brief.brandVoice?.tone ? `Mood: ${brief.brandVoice.tone.toLowerCase()}.` : '';
  return [explicit ? EXPLICIT_RULES : RULES, `This is for ${brief.businessName}${about ? `, ${about}` : ''}.`, brief.services.length ? `Their services include ${brief.services.slice(0, 5).join(', ')}.` : '', `The post is about: ${topic || hook}.`, `The picture: ${scene}`, mood, `It will be shown on ${platformSpecs[platform].label}.`, variation ? 'Use a clearly different composition and viewpoint from a typical first attempt.' : ''].filter(Boolean).join(' ');
}

/**
 * Re-saves the picture as a web-sized JPEG, so whatever the maker returns is a safe, ordinary image of a sensible size.
 * The image library can't read some large PNGs straight from memory, so it reads this one from a short-lived private file.
 */
export async function toJpeg(bytes: Uint8Array): Promise<Buffer> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-picture-'));
  try {
    const file = path.join(dir, 'picture');
    await writeFile(file, bytes, { mode: 0o600 });
    const image = await loadImage(file);
    const scale = Math.min(1, 1536 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toBuffer('image/jpeg', 88);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Makes the picture for a post, keeps it in the business's own storage, and returns where it is. */
export async function createPostImage({ tenantId, brief, platform, topic, scene, hook, variation = false, explicit = false, storage = getMediaStorage(), make = openAiPictureMaker }: { tenantId: string; brief: Parameters<typeof pictureDescription>[0]['brief'] & Partial<Pick<BusinessBrief, 'businessType'>>; platform: PlatformId; topic: string; scene: string; hook: string; variation?: boolean; /** the owner explicitly asked for an AI-generated picture */ explicit?: boolean; storage?: MediaStorage; make?: PictureMaker }): Promise<PostImage> {
  const sceneText = (scene || '').trim() || `A calm, appealing scene that shows what ${brief.businessName} does, without people or text.`;
  const picture = await make(pictureDescription({ brief, platform, topic, scene: sceneText, hook, variation, explicit }), sizeFor(platform));
  const id = randomUUID();
  await storage.putImage(tenantId, id, await toJpeg(picture.bytes));
  return { url: `/api/marketing/media/images/${id}.jpg`, prompt: sceneText, source: 'generated' };
}

/** The id of a picture Pilot made (never an uploaded photo, which belongs to the owner and is never deleted with a post). */
export const imageIdOf = (image: PostImage | null | undefined) => (image?.source === 'photo' ? null : image?.url.match(/\/([A-Za-z0-9_-]+)\.jpg$/)?.[1] ?? null);

/** What to write in the server log when a picture fails: enough to fix it, never a key. */
export const pictureFailure = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message.replace(/sk-[\w-]+/g, '[key]').replace(/\s+/g, ' ').slice(0, 240)}` : 'unknown');

const wordsOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 2);

/**
 * The owner's own photo that suits this post, if there is one. A photo suits when its label, description or tags match what the
 * post is about. Words every photo of this business would share (its name and kind of business, such as "pool" for a pool
 * company) don't count, so a closing photo is not used for an opening post. Returns null when nothing suits.
 */
export async function findSuitablePhoto({ tenantId, brief, topic, hook, storage = getMediaStorage(), exclude }: { tenantId: string; brief: Pick<BusinessBrief, 'businessName' | 'businessType'>; topic: string; hook: string; storage?: MediaStorage; /** a photo id not to pick again */ exclude?: string }): Promise<PostImage | null> {
  const assets = (await storage.listAssets(tenantId)).filter((asset) => asset.kind !== 'logo' && asset.id !== exclude && !asset.tags.includes('generated')); // only the owner's own pictures; generated ones are reused by their own step
  if (!assets.length) return null;
  const shared = new Set([...wordsOf(brief.businessName), ...wordsOf(brief.businessType)]);
  const isShared = (word: string) => shared.has(word) || shared.has(word.replace(/(es|s)$/, '')) || shared.has(`${word}s`); // "pools" is as common to a pool company as "pool"
  const about = [...wordsOf(`${topic} ${hook}`)].filter((word) => !isShared(word)).join(' ');
  // the same word-matching Pilot already uses to pick a photo for a video
  const best = rankAssets(assets, about).find((asset) => asset.matched.length > 0 && asset.score >= 2);
  return best ? { url: `/api/marketing/assets/${best.id}`, prompt: best.label, source: 'photo' } : null;
}

/**
 * A post's visual. The business's own photo comes first (used as it is, with branded text and motion over it). With no suitable
 * photo, Pilot makes a branded animated graphic from the business's colours, logo and the post's words. Neither calls any image
 * service. `createPostImage` (OpenAI) is only for when the owner explicitly asks for an AI-generated picture.
 * With `variation`, a new look is made (another photo if there is one, otherwise another graphic layout).
 */
export async function choosePostImage(input: { /** how realistic images are made (tests give a fake) and the text model for the art-direction step */ make?: PictureMakerLike; complete?: (system: string, prompt: string) => Promise<string>; tenantId: string; brief: Pick<BusinessBrief, 'businessName' | 'businessType'>; topic: string; hook: string; cta?: string; exclude?: string; variant?: number; motion?: boolean; storage?: MediaStorage; /** make a designed post (clean layout, brand type, the photo placed properly) instead of the plain graphic; `message` is what the owner said (a story, a font, a style) */ designed?: { /** write and draw the post as code first when the request is styled, creative or reference-based (only the live Pilot flow sets this) */ codePost?: boolean; message?: string; facts?: { services?: string[]; sellingPoints?: string[] }; onDesign?: (design: DesignedPost) => void } }): Promise<PostImage> {
  let photo = await findSuitablePhoto(input);
  // artwork Pilot generated earlier is found like any photo (its label carries the subject), but it is shown as artwork, not as the owner's own picture
  let generatedKind: 'ai-image' | 'artwork' = 'artwork';
  if (photo) { const meta = await (input.storage ?? getMediaStorage()).getAssetMeta(input.tenantId, photo.url.split('/').pop() ?? '').catch(() => null); if (meta?.tags.includes('generated')) { photo = { ...photo, source: 'generated' }; generatedKind = meta.tags.includes('ai-image') ? 'ai-image' : 'artwork'; } }
  // no photo of the owner's suits the post: generate brand-coloured artwork for its subject (free, drawn here, kept in Photos as "Made by Pilot") and use it as the picture
  if (!photo) {
    const visual = await ensureGeneratedVisual({ tenantId: input.tenantId, subject: input.topic || input.hook, kit: await loadBrandKit(input.tenantId), business: { businessName: input.brief.businessName, businessType: input.brief.businessType, location: (input.brief as { location?: string }).location, services: (input.brief as { services?: string[] }).services }, storage: input.storage, make: input.make, complete: input.complete }).catch((error) => { console.error('generated visual failed', error instanceof Error ? error.name : 'unknown'); return null; });
    if (visual) { photo = { url: `/api/marketing/assets/${visual.asset.id}`, prompt: visual.asset.label, source: 'generated' }; generatedKind = visual.kind; }
  }
  // a designed post: the photo chosen above (the owner's own first, a generated realistic one only when that was made) on a clean layout; with nothing to show, a clean type-led card
  if (input.designed) {
    try {
      const usable = photo && !(photo.source === 'generated' && generatedKind === 'artwork') ? photo : null; // brand artwork is not a photo of the product, so it is not placed as one
      // a styled, creative or reference-based post is written and drawn as code first (the photograph with type, light and layout drawn around it); the designed post below is the way back
      if (input.designed.codePost && wantsCodePost(input.designed.message ?? '')) {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-post-'));
        try {
          const { aiCompleteCode, aiCompleteWithImages } = await import('./service.js');
          const storage = input.storage ?? getMediaStorage();
          const assetId = usable?.url.split('/').pop();
          const coded = await renderCodePost({ tenantId: input.tenantId, message: input.designed.message ?? '', subject: input.topic || input.hook, hook: input.hook, cta: input.cta ?? '', kit: await loadBrandKit(input.tenantId), photo: usable && assetId ? { id: assetId, label: usable.prompt } : null, storage, workDir: dir, complete: aiCompleteCode, completeWithImages: aiCompleteWithImages });
          if (coded.ok) { const id = randomUUID(); await storage.putImage(input.tenantId, id, coded.bytes); console.info(JSON.stringify({ event: 'marketing-post.code-post', ok: true, score: coded.score ?? null })); return { url: `/api/marketing/media/images/${id}.jpg`, prompt: `Custom-coded post: ${input.hook}`.slice(0, 400), source: 'graphic' }; }
          console.warn(JSON.stringify({ event: 'marketing-post.code-post', ok: false, reason: coded.reason }));
        } catch (error) { console.warn(JSON.stringify({ event: 'marketing-post.code-post', ok: false, reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown' })); } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
      }
      const design = await createDesignedPost({ tenantId: input.tenantId, hook: input.hook, cta: input.cta ?? '', topic: input.topic, businessName: input.brief.businessName, businessType: input.brief.businessType, photo: usable, message: input.designed.message ?? '', facts: input.designed.facts, storage: input.storage, exclude: input.exclude, variant: input.variant });
      input.designed.onDesign?.(design); if (!design.issues.length) return design.image; console.warn(JSON.stringify({ event: 'marketing-post.design-issues', issues: design.issues }));
    } catch (error) { console.warn(JSON.stringify({ event: 'marketing-post.design-failed', reason: error instanceof Error ? error.message.slice(0, 160) : 'unknown' })); }
  }
  return createPostVisual({ tenantId: input.tenantId, hook: input.hook, cta: input.cta ?? '', variant: input.variant, photo, motion: input.motion, storage: input.storage, generatedKind });
}

/** The id of a post's animated version, if it has one. */
export const motionIdOf = (image: PostImage | null | undefined) => image?.motion?.match(/\/([A-Za-z0-9_-]+)\.mp4$/)?.[1] ?? null;

/** Removes what Pilot made for a post: a drawn or generated still, and its animated version. The owner's own uploaded photos are never touched. */
export async function removePostMedia(tenantId: string, image: PostImage | null | undefined, storage: MediaStorage = getMediaStorage()): Promise<void> {
  const still = imageIdOf(image); const motion = motionIdOf(image);
  if (still) await storage.deleteImage(tenantId, still).catch(() => undefined);
  if (motion) await storage.deleteVideo(tenantId, motion).catch(() => undefined);
}
