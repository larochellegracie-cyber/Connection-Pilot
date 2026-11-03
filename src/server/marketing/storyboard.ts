import { platformSpecs, type PlatformId } from '@/lib/marketing-content.js';
import { writeCaption } from './caption.js';
import type { VideoSpec } from './standard-video/spec.js';
import type { VideoEngine } from './video-engine.js';
import type { AssetSelection } from './asset-selection.js';
import type { CreativeBrief } from './creative-brief.js';
import { briefText, type Complete, type MarketingInput } from './generate.js';
import { parseJson } from './trends.js';

/**
 * The storyboard for a confirmed brief: 3 to 5 short scenes in a fixed shape (a hook, the main subject, supporting shot(s), and a
 * branded ending), each with the exact text that is sent to the video generator.
 *
 *  - hook      an opening shot that makes the viewer curious
 *  - main      the subject itself, clearly the focus
 *  - support   one or two shots showing a detail or the benefit
 *  - ending    a branded end card with the call to action. It is drawn here from the business's colours, logo and words (generated
 *              video cannot be trusted to spell), so it never goes to the video generator.
 *
 * If the owner's own photo fits the subject, the hook and main shots (and the supporting shots, in turn) start from that real
 * photo. If none fits, they are generated from text alone, and the prompts say plainly not to invent the business's premises,
 * vehicles, staff, products or branding. The style words become camera, lighting and mood in code, so they are always in every
 * prompt even if the AI leaves them out.
 */
export type SceneRole = 'hook' | 'main' | 'support' | 'ending';
export type StoryboardScene = {
  role: SceneRole;
  kind: 'clip' | 'end_card';
  seconds: number;
  /** What the scene shows, in plain words (for the owner and the logs). */
  description: string;
  /** The text sent to the video generator, with style, camera, lighting and mood in it. Null for the end card. */
  prompt: string | null;
  /** The owner's own photo this scene starts from, or null when it is generated from text only. */
  reference_asset_id: string | null;
  /** The words on the end card. */
  on_screen_text: string;
  /** The saved clip file (a video in the business's storage) once this scene has been made, so a later change can reuse it. Null for the end card. */
  clip_video_id?: string | null;
};
export type Direction = { camera: string; lighting: string; mood: string };
export type Storyboard = {
  scenes: StoryboardScene[]; total_seconds: number; direction: Direction; caption: string; hashtags: string[]; cta: string;
  /** A colour grade applied to the generated clips when they are joined: below 0 is darker, above 0 is brighter. 0 leaves them as made. */
  grade?: number;
  /** What the music was composed from. A change that keeps the music reuses it, so the track stays exactly the same; new music uses a new one. */
  music_seed?: string;
  /** How this video was made. Missing on videos made before the free path existed, which were all Runway. */
  engine?: VideoEngine;
  /** For a free animated video: the scene plan that was drawn, so a small change (the ending's words) can be re-drawn without planning again. */
  animated_spec?: VideoSpec;
  /** How a free video was drawn: the standard renderer, or code the model wrote (then there is no animated_spec to recut). */
  renderer?: 'code' | 'template' | 'explainer';
  code_script_sha?: string;
  /** how the code-written video was made: 'invent' (the scenes were drawn from shapes) or 'open' (arranged from the scene library) */ code_style?: 'invent' | 'open' | 'custom';
};

const DEFAULT_SECONDS = 15; const MIN_SECONDS = 6; const MAX_SECONDS = 30;
const END_CARD_SECONDS = 3;
const PROMPT_LIMIT = 1000;

// ---- how many scenes, how long ---------------------------------------------------------------------------------------

/** Splits the length into the generated clips (2 to 4 of them, 2 to 10 seconds each) plus the end card, so there are 3 to 5 scenes. */
export function planScenes(lengthSeconds: number | null): { roles: SceneRole[]; seconds: number[] } {
  const total = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(lengthSeconds ?? DEFAULT_SECONDS)));
  const end = total <= 8 ? 2 : END_CARD_SECONDS;
  const clipsTotal = total - end;
  const clips = Math.min(4, Math.max(2, Math.round(clipsTotal / 4)));
  const base = Math.floor(clipsTotal / clips); let extra = clipsTotal - base * clips;
  const seconds = Array.from({ length: clips }, () => { const s = base + (extra > 0 ? 1 : 0); extra -= 1; return Math.min(10, Math.max(2, s)); });
  const roles: SceneRole[] = ['hook', 'main', 'support', 'support'].slice(0, clips) as SceneRole[];
  return { roles: [...roles, 'ending'], seconds: [...seconds, end] };
}

// ---- style words -> camera, lighting, mood -----------------------------------------------------------------------------

const CAMERA: Array<[RegExp, string]> = [
  [/\b(?:fast|snappy|high energy|energetic|tiktok style)\b/, 'quick, dynamic camera moves with energetic whip pans'], [/\b(?:slow|calm|elegant|luxury|peaceful)\b/, 'slow, smooth gliding camera movement'],
  [/\b(?:cinematic|dramatic|3d)\b/, 'slow cinematic push-in with shallow depth of field and subtle parallax'], [/\b(?:retro|vintage)\b/, 'steady handheld-style camera with a gentle drift'],
];
const LIGHTING: Array<[RegExp, string]> = [
  [/\b(?:dark|moody|dramatic|cinematic|halloween)\b/, 'low-key lighting, deep shadows and a soft rim light'], [/\b(?:bright|airy|sunny|summer|fun|playful)\b/, 'bright, soft natural daylight'],
  [/\b(?:luxury|expensive|premium)\b/, 'rich, controlled lighting with glossy highlights'], [/\b(?:retro|vintage)\b/, 'warm film-like light with gentle grain'],
  [/\b(?:christmas)\b/, 'warm festive lights'], [/valentine/, 'soft, romantic warm light'],
];
const MOOD: Array<[RegExp, string]> = [
  [/\b(?:luxury|expensive|premium|elegant)\b/, 'premium, refined and confident'], [/\b(?:dramatic|cinematic|dark)\b/, 'dramatic, intense and cinematic'], [/\b(?:fun|playful)\b/, 'playful, upbeat and friendly'],
  [/\b(?:calm|peaceful|slow)\b/, 'calm and reassuring'], [/\b(?:high energy|energetic|fast|bold)\b/, 'energetic and attention-grabbing'], [/\b(?:retro|vintage)\b/, 'nostalgic and warm'],
  [/valentine/, 'romantic and warm'], [/\b(?:christmas)\b/, 'festive and cosy'], [/\b(?:halloween)\b/, 'spooky and playful'], [/\b(?:summer)\b/, 'sunny and carefree'], [/\b(?:professional|minimal|modern)\b/, 'clean, modern and professional'],
];

/** The style words from the brief as camera, lighting and mood, with sensible defaults when the owner gave none. */
export function styleDirection(style: string[]): Direction {
  const text = style.join(' ').toLowerCase();
  const first = (table: Array<[RegExp, string]>, fallback: string) => table.find(([pattern]) => pattern.test(text))?.[1] ?? fallback;
  const extras = [/\b3d\b/.test(text) ? 'a layered sense of depth and dimension' : '', /valentine/.test(text) ? 'romantic red and pink accents' : '', /\bchristmas\b/.test(text) ? 'festive red and green accents' : '', /\bhalloween\b/.test(text) ? 'orange and purple accents' : ''].filter(Boolean);
  const direction = { camera: first(CAMERA, 'smooth, steady camera movement'), lighting: first(LIGHTING, 'natural, soft lighting'), mood: first(MOOD, 'polished and professional') };
  return extras.length ? { ...direction, mood: `${direction.mood}, with ${extras.join(' and ')}` } : direction;
}

/** Wraps a scene description with the style, camera, lighting and mood, and the rules every scene must follow. */
export function buildScenePrompt({ description, direction, style, referenced, noPeople }: { description: string; direction: Direction; style: string[]; referenced: boolean; noPeople: boolean }): string {
  const rules = [
    'No text, captions, logos or watermarks anywhere in the frame.',
    noPeople ? 'No people.' : 'No close-ups of identifiable real people.',
    referenced ? 'Start from the reference image and keep the subject exactly as it appears in it; only add motion and atmosphere.' : 'A generic scene: do not show any real business storefront, signage, vehicles, uniforms or branded products.',
  ].join(' ');
  const tail = ` Style: ${style.length ? style.join(', ') : 'clean and professional'}. Camera: ${direction.camera}. Lighting: ${direction.lighting}. Mood: ${direction.mood}. ${rules}`;
  const room = Math.max(60, PROMPT_LIMIT - tail.length);
  const body = description.replace(/\s+/g, ' ').trim();
  return `${body.length > room ? `${body.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : body}${tail}`.slice(0, PROMPT_LIMIT);
}

// ---- the AI writes what each scene shows, and the caption ----------------------------------------------------------------

const SYSTEM = `You are Pilot, a creative director writing the storyboard for ONE small business's short social video.
Rules (strict):
- Use only facts about the business that you are given. Never invent products, offers, prices, places, people, vehicles, awards or results.
- Never describe the business's premises, staff, vehicles or products unless a real photo of them is provided. When no real photo is provided, describe a generic, tasteful scene that illustrates the subject, with no business-specific objects.
- Describe only what the camera sees: subject, action, setting. No on-screen text, no logos, no speech, no music.
Reply with JSON only: {"scenes": [{"role": "hook" | "main" | "support", "description": "what the camera sees, 1-2 sentences"}]}
Give exactly one scene for each role requested, in order.`;

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function fallbackDescription(role: SceneRole, subject: string, referenced: boolean): string {
  const photo = referenced ? 'Bring the real photo to life with gentle motion. ' : '';
  if (role === 'hook') return `${photo}An eye-catching opening shot that makes the viewer curious about ${subject}.`;
  if (role === 'main') return `${photo}The main shot: ${subject}, shown clearly as the focus of the frame.`;
  return `${photo}A supporting shot that shows a detail or the benefit of ${subject}.`;
}

export type StoryboardInput = { brief: CreativeBrief; selection: AssetSelection | null; input: MarketingInput; complete: Complete };

export async function buildStoryboard({ brief, selection, input, complete }: StoryboardInput): Promise<Storyboard> {
  const plan = planScenes(brief.length_seconds);
  const direction = styleDirection(brief.style);
  const photos = selection?.has_good_match ? selection.selected_assets.filter((asset) => asset.type === 'photo') : [];
  const referenceFor = (clipIndex: number, role: SceneRole): string | null => {
    if (!photos.length) return null;
    if (role === 'hook' || role === 'main') return photos[0].id;
    return photos[(clipIndex - 1) % photos.length].id; // supporting shots rotate through the selected photos
  };
  const subject = brief.main_subject || 'the business';
  const platform: PlatformId = brief.platform === 'tiktok' ? 'tiktok' : 'instagram';
  const clipRoles = plan.roles.filter((role) => role !== 'ending');

  let written: Record<string, unknown> = {};
  try {
    const prompt = [
      briefText(input),
      `The brief:\n${JSON.stringify({ platform: brief.platform, content_type: brief.content_type, main_subject: brief.main_subject, style: brief.style, length_seconds: brief.length_seconds, key_instructions: brief.key_instructions })}`,
      `Write ${clipRoles.length} scenes with these roles, in order: ${clipRoles.join(', ')}.`,
      photos.length ? `Real photos of the business WILL be used as the starting frame for these scenes: ${photos.map((photo) => `"${photo.label}"`).join(', ')}. Describe how each one comes to life; do not describe a different subject.` : 'There are NO real photos to use, so describe generic scenes that illustrate the subject. Do not describe the business itself.',
      `Platform: ${platformSpecs[platform].label}.`,
    ].join('\n\n');
    written = parseJson(await complete(SYSTEM, prompt));
  } catch { /* the plain storyboard below is used */ }

  const aiScenes = Array.isArray(written.scenes) ? written.scenes as Array<Record<string, unknown>> : [];
  const clipScenes: StoryboardScene[] = clipRoles.map((role, index) => {
    const reference = referenceFor(index, role);
    const said = clean(aiScenes.find((scene, i) => scene?.role === role && aiScenes.findIndex((other) => other?.role === role) === i)?.description ?? aiScenes[index]?.description, 400);
    const description = said || fallbackDescription(role, subject, !!reference);
    return { role, kind: 'clip', seconds: plan.seconds[index], description, prompt: buildScenePrompt({ description, direction, style: brief.style, referenced: !!reference, noPeople: brief.style.includes('no people') || brief.key_instructions.some((line) => /no people/i.test(line)) }), reference_asset_id: reference, on_screen_text: '', clip_video_id: null };
  });

  // the caption is its own step, held to a standard (a real hook, the brand's voice, a real call to action, relevant hashtags)
  const words = await writeCaption({ brief, input, platform, complete, scenes: clipScenes.map((scene) => scene.description) });
  const endText = words.end_card_text || (input.brief.businessName ? `Book with ${input.brief.businessName}` : 'Get in touch today');
  const scenes: StoryboardScene[] = [...clipScenes, { role: 'ending', kind: 'end_card', seconds: plan.seconds[plan.seconds.length - 1], description: 'A branded end card with the call to action.', prompt: null, reference_asset_id: null, on_screen_text: endText, clip_video_id: null }];
  return { scenes, total_seconds: scenes.reduce((sum, scene) => sum + scene.seconds, 0), direction, caption: words.caption, hashtags: words.hashtags, cta: words.cta || endText, grade: 0 };
}

// ---- changing one scene of a finished video ---------------------------------------------------------------------------------

const REVISE_SYSTEM = `You rewrite ONE scene of a short social video for a small business after the owner asked for a change.
Rules (strict): use only facts you are given; never invent products, places, people, vehicles or results; describe only what the camera sees (subject, action, setting), with no on-screen text, logos, speech or music. Keep what the owner did not ask to change.
Reply with JSON only: {"description": "what the camera sees now, 1-2 sentences"}`;

/** The new description of a scene after the owner's change. If the AI cannot be asked, the change is added to the old description. */
export async function reviseScene({ scene, instruction, brief, complete }: { scene: StoryboardScene; instruction: string; brief: CreativeBrief; complete: Complete }): Promise<string> {
  try {
    const raw = parseJson(await complete(REVISE_SYSTEM, `The video is about: ${brief.main_subject}. Style: ${brief.style.join(', ') || 'clean and professional'}.\nThe ${scene.role} scene currently shows: ${scene.description}\nThe owner said: "${instruction.slice(0, 300)}"`));
    const description = clean(raw.description, 400);
    if (description) return description;
  } catch { /* the plain version below is used */ }
  return `${scene.description} ${instruction}`.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/** The scene made again with a new description and/or length: its prompt is rebuilt with the brief's style, camera, lighting and mood. */
export function remakeScene(scene: StoryboardScene, { description, seconds, brief }: { description: string; seconds: number; brief: CreativeBrief }): StoryboardScene {
  const direction = styleDirection(brief.style);
  return { ...scene, description, seconds, clip_video_id: null, prompt: buildScenePrompt({ description, direction, style: brief.style, referenced: !!scene.reference_asset_id, noPeople: brief.style.includes('no people') || brief.key_instructions.some((line) => /no people/i.test(line)) }) };
}

