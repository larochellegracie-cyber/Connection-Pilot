import { fitToPlatform, stripUnsupportedClaims, type PlatformId } from '@/lib/marketing-content.js';
import { briefText, type MarketingInput } from '../generate.js';
import type { BusinessBrief } from '../store.js';
import { parseJson } from '../trends.js';
import { rankAssets, type RankedAsset } from './business-assets.js';
import { animationOptions, buildSpec, layoutOptions, transitionOptions, visualOptions, type PlannedScene, type SceneRole, type VideoPlan } from './plan-layout.js';
import { MAX_SECONDS, type SizeKey, type VideoSpec } from './spec.js';
import type { AssetMeta } from './storage.js';
import type { BrandKit } from './templates.js';

export type Completion = { text: string; usage?: { inputTokens?: number; outputTokens?: number } };
export type CompleteWithUsage = (system: string, prompt: string) => Promise<Completion>;

export type PlannerInput = {
  request: string;
  brief: BusinessBrief;
  kit: BrandKit;
  /** Every picture the business has uploaded (their labels tell Pilot what each shows). */
  assets: AssetMeta[];
  /** The id of the logo picture to draw, when there is one. */
  logoId: string | null;
  /** Optional context Pilot already has: what is busy or slow, and what is in season. */
  context?: Pick<MarketingInput, 'signals' | 'insights'>;
  platform?: PlatformId;
  durationSeconds?: number;
};

export type PlanResult = {
  spec: VideoSpec;
  platform: PlatformId;
  summary: { durationSeconds: number; size: SizeKey; sceneCount: number; hook: string; cta: string; scenes: Array<{ role: SceneRole; seconds: number; headline: string; subtext: string; photo: string | null; /** the picture's id, and the card the scene wants and its list items: used by the code-written video path */ photoId?: string | null; visual?: string; items?: string[]; transition: string }>; photosUsed: Array<{ id: string; label: string }> };
  copy: { hook: string; caption: string; cta: string; hashtags: string[] };
  /** What the owner should know: a missing photo, text that was removed, a length that was adjusted. */
  notes: string[];
  reasoning: string;
  usage: { calls: number; inputTokens: number; outputTokens: number };
};

export class PlannerError extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage); this.name = 'PlannerError'; }
}

// ---- what the request itself says (read by plain code, so it is exact and free) -----------------------------------------

const numberWords: Record<string, number> = { ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fortyfive: 45, sixty: 60 };

export function parseRequest(request: string): { durationSeconds: number | null; platform: PlatformId | null; size: SizeKey | null } {
  const text = request.toLowerCase();
  let durationSeconds: number | null = null;
  const digits = /(\d{1,2})\s*[- ]?\s*(?:seconds?|secs?|s)\b/.exec(text); if (digits) durationSeconds = Number(digits[1]);
  const words = /\b(ten|fifteen|twenty|thirty|forty[- ]?five|forty|sixty)[- ]?(?:seconds?|secs?)\b/.exec(text); if (!durationSeconds && words) durationSeconds = numberWords[words[1].replace(/[- ]/g, '')];
  if (!durationSeconds && /\b(half a minute|30 sec)/.test(text)) durationSeconds = 30;
  if (!durationSeconds && /\b(a|one|1)[- ]?minute\b/.test(text)) durationSeconds = 60;
  const platform: PlatformId | null = /\binsta(gram)?\b|\breels?\b/.test(text) ? 'instagram' : /\btik[- ]?tok\b/.test(text) ? 'tiktok' : /\bfacebook\b|\bfb\b/.test(text) ? 'facebook' : /\blinkedin\b/.test(text) ? 'linkedin' : null;
  const size: SizeKey | null = /\bsquare\b/.test(text) ? '1080x1080' : /\b(landscape|horizontal|widescreen|youtube)\b/.test(text) ? '1920x1080' : /\b(vertical|story|stories|reel|reels|portrait)\b/.test(text) ? '1080x1920' : null;
  return { durationSeconds: durationSeconds && durationSeconds >= 5 ? Math.min(MAX_SECONDS, durationSeconds) : null, platform, size };
}

export const sizeForPlatform = (platform: PlatformId): SizeKey => (platform === 'linkedin' ? '1080x1080' : '1080x1920');

// ---- keeping the words honest ----------------------------------------------------------------------------------------

/** Numbers, links and phone numbers in generated text must come from the business's own information or the owner's request. */
export function removeUngrounded(value: string, allowedSource: string): { text: string; removed: boolean } {
  const allowed = allowedSource.toLowerCase();
  let removed = false;
  const text = value.replace(/https?:\/\/\S+|www\.\S+|\+?\d[\d\s().,%$-]*\d|\d/g, (match) => { const key = match.toLowerCase().replace(/[.,;:]+$/, ''); if (allowed.includes(key)) return match; removed = true; return ''; })
    .replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
  return { text, removed };
}

const words = (value: string, max: number) => value.split(/\s+/).filter(Boolean).slice(0, max).join(' ');
const clip = (value: unknown, maxChars: number, maxWords: number) => { const raw = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''; const cut = words(raw, maxWords); return cut.length > maxChars ? cut.slice(0, maxChars).replace(/\s+\S*$/, '').trim() : cut; };

const RULES = `You are Pilot's video planner. You design short social-media videos for ONE small business, out of text, the business's own uploaded pictures, shapes, animation and transitions. You do not generate footage.
Honesty rules (strict):
- Use only facts in the business brief and the owner's request. Never invent products, prices, offers, discounts, phone numbers, web addresses, locations, awards, reviews, ingredients, or claims such as "best", "fresh daily", "award-winning", or health claims.
- Use only the pictures listed, by their alias (a1, a2...). Never describe or rely on a picture that is not listed. If no listed picture suits a scene, use null.
- Write short, specific, natural copy in the business's voice. Headlines are at most 7 words. Subtext is optional and at most 12 words.
- Never promise results. Never say something is "viral" or "trending".
Design rules: the first scene is the hook and the last scene is a call to action (a clear action such as ordering or booking). Choose 4 to 6 scenes (3 for a very short video): a strong hook, one to three supporting benefit or detail scenes (each about one specific thing the business actually does or offers), then the call to action. For a scene with no picture, choose a "visual" (the card that shows its idea: checklist of services or benefits, chat for a customer question and reply, calendar for booking, quote for estimates, plan for a service plan or offer, chart, screen for an app-style phone screen) and give "items": up to 4 short phrases of things the business really does or offers (3 to 5 words each, no prices or figures unless the brief has them). Each scene is designed by Pilot as a sliding panel, framed photo, highlight badge or bold graphic, so write one clear idea per scene. Vary the animation and the transition. Prefer a full-screen photo for the hook and product scenes when a matching picture exists; use "card" for photos with white or plain backgrounds.`;

export const orientationOf = (asset: Pick<AssetMeta, 'width' | 'height'>) => (asset.width > asset.height * 1.15 ? 'landscape' : asset.height > asset.width * 1.15 ? 'portrait' : 'square');

function promptFor(input: PlannerInput, ranked: RankedAsset[], target: number, platform: PlatformId, size: SizeKey, aliases: Map<string, string>): string {
  const context: MarketingInput = { brief: input.brief, signals: input.context?.signals ?? [], trends: [], insights: input.context?.insights ?? [], existing: [], now: new Date(), timezone: 'UTC' };
  const signals = (input.context?.signals ?? []).filter((signal) => signal.kind !== 'holiday').slice(0, 4).map((signal) => `- ${signal.label}. ${signal.detail}`).join('\n');
  const pictures = ranked.length ? ranked.map((asset) => `${[...aliases.entries()].find(([, id]) => id === asset.id)![0]}: "${asset.label}" (${asset.kind}, ${orientationOf(asset)}${asset.tags.length ? `, tags: ${asset.tags.join(', ')}` : ''}${asset.description ? `, ${asset.description}` : ''})${asset.score > 0 ? ` [matches the request: ${asset.matched.join(', ')}]` : ''}`).join('\n') : 'No pictures have been uploaded.';
  return `BUSINESS BRIEF\n${briefText(context)}\n${signals ? `\nWHAT IS HAPPENING IN THE BUSINESS\n${signals}\n` : ''}\nUPLOADED PICTURES (use these aliases only)\n${pictures}\n\nOWNER'S REQUEST\n"${input.request.trim().slice(0, 600)}"\n\nPlatform: ${platform}. Video: ${size}, ${target} seconds long (the scene seconds must add up to ${target}).\n\nRespond with JSON only:\n{"hook":"the opening line","cta":"the call to action","caption":"the post caption","hashtags":["tag"],"reasoning":"one sentence on why these scenes and pictures","scenes":[{"role":"hook|product|detail|offer|cta","seconds":3,"headline":"","subtext":"","asset":"a1 or null","photoStyle":"full|card","layout":"bottom|center|top","visual":"${visualOptions.join('|')}","items":["short true phrase"],"animation":"${animationOptions.join('|')}","transition":"${transitionOptions.join('|')}"}]}`;
}

/** Scales scene lengths so they add up exactly to the target, with a hook that is short and an ending that is long enough to read. */
export function fitDurations(scenes: PlannedScene[], target: number): PlannedScene[] {
  const min = 1.8;
  const raw = scenes.map((scene) => Math.max(min, Number(scene.seconds) || 3));
  const total = raw.reduce((sum, value) => sum + value, 0);
  let seconds = raw.map((value) => Math.max(min, (value / total) * target));
  const cta = seconds.length - 1; const wantCta = Math.min(4, Math.max(2.5, target * 0.16));
  if (seconds[cta] < wantCta) { const take = wantCta - seconds[cta]; seconds[cta] = wantCta; const others = seconds.slice(0, cta); const room = others.reduce((sum, value) => sum + (value - min), 0); seconds = seconds.map((value, index) => (index === cta ? value : room > 0 ? Math.max(min, value - (take * (value - min)) / room) : value)); }
  const rounded = seconds.map((value) => Math.round(value * 10) / 10);
  const drift = Math.round((target - rounded.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  rounded[rounded.length - 2 >= 0 ? rounded.length - 2 : 0] = Math.round((rounded[rounded.length - 2 >= 0 ? rounded.length - 2 : 0] + drift) * 10) / 10;
  return scenes.map((scene, index) => ({ ...scene, seconds: rounded[index] }));
}

/**
 * Plans a Standard Video from the owner's words. Plain code reads the length and platform from the request and ranks the
 * business's pictures against it; ONE AI call then writes the copy and chooses scenes, pictures, motion and transitions from
 * fixed options; plain code checks all of it, removes anything the business did not say, and lays it out for the renderer.
 */
export async function planStandardVideo(input: PlannerInput, complete: CompleteWithUsage): Promise<PlanResult> {
  if (!input.request.trim()) throw new PlannerError('Tell Pilot what the video is for, for example "a 20-second Instagram ad for my chocolate cake".');
  const parsed = parseRequest(input.request);
  const platform = parsed.platform ?? input.platform ?? 'instagram';
  const size = parsed.size ?? sizeForPlatform(platform);
  const target = Math.min(MAX_SECONDS, Math.max(8, Math.round(parsed.durationSeconds ?? input.durationSeconds ?? 20)));
  const notes: string[] = [];

  const ranked = rankAssets(input.assets, input.request).slice(0, 10);
  const aliases = new Map(ranked.map((asset, index) => [`a${index + 1}`, asset.id]));
  const byId = new Map(ranked.map((asset) => [asset.id, asset]));
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };

  const ask = async () => { const reply = await complete(RULES, promptFor(input, ranked, target, platform, size, aliases)); usage.calls += 1; usage.inputTokens += reply.usage?.inputTokens ?? 0; usage.outputTokens += reply.usage?.outputTokens ?? 0; return parseJson(reply.text); };
  let raw = await ask();
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 2) raw = await ask(); // one retry if the answer was not usable
  if (!Array.isArray(raw.scenes) || raw.scenes.length < 2) throw new PlannerError('Pilot could not plan that video just now. Please try again.');

  const source = `${briefText({ brief: input.brief, signals: [], trends: [], insights: [], existing: [], now: new Date(), timezone: 'UTC' })} ${input.request} ${input.kit.name}`;
  const clean = (value: unknown, chars: number, wordsMax: number) => { const base = stripUnsupportedClaims(clip(value, chars, wordsMax)); const result = removeUngrounded(base, source); if (result.removed) notes.push('Some text that was not in your business information (a number or link) was removed.'); return result.text; };

  const roles: SceneRole[] = ['hook', 'product', 'detail', 'offer', 'cta'];
  let scenes: PlannedScene[] = (raw.scenes as Record<string, any>[]).slice(0, 6).map((scene) => {
    const alias = typeof scene?.asset === 'string' ? scene.asset.trim() : '';
    const id = aliases.get(alias) ?? null; // a picture that was not listed is never used
    return {
      role: (roles as string[]).includes(scene?.role) ? scene.role : 'detail', seconds: Number(scene?.seconds) || 3,
      headline: clean(scene?.headline, 60, 8), subtext: clean(scene?.subtext, 90, 14), asset: id,
      photoStyle: scene?.photoStyle === 'card' ? 'card' : 'full', layout: (layoutOptions as readonly string[]).includes(scene?.layout) ? scene.layout : 'bottom',
      visual: (visualOptions as readonly string[]).includes(scene?.visual) ? scene.visual : undefined,
      items: (Array.isArray(scene?.items) ? scene.items : []).slice(0, 4).map((item: unknown) => clean(item, 40, 6)).filter(Boolean),
      animation: (animationOptions as readonly string[]).includes(scene?.animation) ? scene.animation : 'slide-up', transition: (transitionOptions as readonly string[]).includes(scene?.transition) ? scene.transition : 'fade',
    } as PlannedScene;
  }).filter((scene) => scene.headline);
  if (scenes.length < 2) throw new PlannerError('Pilot could not plan that video just now. Please try again.');

  const hook = clean(raw.hook, 90, 14) || scenes[0].headline;
  const cta = clean(raw.cta, 80, 12) || 'Order today';
  // the video always opens with the hook and ends on the call to action
  scenes[0] = { ...scenes[0], role: 'hook' };
  if (scenes[scenes.length - 1].role !== 'cta') scenes.push({ role: 'cta', seconds: 3.5, headline: cta, subtext: '', asset: null, photoStyle: 'card', layout: 'center', animation: 'pop', transition: 'fade' });
  else scenes[scenes.length - 1] = { ...scenes[scenes.length - 1], headline: scenes[scenes.length - 1].headline || cta };
  scenes = scenes.slice(0, 6);

  // pictures: only ones that suit the request. A request about a named product never gets an unrelated photo.
  const best = ranked.find((asset) => asset.score >= 2);
  const named = ranked.some((asset) => asset.matched.length > 0);
  scenes = scenes.map((scene) => {
    if (!scene.asset) return scene;
    const asset = byId.get(scene.asset)!;
    if (best && asset.matched.length === 0 && scene.role !== 'cta') return { ...scene, asset: best.id }; // swap an unrelated photo for the one that matches
    return scene;
  });
  const used = (list: PlannedScene[]) => list.filter((scene) => scene.asset).length;
  if (best && used(scenes) === 0) scenes = scenes.map((scene, index) => (index === 0 || scene.role === 'product' ? { ...scene, asset: best.id, photoStyle: 'full' as const } : scene));
  if (!best && ranked.length === 0) notes.push('No pictures have been uploaded yet, so this video uses your text and branding only. Upload a photo of the product for a better video.');
  else if (!best && !named) notes.push(`None of your uploaded pictures is labelled to match this request, so no photo was used. Upload one labelled for it (for example "${input.request.replace(/make me|a \d+[- ]?second|instagram|ad|video/gi, '').trim().slice(0, 40) || 'your product'}").`);
  scenes = scenes.map((scene) => (scene.asset && !byId.get(scene.asset) ? { ...scene, asset: null } : scene));

  const timed = fitDurations(scenes, target);
  const plan: VideoPlan = { size, durationSeconds: target, scenes: timed };
  const spec = buildSpec({ plan, kit: input.kit, logoId: input.logoId });

  const hashtagsRaw = (Array.isArray(raw.hashtags) ? raw.hashtags : []).filter((tag: unknown): tag is string => typeof tag === 'string');
  const fitted = fitToPlatform(platform, { caption: removeUngrounded(stripUnsupportedClaims(typeof raw.caption === 'string' ? raw.caption.trim().slice(0, 2000) : ''), source).text || hook, hashtags: hashtagsRaw });
  if (Math.abs(target - (parsed.durationSeconds ?? target)) > 0.01) notes.push('The length was set to match the request.');
  const photosUsed = [...new Set(timed.map((scene) => scene.asset).filter((id): id is string => Boolean(id)))].map((id) => ({ id, label: byId.get(id)!.label }));
  return {
    spec, platform,
    summary: { durationSeconds: target, size, sceneCount: timed.length, hook, cta, scenes: timed.map((scene) => ({ role: scene.role, seconds: scene.seconds, headline: scene.headline, subtext: scene.subtext, photo: scene.asset ? byId.get(scene.asset)!.label : null, photoId: scene.asset, ...(scene.visual ? { visual: scene.visual } : {}), ...(scene.items?.length ? { items: scene.items } : {}), transition: scene.transition })), photosUsed },
    copy: { hook, caption: fitted.caption, cta, hashtags: fitted.hashtags },
    notes: [...new Set(notes)], reasoning: typeof raw.reasoning === 'string' ? raw.reasoning.replace(/\b(?:the |your )?(?:photo |picture |image )?a\d{1,2}\b/gi, 'your photo').trim().slice(0, 300) : '', usage,
  };
}
