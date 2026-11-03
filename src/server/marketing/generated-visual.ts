import { createHash } from 'node:crypto';
import { isChatConfigured } from '@/lib/chatbot/chat-config.js';
import { stems, subjectTerms } from './asset-selection.js';
import { ensureGeneratedArt, generatedArtEnabled, themeFor } from './generated-art.js';
import { saveBusinessImage } from './standard-video/business-assets.js';
import { getMediaStorage, type AssetMeta, type MediaStorage } from './standard-video/storage.js';
import type { BrandKit } from './standard-video/templates.js';

/**
 * A picture for a subject none of the owner's own photos fits. In order of preference:
 *   1. a realistic, AI-generated image (OpenAI's image model, the same OpenAI key Pilot already writes with), when the owner has switched it on;
 *   2. Pilot's free generated artwork (see generated-art.ts), if the image could not be made or the daily limit is reached;
 *   3. (the callers') plain branded graphic, if neither is available.
 * The owner's own and website photos always come first and are never replaced.
 *
 * Realistic images are described to the image model by a short art-direction step (one text call), then made once per subject and kept in the
 * business's Photos labelled "AI image – <subject>" with the tags "generated" and "ai-image". The same subject reuses it, so a business does not pay
 * twice for the same picture. Rules sent with every request: no text, logos, signs or watermarks; no people or faces; no before-and-after, prices,
 * results or claims; it must look like a plausible, tidy, professional scene, never a specific real company's property.
 *
 * Cost: about 1 to 2 US cents per image at the quality used (medium, 1024x1536, gpt-image-1-mini); see OpenAI's current pricing. Set
 * PILOT_REALISTIC_IMAGES=on to enable it (it is off by default), and PILOT_REALISTIC_IMAGES_PER_DAY (default 10) to cap images per business per day.
 */
export const realisticImagesEnabled = () => (process.env.PILOT_REALISTIC_IMAGES ?? 'off').trim().toLowerCase() === 'on' && isChatConfigured();
const perDay = () => Math.max(0, Number(process.env.PILOT_REALISTIC_IMAGES_PER_DAY ?? 10) || 0);

export type GeneratedVisual = { asset: AssetMeta; reused: boolean; kind: 'ai-image' | 'artwork'; /** why a realistic image was not used, when it was wanted */ fallbackReason?: string };
export type PictureMakerLike = (prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536') => Promise<{ bytes: Uint8Array }>;
/** The town or region from a location, never a street address or number (an address in the instructions could appear in the picture, and does not belong in a saved description). */
export const placeOf = (location?: string) => (location ?? '').split(/[,;\n]/).map((part) => part.trim()).filter((part) => part && !/\d/.test(part)).slice(-2).join(', ');

export type BusinessFacts = { businessName: string; businessType: string; location?: string; services?: string[] };

// ---- describing the picture ---------------------------------------------------------------------------------------------------

/** A plain colour name for a brand colour, so the image model can use the palette without hex codes. */
export function colourName(hex: string): string {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2; const d = max - min;
  if (d < 0.08) return l > 0.8 ? 'white' : l < 0.2 ? 'near-black' : 'grey';
  const hue = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const name = hue < 15 || hue >= 345 ? 'red' : hue < 40 ? 'orange' : hue < 65 ? 'yellow' : hue < 160 ? 'green' : hue < 200 ? 'teal' : hue < 255 ? 'blue' : hue < 290 ? 'purple' : 'pink';
  return `${l < 0.28 ? 'deep ' : l > 0.7 ? 'light ' : ''}${name}`;
}

/** What no generated picture ever contains, whatever its style. */
const SAFETY = 'There must be NO text, letters, numbers, logos, signs or watermarks anywhere, and no lettering, names or branding on vehicles, uniforms, doors, buildings, packaging, tools or equipment: every surface that could carry a name is plain and blank. Show NO people, faces, hands or workers (and no human-like characters). No before-and-after comparison, no prices, results or claims. It must not depict a specific real company\'s property or vehicle.';
/** Added only when the picture is meant to look like a photograph. */
const PHOTO = 'It must look like a real photograph, an ordinary, tidy, believable scene, not an illustration or CGI.';
/** Pictures are photographic unless the strategy chose another treatment. */
export const isPhotographic = (style?: string) => !style || /photo|cinematic|realistic|documentary|editorial/i.test(style) && !/illustrat|cartoon|3d|render|anim|vector|paint|stylis|stylized|surreal/i.test(style);

/** A fallback scene when the art-direction step is not available: the subject in the business's setting, in simple plain words. */
export const plainScene = (subject: string, business: BusinessFacts, style?: string) => `${isPhotographic(style) ? 'A realistic photograph' : `An image in this treatment: ${style}.`} It shows ${subject.trim()} for a ${business.businessType.toLowerCase() || 'local'} business${business.location ? ` in ${business.location}` : ''}.`;

/** The full prompt for the image model. */
export function realisticPrompt({ scene, business, kit, platformNote = 'vertical 2:3', style, mood }: { scene: string; business: BusinessFacts; kit: BrandKit; platformNote?: string; /** the film's mood and palette (a spooky night, a bright morning ...): it decides the colour of the picture */ mood?: string; /** the visual treatment the strategy chose (photographic when absent) */ style?: string }): string {
  const palette = [kit.primary, kit.secondary, kit.accent].map(colourName).filter((name, i, all) => all.indexOf(name) === i).join(', ');
  const photo = isPhotographic(style);
  return [
    `A ${photo ? 'professional commercial photograph' : 'striking advertising image'} for a ${business.businessType.toLowerCase() || 'local'} business${business.location ? ` in ${business.location}` : ''}.`,
    scene.trim(),
    photo ? `Photographic style${style ? ` (${style})` : ''}: high-end editorial and advertising photography, true-to-life colour, crisp detail, a single clear focal point.` : `Visual treatment: ${style}. Polished, high quality and intentional, the look of a professional advertising campaign, a single clear focal point.`,
    mood ? `Mood and colour: ${mood}. This decides the palette and light of the whole picture; the brand colours (${palette}) may appear only as small accents, never as the dominant colour.` : `Colour: let ${palette} appear naturally in the scene (surfaces, objects, light), kept calm and not overpowering.`,
    `Composition: ${platformNote}; keep the lower third calm and uncluttered so text can be placed over it.`,
    SAFETY, photo ? PHOTO : '',
  ].filter(Boolean).join(' ');
}

const ART_DIRECTOR = 'You are an art director for advertising imagery. Reply with ONE or TWO sentences describing a single image for the business and subject given, in the visual treatment named (a photograph when none is named): the place or set, the main object, the light, the time of day or season, the camera view or framing, and, when the treatment is not photographic, the style of the rendering. Be concrete and visual. If the subject involves a person, worker or hands, describe only the place and objects (the open door, the tools, the vehicle) with nobody in the frame. Describe vehicles, uniforms, doors and equipment as plain and unmarked. Do not mention text, logos, people, prices, street addresses or numbers, or the business name. Do not use brand names.';

export type CompleteText = (system: string, prompt: string) => Promise<string>;

/** One short art-direction step: a vivid, specific scene for the subject. Falls back to a plain description if it fails. */
export async function describeScene({ subject, business, complete, look, style }: { subject: string; business: BusinessFacts; complete?: CompleteText; look?: string; style?: string }): Promise<string> {
  if (!complete) return plainScene(subject, business, style);
  try {
    const text = (await complete(ART_DIRECTOR, `Business: ${business.businessType || 'local business'}${business.location ? ` in ${business.location}` : ''}. Services: ${(business.services ?? []).slice(0, 5).join(', ') || 'not listed'}. Subject of the post or video: ${subject}.${look ? ` The video it is for: ${look}.` : ''}${style ? ` Visual treatment: ${style}.` : ''}`)).replace(/\s+/g, ' ').trim();
    // a name in the scene description would be painted into the picture
    const named = business.businessName && text.toLowerCase().includes(business.businessName.toLowerCase());
    return text.length >= 20 && text.length <= 600 && !named ? text : plainScene(subject, business, style);
  } catch { return plainScene(subject, business, style); }
}

// ---- saving it ------------------------------------------------------------------------------------------------------------------------

const titleOf = (subject: string) => subject.replace(/[^A-Za-z0-9&\s'-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ').toLowerCase();
const keyFor = (subject: string, kit: BrandKit, style = '') => `ai-${createHash('sha1').update(`${themeFor(subject).words}|${titleOf(subject).split(' ').sort().join(' ')}|${kit.primary}${kit.secondary}${kit.accent}|${isPhotographic(style) ? '' : style.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`).digest('hex').slice(0, 12)}`;

/** Looks at a made picture. Returns what is wrong with it (readable letters, numbers, logos, signs or brand names, or a person), or null when it is clean. */
export type InspectPicture = (jpeg: Buffer) => Promise<string | null>;
const INSPECTOR = 'You check one generated picture before it is used in a business advertisement. Report ONLY what you can see. Problems: (1) any readable letters, words, numbers, signs, labels, lettering on a vehicle or product, badges or seals with writing, logos or brand names, including garbled pseudo-text; (2) a human being: a real or illustrated person, a human face or a human body (hands alone are fine). Ghosts, monsters, animals, robots, living food, mascots and other non-human characters are NOT people. Reply with ONLY JSON: {"text": true or false, "person": true or false, "what": "up to 15 words naming what you saw, or empty"}.';
export const pictureInspector = (completeWithImages: (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }>): InspectPicture => async (jpeg) => {
  try {
    const reply = await completeWithImages(INSPECTOR, 'Check this picture.', [jpeg]);
    const body = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? '{}') as { text?: unknown; person?: unknown; what?: unknown };
    const found = [body.text === true ? 'readable text or a logo' : '', body.person === true ? 'a person' : ''].filter(Boolean).join(' and ');
    return found ? `${found}${typeof body.what === 'string' && body.what ? ` (${body.what.slice(0, 80)})` : ''}` : null;
  } catch { return null; }
};

/** Makes one image, re-encodes it through Pilot's image checks (real picture, sensible size, no hidden data), and keeps it in Photos. */
async function makeRealistic({ tenantId, subject, business, kit, storage, make, complete, look, style, inspect }: { tenantId: string; subject: string; business: BusinessFacts; kit: BrandKit; storage: MediaStorage; make: PictureMakerLike; complete?: CompleteText; look?: string; style?: string; inspect?: InspectPicture }): Promise<AssetMeta> {
  const scene = await describeScene({ subject, business, complete, ...(look ? { look } : {}), ...(style ? { style } : {}) });
  const key = keyFor(subject, kit, style);
  // whatever the image service returns is re-saved as an ordinary web-sized JPEG first (the image library cannot read some large files straight from memory)
  // and it is looked at before it is kept: a picture with lettering, a logo or a person is made again once, then refused
  let jpeg: Buffer = Buffer.alloc(0); let problem: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = realisticPrompt({ scene, business, kit, ...(style ? { style } : {}), ...(look ? { mood: look } : {}) });
    const picture = await make(attempt ? `${prompt}\nTHE LAST ATTEMPT SHOWED ${problem}. This time: absolutely no letters, numbers, words, symbols, badges, seals, logos or human figures anywhere (non-human characters are fine). Surfaces that would carry writing (vehicles, boxes, signs, walls, products) are plain and blank.` : prompt, '1024x1536');
    jpeg = await (await import('./image.js')).toJpeg(picture.bytes);
    problem = inspect ? await inspect(jpeg) : null;
    if (!problem) break;
  }
  if (problem) throw new Error(`the generated picture showed ${problem} twice, so it was not used`);
  return saveBusinessImage({ tenantId, bytes: jpeg, originalName: `${key}.jpg`, storage, fields: { kind: 'photo', label: `AI image – ${titleOf(subject)}`.slice(0, 120), description: `AI-generated image (OpenAI), made because no photo of yours matched “${subject.slice(0, 80)}”. ${style ? `Style: ${style.slice(0, 60)}. ` : ''}Scene: ${scene.slice(0, 160)} It is not a photo of your business or its work.`, tags: ['generated', 'ai-image', key] } });
}

/**
 * The picture to use for a subject when no photo of the owner's fits (see the order above). Returns null only when nothing at all could be made,
 * and then the caller uses the plain branded graphic.
 */
export async function ensureGeneratedVisual({ tenantId, subject, kit, business, storage = getMediaStorage(), make, complete, look, style, inspect }: { tenantId: string; subject: string; kit: BrandKit; business: BusinessFacts; storage?: MediaStorage; inspect?: InspectPicture; make?: PictureMakerLike; complete?: CompleteText; /** the mood and look of the video the picture is for */ look?: string; /** the visual treatment chosen for this picture (photographic when absent) */ style?: string }): Promise<GeneratedVisual | null> {
  let fallbackReason: string | undefined;
  business = { ...business, location: placeOf(business.location) };
  const wantRealistic = make ? true : realisticImagesEnabled();
  if (wantRealistic && subject.trim()) {
    try {
      const existing = await storage.listAssets(tenantId);
      const key = keyFor(subject, kit, style);
      const reuse = existing.find((asset) => asset.tags.includes(key));
      if (reuse) return { asset: reuse, reused: true, kind: 'ai-image' };
      // a close variant of a subject already pictured ("closing your pool" after "pool closing") reuses that image: every distinctive word of the subject is in its label
      const terms = subjectTerms(subject, business);
      const similar = terms.length ? existing.filter((asset) => asset.tags.includes('ai-image')).find((asset) => { const have = new Set(stems(asset.label)); return terms.every((term) => have.has(term.stem)); }) : undefined;
      if (similar) return { asset: similar, reused: true, kind: 'ai-image' };
      const today = new Date().toISOString().slice(0, 10);
      if (existing.filter((asset) => asset.tags.includes('ai-image') && asset.createdAt.startsWith(today)).length >= perDay()) fallbackReason = 'The daily limit for generated images has been reached.';
      else {
        const picker = make ?? (await import('./image.js')).openAiPictureMaker;
        return { asset: await makeRealistic({ tenantId, subject, business, kit, storage, make: picker, complete, ...(inspect ? { inspect } : {}), ...(look ? { look } : {}), ...(style ? { style } : {}) }), reused: false, kind: 'ai-image' };
      }
    } catch (error) {
      fallbackReason = 'The image could not be generated just now.';
      console.error('realistic image failed', error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[key]').replace(/\s+/g, ' ').slice(0, 200) : 'unknown');
    }
  }
  if (!generatedArtEnabled()) return null;
  const art = await ensureGeneratedArt({ tenantId, subject, kit, storage });
  return art ? { asset: art.asset, reused: art.reused, kind: 'artwork', ...(fallbackReason ? { fallbackReason } : {}) } : null;
}
