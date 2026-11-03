import { randomUUID } from 'node:crypto';
import { copyFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ContentItem, PlatformId } from '@/lib/marketing-content.js';
import { aiComplete, aiCompleteCode, aiCompleteWithImages, aiCompleteWithUsage, loadMarketingInput, type Tenant } from './service.js';
import { ensureGeneratedVisual, realisticImagesEnabled, pictureInspector, type InspectPicture, type PictureMakerLike } from './generated-visual.js';
import type { AssetMeta } from './standard-video/storage.js';
import { chooseCodeVideo, lookFor, renderCodeVideo, type CodeVideoResult } from './code-video/index.js';
import { provenanceOf, reviewAssets, type AssetReview, type ReviewInput } from './asset-vision.js';
import { planVideo, type GenerateVisual, type Plan, type PlanInput } from './code-video/plan.js';
import { lookOf, type Strategy } from './code-video/strategy.js';
import { conceptPalette, conceptPlan, PROP_KINDS, writeConcept, type Concept, type ConceptInput } from './code-video/concept.js';
import { renderProductAd, type ProductAdInput } from './code-video/product.js';
import { buildPhotoAdScript, heroFocus } from './code-video/photo-ad.js';
import { buildStyledScript, styledDesign } from './code-video/styled.js';
import { pickStyledPhotos, type StyledPick } from './video-styled.js';
import { heroKindFor } from './code-video/index.js';
import { resolveProductAsset } from './product-asset.js';
import { findReferenceText, forbiddenFor, redact, scriptStrings, type ReferenceText } from './reference/protect.js';
import { conceptSources, redactConcept } from './code-video/concept.js';
import { renderExplainer, type ExplainerResult } from './explainer/index.js';
import { useExplainer } from './explainer/storyboard.js';
import { buildBlueprint, loadReference, type Blueprint } from './reference/index.js';
import { buildStoryboard, remakeScene, reviseScene, styleDirection, type Storyboard, type StoryboardScene } from './storyboard.js';
import { engineFor, type VideoEngine } from './video-engine.js';
import { planStandardVideo, PlannerError, type PlannerInput, type PlanResult } from './standard-video/planner.js';
import type { Assets } from './standard-video/draw.js';
import { reviseEndText, writeCaption } from './caption.js';
import { planIteration, type IterationPlan } from './iteration.js';
import { createRunwayClient, getRunwayVideo, isRunwayConfigured, runwayProblem, startRunwayClip, type ClipRequest } from './runway.js';
import { finishJob, getMarketingJob, markJobGenerating, saveJobStoryboard, type JobResult, type MarketingJob } from './marketing-jobs.js';
import type { Complete, MarketingInput } from './generate.js';
import type { VideoTaskState } from './providers.js';
import { loadAssets } from './standard-video/assets.js';
import { pickLogo } from './standard-video/business-assets.js';
import { ffmpegAvailable } from './standard-video/ffmpeg.js';
import { videoLink } from './standard-video/jobs.js';
import { renderVideoSpec } from './standard-video/render.js';
import { assetsNeeded, validateSpec, type VideoSpec } from './standard-video/spec.js';
import { getMediaStorage, type MediaStorage } from './standard-video/storage.js';
import { loadBrandKit, createContent, getContent, saveContent, type BrandKit } from './store.js';
import { addMusic, musicProfile, silenceVideo } from './music.js';
import { downloadClip, stitchClips, type StitchOptions } from './video-stitch.js';

/**
 * Phase 3: making the video for a confirmed job that has its asset selection.
 *
 *   confirmed -> generating -> ready | failed
 *
 * 1. write the storyboard (3 to 5 scenes) and save it on the job,
 * 2. make each scene as a short clip with Runway: starting from the owner's own photo when one was selected, otherwise from text alone
 *    (two at a time; a scene that fails is tried once more),
 * 3. draw the branded end card here (generated video cannot be trusted to spell, so the call to action is never left to it),
 * 4. join the clips and the end card into one vertical video,
 * 5. add original background music that fits the brief's style and mood (composed here, so there is nothing to license). If the music
 *    cannot be added, the silent video is used and the job says so; if the owner asked for no music, none is added,
 * 6. save it in the business's own storage, put a draft in the Library, and record the link, caption and details on the job.
 * It runs in the background; the owner's chat reply comes back at once and the video is fetched as it finishes. Everything outside the app (Runway, downloads, FFmpeg) is reached through `GenerationDeps`, so tests spend nothing.
 */
export type GenerationDeps = {
  startClip: (request: ClipRequest) => Promise<{ taskId: string; estimatedCredits: number | null }>;
  checkClip: (taskId: string) => Promise<VideoTaskState>;
  fetchClip: (url: string) => Promise<Buffer>;
  stitch: (clipPaths: string[], outPath: string, options?: StitchOptions) => Promise<void>;
  /** Mixes the track into the video (the picture is copied untouched). */
  addMusic: typeof addMusic;
  /** The free animated engine: plans the scenes (photos, text, motion) and draws them. No outside video service. */
  planAnimated: (input: PlannerInput) => Promise<PlanResult>;
  renderSpec: (args: { spec: VideoSpec; assets: Assets; outPath: string }) => Promise<unknown>;
  /** Optional: how realistic images are made (tests give a fake; normally OpenAI's image model). */
  makePicture?: PictureMakerLike; /** looks at each generated picture for lettering, logos or people before it is kept */ inspectPicture?: InspectPicture;
  /** Optional: an explainer video with a voiceover (floating task bubbles, forms that fill in, a schedule that builds itself). Returns { ok: false } and the caller makes an ordinary free video. */
  renderExplainer?: (args: { tenantId: string; request: string; kit: BrandKit; logoId: string | null; workDir: string; outPath: string; business: { name: string; type: string; location: string; services: string[]; description: string; tone: string }; photos: AssetMeta[]; style: string[]; instructions: string[]; targetSeconds?: number; seed?: string; blueprint?: Blueprint | null }) => Promise<ExplainerResult>;
  /** Optional: draws the same plan from a Python script the model writes (sandboxed). Returns { ok: false } and the caller uses renderSpec. */
  /** Optional: looks at the business's pictures once (see asset-vision.ts) so the creative model chooses by what is in them. */
  reviewAssets?: (input: ReviewInput) => Promise<AssetReview>;
  renderCode?: (args: { /** the creative strategy this video was planned from: authoritative for the look, the writer's rules and the checks */ strategy?: Strategy; platform?: string; /** what looking at the pictures found, by asset id */ assetFacts?: Record<string, { shows: string; kind: string; best_use: string; focus?: { x: number; y: number } }>; tenantId: string; plan: PlanResult; kit: BrandKit; logoId: string | null; workDir: string; outPath: string; /** 'invent' draws the scenes from shapes; otherwise the scene library is arranged */ style?: 'invent' | 'open' | 'custom'; subject?: string; palette?: Record<string, string | boolean>; design?: unknown; forbidden?: ReferenceText; /** a realistic photograph of the subject (own or generated): the main visual, never redrawn from shapes */ heroPhoto?: { id: string; label: string }; /** 'motion': invented graphics and UI (photos optional); 'photo' (default): the photograph is the main visual */ look?: 'photo' | 'motion' }) => Promise<CodeVideoResult>;
  /** Optional: invents the whole video for a creative request (scenes, pacing, visuals) instead of using the service-based plan. */
  writeConcept?: (input: ConceptInput) => Promise<Concept | null>;
  /** Optional: plans a video the way a director does: a creative strategy first, then the storyboard from it (see code-video/plan.ts). Without it, or if it cannot, the storyboard is planned without a strategy. */
  planVideo?: (input: PlanInput, tools?: { generate?: GenerateVisual }) => Promise<Plan>;
  /** Optional: draws a product advert straight from a reference video's design blueprint (see code-video/product.ts). */
  renderProductAd?: (input: Omit<ProductAdInput, 'storage'>) => Promise<CodeVideoResult>;
  storage: MediaStorage;
  complete: Complete;
  loadInput: (tenant: Tenant) => Promise<MarketingInput>;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  clipTimeoutMs: number;
};

export function defaultDeps(): GenerationDeps {
  const client = () => createRunwayClient();
  return {
    startClip: (request) => startRunwayClip(request, client()),
    checkClip: (taskId) => getRunwayVideo(taskId, client()),
    fetchClip: downloadClip, stitch: (clips, out, options) => stitchClips(clips, out, options), addMusic,
    planAnimated: (input) => planStandardVideo(input, aiCompleteWithUsage), renderSpec: ({ spec, assets, outPath }) => renderVideoSpec({ spec, assets, outPath, timeoutMs: 3 * 60_000 }), renderExplainer: (args) => renderExplainer({ ...args, storage: getMediaStorage(), complete: (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text) }), reviewAssets: (input) => reviewAssets({ ...input, completeWithImages: aiCompleteWithImages }), inspectPicture: pictureInspector(aiCompleteWithImages), renderCode: (args) => renderCodeVideo({ ...args, storage: getMediaStorage(), complete: aiCompleteCode, completeWithImages: aiCompleteWithImages }), writeConcept: (input) => writeConcept(input, (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text)), planVideo: (input, tools) => planVideo(input, (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text), tools), renderProductAd: (input) => renderProductAd({ ...input, storage: getMediaStorage() }), storage: getMediaStorage(), complete: aiComplete,
    loadInput: async (tenant) => (await loadMarketingInput(tenant)).input,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs: 5000, clipTimeoutMs: 8 * 60_000,
  };
}

/** Whether Runway (the premium path) can be used right now: it is connected, the encoder is present, and it has not been switched off. */
export function videoGenerationAvailable(): boolean {
  return process.env.MARKETING_VIDEO_GENERATION !== 'off' && isRunwayConfigured() && ffmpegAvailable();
}

/** The engine an earlier finished video was made with (videos from before the free path existed were all Runway), or null when there is none. */
export const engineOf = (earlier: Pick<MarketingJob, 'storyboard'> | null): VideoEngine | null => (earlier?.storyboard ? (earlier.storyboard.engine ?? 'runway') : null);

/** The engine a job will use: the earlier video's, unless the owner's words switch it. */
export async function engineForJob(tenantId: string, job: Pick<MarketingJob, 'userMessage' | 'brief'>): Promise<VideoEngine> {
  if (job.brief.reference_id) return 'animated'; // a video copied from a reference is always made the free way
  const earlier = job.brief.iteration_of ? await getMarketingJob(tenantId, job.brief.iteration_of).catch(() => null) : null;
  return engineFor({ message: job.userMessage, style: job.brief.style, earlier: engineOf(earlier) });
}

/** Whether a video can be made the way it was asked for. The free animation needs only the video encoder on this server. */
export const engineAvailable = (engine: VideoEngine): boolean => (engine === 'animated' ? ffmpegAvailable() : videoGenerationAvailable());

// ---- progress, kept in memory while a video is being made ----------------------------------------------------------------

export type SceneState = 'waiting' | 'making' | 'done' | 'failed';
export type Progress = { phase: 'planning' | 'making' | 'joining' | 'music'; scenes: Array<{ role: string; state: SceneState }>; total: number; done: number };
const workers = new Map<string, Progress>();
/** Progress for a video being made right now. Null when none is (including after the server restarted). */
export const getGenerationProgress = (jobId: string): Progress | null => workers.get(jobId) ?? null;
export const isGenerating = (jobId: string) => workers.has(jobId);

// ---- helpers -----------------------------------------------------------------------------------------------------------

export type ReferenceCheck = { detected: { brands: string[]; words: string[]; phrases: string[] }; found_first: number; regenerated: number; redacted: boolean; found_final: number; passed: boolean };
class SceneFailure extends Error { constructor(public readonly publicMessage: string) { super(publicMessage); } }

/** Whether the failed run may have used credits: the clips Runway accepted before it stopped. */
export const creditsNote = (total: number | null) => (total ? `About ${total} Runway credits may have been used before it stopped.` : 'No Runway credits were used.');

/** A plain sentence for the owner. It never contains keys, headers or raw responses. */
export function failureMessage(error: unknown): string {
  if (error instanceof SceneFailure || error instanceof PlannerError) return error.publicMessage;
  if (error instanceof Error && /FFmpeg/i.test(error.message)) return 'The video encoder had a problem joining the clips.';
  if (error instanceof Error && /took too long|timed out/i.test(error.message)) return 'The video took too long to make and was stopped.';
  if (error instanceof Error && /downloaded|larger than expected/i.test(error.message)) return 'A finished clip could not be downloaded.';
  const known = runwayProblem(error);
  return known.startsWith('Something went wrong talking to Runway') ? 'Something went wrong while making the video, and nothing was finished.' : known;
}

/** The owner's own photo as a data URI the video service accepts (at most 5 MB), shrunk to a JPEG if it is large. */
export async function referenceDataUri(tenantId: string, assetId: string, storage: MediaStorage): Promise<string | null> {
  const [file, meta] = await Promise.all([storage.openAsset(tenantId, assetId), storage.getAssetMeta(tenantId, assetId)]);
  if (!file || !meta) return null;
  const bytes = await file.read();
  if (bytes.length <= 3_500_000) return `data:${meta.mime};base64,${bytes.toString('base64')}`;
  const { assets } = await loadAssets({ ids: [assetId], tenantId, storage });
  const image = assets.get(assetId);
  if (!image) return null;
  const { createCanvas } = await import('@napi-rs/canvas');
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
  const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 85).toString('base64')}`;
}

/** The branded end card: the business's colours, logo and name, and the call to action in its own words. */
export async function renderEndCard({ tenantId, text, seconds, outPath, storage }: { tenantId: string; text: string; seconds: number; outPath: string; storage: MediaStorage }): Promise<void> {
  const kit = await loadBrandKit(tenantId);
  const logoId = pickLogo(await storage.listAssets(tenantId), kit.logoUrl);
  const { assets } = await loadAssets({ ids: logoId ? [logoId] : [], tenantId, storage, logoUrl: kit.logoUrl });
  const hasLogo = !!logoId && assets.has(logoId);
  const dark = ((n) => ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114)(parseInt(kit.primary.replace('#', '').padEnd(6, '0').slice(0, 6), 16)) < 140;
  const result = validateSpec({
    version: 1, size: '720x1280', fps: 30, audio: 'silent',
    brand: { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: kit.accent, textColor: dark ? '#FFFFFF' : '#0B1F44', ...(hasLogo ? { logo: logoId } : {}) },
    scenes: [{
      seconds, background: { type: 'gradient', from: kit.primary, to: kit.secondary, angle: 160 },
      elements: [
        { type: 'brand', position: 'top', animation: { type: 'fade', duration: 0.4 } },
        { type: 'text', text, x: 540, y: 640, width: 860, size: 84, weight: 800, color: dark ? '#FFFFFF' : '#0B1F44', align: 'center', animation: { type: 'pop', delay: 0.2, duration: 0.6, easing: 'backOut' } },
        ...(kit.name ? [{ type: 'text' as const, text: kit.name, x: 540, y: 1180, width: 860, size: 48, weight: 700 as const, color: dark ? '#FFFFFF' : '#0B1F44', align: 'center' as const, animation: { type: 'fade' as const, delay: 0.7, duration: 0.5 } }] : []),
      ],
    }],
  });
  if (!result.ok) throw new Error(result.error);
  await renderVideoSpec({ spec: result.spec as VideoSpec, assets, outPath, timeoutMs: 90_000 });
}

// ---- making one clip ------------------------------------------------------------------------------------------------------

async function waitForClip(deps: GenerationDeps, taskId: string): Promise<string> {
  const deadline = Date.now() + deps.clipTimeoutMs; let hiccups = 0;
  for (;;) {
    let state: VideoTaskState;
    try { state = await deps.checkClip(taskId); hiccups = 0; } catch (error) { hiccups += 1; if (hiccups >= 4) throw new SceneFailure(failureMessage(error)); await deps.sleep(deps.pollMs); continue; }
    if (state.status === 'succeeded' && state.url) return state.url;
    if (state.status === 'failed') throw new SceneFailure(state.message ?? 'A scene could not be made.');
    if (Date.now() > deadline) throw new SceneFailure('A scene took too long to make and was stopped.');
    await deps.sleep(deps.pollMs);
  }
}

async function makeClip(deps: GenerationDeps, tenantId: string, scene: StoryboardScene, credits: { total: number | null }): Promise<string> {
  const reference = scene.reference_asset_id ? await referenceDataUri(tenantId, scene.reference_asset_id, deps.storage) : null;
  if (scene.reference_asset_id && !reference) throw new SceneFailure('One of your selected photos is no longer available. Ask for the video again.');
  const attempt = async () => {
    const started = await deps.startClip({ prompt: scene.prompt ?? '', seconds: scene.seconds, ...(reference ? { imageDataUri: reference } : {}) });
    if (started.estimatedCredits !== null) credits.total = (credits.total ?? 0) + started.estimatedCredits;
    return waitForClip(deps, started.taskId);
  };
  try { return await attempt(); } catch (first) {
    // one more try for a scene that failed, unless the service refused outright (key, credits or access), which a retry cannot fix
    if (first instanceof Error && !(first instanceof SceneFailure) && /not accept|not allowed|credits|connected/i.test(runwayProblem(first))) throw first;
    return attempt();
  }
}

/** Runs the tasks with at most `limit` at a time, and stops at the first failure. */
async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0; let failure: unknown = null;
  const lane = async () => { while (failure === null) { const index = next; next += 1; if (index >= items.length) return; try { await work(items[index], index); } catch (error) { failure = error; } } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure !== null) throw failure;
}

// ---- the whole job -------------------------------------------------------------------------------------------------------

/** Makes the video for a job already marked "generating". Resolves when the job is "ready" or "failed"; it never throws. */
export async function runGeneration({ tenant, job, deps = defaultDeps() }: { tenant: Tenant; job: MarketingJob; deps?: GenerationDeps }): Promise<'ready' | 'failed'> {
  // a change to a video that is already made redoes only what it has to; everything else is made from scratch
  const earlier = job.brief.iteration_of ? await getMarketingJob(tenant.id, job.brief.iteration_of).catch(() => null) : null;
  // which way it is made: Pilot's free animation unless the owner asked for the premium look. A change keeps the engine unless they ask to switch.
  const earlierEngine = engineOf(earlier);
  const engine = engineFor({ message: job.userMessage, style: job.brief.style, earlier: earlierEngine });
  if (earlier?.status === 'ready' && earlier.storyboard && earlier.result?.video_url && engine === earlierEngine) {
    const plan = planIteration({ previousBrief: earlier.brief, storyboard: earlier.storyboard, nextBrief: job.brief, message: job.userMessage, engine });
    if (plan.kind !== 'full' && !(plan.kind === 'recut' && (earlier.storyboard.renderer === 'code' || earlier.storyboard.renderer === 'explainer'))) return runIteration({ tenant, job, earlier, plan, engine, deps });
  }
  const earlierItem = earlier?.result?.library_item_id ?? null; // a remake of a finished video updates its Library draft instead of adding another
  if (engine === 'animated') return runAnimated({ tenant, job, deps, earlierItem, forceCode: earlier?.storyboard?.renderer === 'code', forceInvent: earlier?.storyboard?.code_style === 'invent' || earlier?.storyboard?.code_style === 'custom', forceExplainer: earlier?.storyboard?.renderer === 'explainer' });
  // ---- Runway: the premium path (only reached when the owner asked for it) ----
  let dir: string | null = null;
  const credits: { total: number | null } = { total: null };
  const progress: Progress = { phase: 'planning', scenes: [], total: 0, done: 0 };
  workers.set(job.id, progress);
  let storyboard: Storyboard | null = null;
  try {
    const input = await deps.loadInput(tenant);
    storyboard = await buildStoryboard({ brief: job.brief, selection: job.selection, input, complete: deps.complete });
    storyboard.engine = 'runway';
    await saveJobStoryboard(tenant.id, job.id, storyboard);
    progress.scenes = storyboard.scenes.map((scene) => ({ role: scene.role, state: 'waiting' as SceneState })); progress.total = storyboard.scenes.length; progress.phase = 'making';

    const workDir = await deps.storage.makeTempDir(`gen-${job.id}`); dir = workDir;
    const files: string[] = new Array(storyboard.scenes.length);
    const clipScenes = storyboard.scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.kind === 'clip');
    await pool(clipScenes, 2, async ({ scene, index }) => {
      progress.scenes[index].state = 'making';
      try {
        const link = await makeClip(deps, tenant.id, scene, credits);
        const file = path.join(workDir, `clip-${index}.mp4`); await writeFile(file, await deps.fetchClip(link)); files[index] = file;
        scene.clip_video_id = await keepClip(deps, tenant.id, file); // saved, so a later change (a new ending, a darker look, one scene) can reuse it
        progress.scenes[index].state = 'done'; progress.done += 1;
      } catch (error) { progress.scenes[index].state = 'failed'; throw error; }
    });
    for (const { scene, index } of storyboard.scenes.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.kind === 'end_card')) {
      progress.scenes[index].state = 'making';
      const file = path.join(workDir, `end-${index}.mp4`);
      await renderEndCard({ tenantId: tenant.id, text: scene.on_screen_text, seconds: scene.seconds, outPath: file, storage: deps.storage });
      files[index] = file; progress.scenes[index].state = 'done'; progress.done += 1;
    }

    progress.phase = 'joining';
    const out = path.join(workDir, 'final.mp4');
    await deps.stitch(files, out);
    progress.phase = 'music';
    storyboard.music_seed = job.id;
    const { finalPath, musicNote } = await withMusic(deps, workDir, out, job, job.id);
    const videoId = randomUUID();
    await deps.storage.saveVideo(tenant.id, videoId, finalPath);

    await saveJobStoryboard(tenant.id, job.id, storyboard); // now with the saved clip ids
    const link = videoLink(videoId);
    const libraryItemId = await (earlierItem ? updateLibraryItem(tenant.id, earlierItem, job, storyboard, link, musicNote, 'runway') : addToLibrary(tenant.id, job, storyboard, link, musicNote)).catch((error) => { console.error('library item could not be added', error instanceof Error ? error.name : 'unknown'); return null; });
    const result: JobResult = { video_url: link, caption: storyboard.caption, hashtags: storyboard.hashtags, cta: storyboard.cta, total_seconds: storyboard.total_seconds, scene_count: storyboard.scenes.length, provider: 'Runway', estimated_credits: credits.total, music: musicNote, engine: 'runway', library_item_id: libraryItemId, error: null, finished_at: new Date().toISOString() };
    await finishJob(tenant.id, job.id, 'ready', result);
    console.info(JSON.stringify({ event: 'marketing-video.ready', tenantId: tenant.id, jobId: job.id, scenes: storyboard.scenes.length, seconds: storyboard.total_seconds, estimatedCredits: credits.total }));
    return 'ready';
  } catch (error) {
    const reason = failureMessage(error);
    console.error('marketing video failed', error instanceof Error ? error.name : 'unknown');
    await finishJob(tenant.id, job.id, 'failed', { video_url: null, caption: storyboard?.caption ?? '', hashtags: storyboard?.hashtags ?? [], cta: storyboard?.cta ?? '', total_seconds: storyboard?.total_seconds ?? 0, scene_count: storyboard?.scenes.length ?? 0, provider: 'Runway', estimated_credits: credits.total, music: null, engine: 'runway', library_item_id: null, error: `${reason} ${creditsNote(credits.total)}`, finished_at: new Date().toISOString() }).catch(() => undefined);
    return 'failed';
  } finally {
    workers.delete(job.id);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ---- shared steps ------------------------------------------------------------------------------------------------------

/** Saves a copy of a finished clip in the business's storage, so a later change can reuse it. Never fails the job. */
async function keepClip(deps: GenerationDeps, tenantId: string, file: string): Promise<string | null> {
  try { const id = randomUUID(); await copyFile(file, `${file}.keep`); await deps.storage.saveVideo(tenantId, id, `${file}.keep`); return id; } catch { return null; }
}

/**
 * The music: composed to fit the brief's style and mixed in without re-encoding the picture. If the owner asked for none, the track is
 * silent. If it cannot be added, the video is kept as it is and the result says there is no music.
 */
async function withMusic(deps: GenerationDeps, workDir: string, videoPath: string, job: MarketingJob, seed: string): Promise<{ finalPath: string; musicNote: string | null }> {
  const profile = musicProfile(job.brief.style, job.brief.key_instructions, seed);
  if (!profile) return { finalPath: videoPath, musicNote: null };
  try {
    const scored = path.join(workDir, `with-music-${randomUUID().slice(0, 8)}.mp4`);
    await deps.addMusic({ videoPath, outPath: scored, profile, wavPath: path.join(workDir, `music-${randomUUID().slice(0, 8)}.wav`), seed });
    return { finalPath: scored, musicNote: `${profile.name}: ${profile.description}` };
  } catch (error) { console.error('music could not be added', error instanceof Error ? error.name : 'unknown'); return { finalPath: videoPath, musicNote: null }; }
}

/** The id of one of the business's own finished videos, from its link. */
const videoIdOf = (link: string) => link.match(/\/([A-Za-z0-9-]{8,64})\.mp4$/)?.[1] ?? null;
async function readVideo(storage: MediaStorage, tenantId: string, id: string): Promise<Buffer | null> {
  const file = await storage.openVideo(tenantId, id); if (!file) return null;
  const parts: Buffer[] = []; for await (const part of file.stream()) parts.push(Buffer.from(part)); return Buffer.concat(parts);
}

// ---- the free animated engine ---------------------------------------------------------------------------------------------------

/** What the planner is asked to make: built from the brief (which already holds every change), so it is complete on its own. */
export function animatedRequest(job: Pick<MarketingJob, 'brief'>): string {
  const b = job.brief;
  return [`Make ${b.platform === 'tiktok' ? 'a TikTok' : 'an Instagram'} video about: ${b.main_subject}.`, b.style.length ? `Style: ${b.style.join(', ')}.` : '', b.length_seconds ? `About ${b.length_seconds} seconds.` : '', b.key_instructions.length ? `The owner also asked for: ${b.key_instructions.join('; ')}.` : ''].filter(Boolean).join(' ');
}

/** The words of a spec's closing scene are changed in place: its biggest text is the call to action. */
export function editEndText(spec: VideoSpec, text: string): VideoSpec {
  const next = structuredClone(spec); const last = next.scenes[next.scenes.length - 1];
  const headline = last.elements.filter((el): el is Extract<typeof el, { type: 'text' }> => el.type === 'text').sort((a, b) => b.size - a.size)[0];
  if (!headline) throw new SceneFailure('I could not find the ending to change. Ask me to make the video again.');
  headline.text = text.slice(0, 90); headline.size = text.length > 42 ? 76 : text.length > 20 ? 92 : 108;
  return next;
}

/** The scene plan Pilot drew, in the same shape the rest of the pipeline uses. */
function animatedStoryboard(plan: PlanResult, caption: { caption: string; hashtags: string[]; cta: string }, brief: MarketingJob['brief'], seed: string): Storyboard {
  const last = plan.summary.scenes.length - 1;
  const scenes: StoryboardScene[] = plan.summary.scenes.map((scene, index) => ({ role: index === 0 ? 'hook' : index === last ? 'ending' : index === 1 ? 'main' : 'support', kind: index === last ? 'end_card' : 'clip', seconds: scene.seconds, description: [scene.headline, scene.subtext].filter(Boolean).join(' - '), prompt: null, reference_asset_id: null, on_screen_text: scene.headline, clip_video_id: null }));
  return { scenes, total_seconds: plan.summary.durationSeconds, direction: styleDirection(brief.style), caption: caption.caption, hashtags: caption.hashtags, cta: caption.cta || plan.summary.cta, grade: 0, engine: 'animated', animated_spec: plan.spec, music_seed: seed };
}

/**
 * Makes a video the free way: Pilot plans the scenes (the owner's matching photos with slow motion, brand colours, text overlays,
 * transitions and a closing call to action), draws them on this server, and adds original music and a caption. No outside video
 * service is called, so it costs nothing. Resolves when the job is "ready" or "failed"; it never throws.
 */
/** What the rest of the pipeline (caption, Library, storyboard) needs to know about an explainer, shaped like a planned video. */
function explainerPlan(explained: Extract<ExplainerResult, { ok: true }>, kit: BrandKit): PlanResult {
  const spec = validateSpec({ version: 1, size: '1080x1920', fps: 30, audio: 'silent', brand: { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: kit.accent, textColor: '#FFFFFF' }, scenes: [{ seconds: 1, background: { type: 'solid', color: kit.primary }, elements: [] }] });
  if (!spec.ok) throw new Error(spec.error);
  const last = explained.scenes.at(-1)!;
  return { spec: spec.spec, platform: 'instagram', summary: { durationSeconds: explained.seconds, size: '1080x1920', sceneCount: explained.scenes.length, hook: explained.scenes[0].headline, cta: last.headline, scenes: explained.scenes.map((scene) => ({ role: scene.role === 'cta' ? 'cta' : 'detail', seconds: scene.seconds, headline: scene.headline, subtext: scene.subtext, photo: null, transition: 'fade' })), photosUsed: [] }, copy: { hook: explained.scenes[0].headline, caption: '', cta: last.headline, hashtags: [] }, notes: [], reasoning: '', usage: { calls: 0, inputTokens: 0, outputTokens: 0 } } as unknown as PlanResult;
}

async function runAnimated({ tenant, job, deps, earlierItem, forceCode = false, forceInvent = false, forceExplainer = false }: { forceInvent?: boolean; tenant: Tenant; job: MarketingJob; deps: GenerationDeps; earlierItem: string | null; forceCode?: boolean; forceExplainer?: boolean }): Promise<'ready' | 'failed'> {
  let dir: string | null = null;
  const progress: Progress = { phase: 'planning', scenes: [], total: 0, done: 0 };
  workers.set(job.id, progress);
  let storyboard: Storyboard | null = null;
  try {
    const input = await deps.loadInput(tenant);
    const kit = await loadBrandKit(tenant.id);
    const all = await deps.storage.listAssets(tenant.id);
    // only photos that fit the subject are used; with none, the video is made of brand colours, text and motion
    const chosen = new Set(job.selection?.has_good_match ? job.selection.selected_assets.map((asset) => asset.id) : []);
    // nothing of the owner's fits the subject: generate brand-coloured artwork for it (free, drawn here, saved to Photos as "Made by Pilot") and use that
    // wherever a photo would go. If it cannot be made, the video is plain brand colours and text, as before.
    let generated: AssetMeta | null = null; let generatedKind: 'ai-image' | 'artwork' = 'artwork';
    if (!chosen.size) {
      // a realistic AI image when the owner has enabled it, else the free artwork (see generated-visual.ts)
      const visual = await ensureGeneratedVisual({ tenantId: tenant.id, subject: job.brief.main_subject, kit, business: { businessName: input.brief.businessName, businessType: input.brief.businessType, location: input.brief.location, services: input.brief.services }, storage: deps.storage, make: deps.makePicture, complete: deps.complete }).catch((error) => { console.error('generated visual failed', error instanceof Error ? error.name : 'unknown'); return null; });
      if (visual) { generated = visual.asset; generatedKind = visual.kind; chosen.add(visual.asset.id); if (!all.some((asset) => asset.id === visual.asset.id)) all.push(visual.asset); }
    }
    const platform: PlatformId = job.brief.platform === 'tiktok' ? 'tiktok' : 'instagram';
    // An explainer (a voiceover, floating task bubbles, a form that fills in, a schedule that builds itself) when the owner asked for one. If it cannot be made,
    // the ordinary free video below is made instead.
    let explained: ExplainerResult | null = null; let explainDir: string | null = null;
    // a reference video the owner uploaded: the structure, pace, look and scene kinds it taught Pilot (the owner's wording can ask for or against a voiceover)
    const reference = job.brief.reference_id ? await loadReference(tenant.id, job.brief.reference_id).catch(() => null) : null;
    const noVoice = /\b(?:no|without)\s+(?:a\s+)?(?:voice|voiceover|narrat\w*)\b/i.test(job.userMessage); const askedVoice = /\b(?:voice[- ]?over|narrat\w+)\b/i.test(job.userMessage);
    const blueprint = reference ? buildBlueprint(reference, { photos: chosen.size > 0, targetSeconds: job.brief.length_seconds, voice: noVoice ? false : askedVoice ? true : null, allowed: [job.userMessage, input.brief.businessName, input.brief.businessType, input.brief.services.join(' '), input.brief.description].join(' ') }) : null;
    // what the reference says (its brand, words, lines) is kept as a structured list that must not reach the new video
    const ownerWords = [job.userMessage, input.brief.businessName, input.brief.businessType, input.brief.services.join(' '), input.brief.description, input.brief.sellingPoints.join(' ')].join(' ');
    const forbidden: ReferenceText | null = reference ? (blueprint?.design?.forbidden ?? forbiddenFor({ brands: reference.style.referenceText?.brands ?? [], words: [...(reference.style.referenceText?.words ?? []), ...(reference.style.avoid ?? [])], phrases: reference.style.referenceText?.phrases ?? [] }, ownerWords)) : null;
    const textCheck = { firstFound: 0, regenerated: 0, redacted: false, finalFound: 0 };
    if (blueprint) console.info(JSON.stringify({ event: 'marketing-video.reference-blueprint', jobId: job.id, engine: blueprint.engine, scenes: blueprint.slots.map((slot) => ({ type: slot.type, seconds: slot.seconds, transition: slot.transition })), design: blueprint.design ?? null }));
    if (deps.renderExplainer && (forceExplainer || (blueprint ? blueprint.engine === 'explainer' : useExplainer(job.userMessage)))) {
      explainDir = await deps.storage.makeTempDir(`gen-${job.id}`); dir = explainDir; progress.phase = 'making';
      explained = await deps.renderExplainer({ tenantId: tenant.id, request: job.userMessage, kit, logoId: pickLogo(all, kit.logoUrl), workDir: explainDir, outPath: path.join(explainDir, 'explainer.mp4'), business: { name: kit.name || input.brief.businessName, type: input.brief.businessType, location: input.brief.location, services: input.brief.services, description: input.brief.description, tone: input.brief.brandVoice?.tone ?? '' }, photos: all.filter((asset) => chosen.has(asset.id)), style: job.brief.style, instructions: job.brief.key_instructions, targetSeconds: job.brief.length_seconds ?? undefined, seed: job.id, blueprint });
      if (!explained.ok) console.warn(JSON.stringify({ event: 'marketing-video.explainer-fallback', jobId: job.id, reason: explained.reason }));
    }
    // Pilot writes its own drawing code when asked to, and also when the templates do not suit the request (something creative, or a subject the business's
    // information and photos say nothing about). For those it invents the WHOLE video first (a concept: scenes, pacing, visuals), without the service-based plan,
    // and draws every scene itself. If that fails it says so and uses the existing free paths: the scene library, then the standard video.
    // a reference that is a product advert is always made by the custom code path, from the reference's design
    const referenceCustom = blueprint?.engine === 'custom' && !!blueprint.design;
    // a reference that is a montage of pictures or footage: its camera, cuts, grade, overlays and text style drive a styled video of the business's own photos
    const referenceStyled = blueprint?.engine === 'styled' && !!blueprint.styled && !!blueprint.design;
    const choice = referenceStyled ? { use: true, invent: true, why: 'the reference video is a montage: its camera, cuts, colour grade, overlays and text style drive a styled video' } : referenceCustom ? { use: true, invent: true, why: 'the reference video is a product advert: its design drives a fully custom video' } : chooseCodeVideo({ message: job.userMessage, forced: forceCode, invented: forceInvent, subject: job.brief.main_subject, business: { businessName: input.brief.businessName, businessType: input.brief.businessType, services: input.brief.services, description: input.brief.description, promotions: input.brief.promotions, sellingPoints: input.brief.sellingPoints }, hasPhotoMatch: job.selection?.has_good_match === true, hasReference: !!job.brief.reference_id });
    let coded: CodeVideoResult | null = null; let codeStyle: 'invent' | 'open' | 'custom' = 'open'; let inventNote: string | undefined; let customPlan: PlanResult | null = null; let attemptedCustom = false;
    let earlyDir: string | null = explainDir;
    const logoId = pickLogo(all, kit.logoUrl);
    if (!explained?.ok && deps.renderCode && deps.writeConcept && choice.use && choice.invent) {
      attemptedCustom = true; earlyDir = explainDir ?? await deps.storage.makeTempDir(`gen-${job.id}`); dir = earlyDir; progress.phase = 'making';
      console.info(JSON.stringify({ event: 'marketing-video.code-path', jobId: job.id, invent: true, custom: true, why: choice.why }));
      // the product: the business's own photo of it when there is one, else a picture generated for this request, else a drawn product (see product-asset.ts)
      const chosenAssets = all.filter((asset) => chosen.has(asset.id));
      const generatedPick = chosenAssets.find((asset) => asset.tags.includes('generated'));
      const product = await resolveProductAsset({ tenantId: tenant.id, subject: job.brief.main_subject, business: { businessName: input.brief.businessName, businessType: input.brief.businessType }, storage: deps.storage, generated: generatedPick ? { id: generatedPick.id, label: generatedPick.label } : null });
      console.info(JSON.stringify({ event: 'marketing-video.product-asset', jobId: job.id, found: product.found, mode: product.mode, asset: product.asset, terms: product.terms, considered: product.considered, reason: product.reason }));
      const ownProduct = product.found ? all.find((asset) => asset.id === product.asset!.id) : undefined;
      // a realistic photograph of the subject (the business's own, or the one generated for this request) is the MAIN VISUAL of a custom video: it is shown and moved, not redrawn from shapes
      // the pictures are looked at once, so the hero is chosen by what is IN them. Pilot's own abstract artwork is never a photograph of the subject, with or without a look.
      const review = !referenceCustom && deps.reviewAssets ? await deps.reviewAssets({ tenantId: tenant.id, request: job.userMessage, subject: job.brief.main_subject, assets: all, storage: deps.storage, workDir: earlyDir }).catch(() => null) : null;
      const isArtwork = (id: string) => { const meta = all.find((asset) => asset.id === id); return !!meta && provenanceOf(meta) === 'pilot_artwork'; };
      const seen = new Map((review?.assets ?? []).map((fact) => [fact.id, fact]));
      let heroPhotoAsset = !referenceCustom && (product.found || (product.mode === 'generated_image' && !!product.asset && !isArtwork(product.asset.id))) && product.asset ? product.asset : null;
      if (review?.source === 'vision') heroPhotoAsset = review.hero ? { id: review.hero.id, label: review.hero.label } : null;
      if (review) console.info(JSON.stringify({ event: 'marketing-video.asset-review', jobId: job.id, source: review.source, considered: review.considered, reviewed: review.reviewed, hero: review.hero, note: review.note, assets: review.assets.map((fact) => ({ id: fact.id, label: fact.label, provenance: fact.provenance, kind: fact.kind, shows: fact.shows, relevance: fact.relevance, quality: fact.quality, best_use: fact.best_use })) }));
      const heroAsset = heroPhotoAsset ? all.find((asset) => asset.id === heroPhotoAsset.id) : undefined;
      const supports = review?.source === 'vision' ? review.assets.filter((fact) => (fact.best_use === 'support' || fact.best_use === 'hero') && fact.relevance >= 5).map((fact) => all.find((asset) => asset.id === fact.id)).filter((asset): asset is NonNullable<typeof asset> => !!asset) : [];
      let photoList = [...(heroAsset ? [heroAsset] : []), ...(ownProduct && ownProduct.id !== heroAsset?.id ? [ownProduct] : []), ...supports, ...chosenAssets.filter((asset) => asset.id !== ownProduct?.id && asset.id !== heroAsset?.id && !isArtwork(asset.id))].filter((asset, i, list) => list.findIndex((other) => other.id === asset.id) === i).slice(0, 3).map((asset) => { const fact = seen.get(asset.id); return { id: asset.id, label: asset.label, ...(fact ? { shows: fact.shows, use: fact.best_use } : {}) }; });
      let assetFacts = Object.fromEntries([...seen.values()].map((fact) => [fact.id, { shows: fact.shows, kind: fact.kind, best_use: fact.best_use, ...(fact.focus ? { focus: fact.focus } : {}) }]));
      // invented graphics and app UI (a product-explainer look) when the request explains, prices or lists something or no photograph is the right main visual; the photograph-led look otherwise
      const look: 'photo' | 'motion' = referenceCustom || referenceStyled ? 'photo' : lookFor({ message: job.userMessage, hasHeroPhoto: !!heroPhotoAsset, hasProp: !!heroKindFor(`${job.brief.main_subject} ${job.userMessage}`) });
      console.info(JSON.stringify({ event: 'marketing-video.look', jobId: job.id, look }));
      if (heroPhotoAsset) console.info(JSON.stringify({ event: 'marketing-video.hero-photo', jobId: job.id, hero: heroPhotoAsset, source: product.found ? 'own photo' : 'generated realistic image' }));
      // a styled video is made of several of the business's own photos, best first, each with where its subject is
      let styledPicks: StyledPick[] = [];
      if (referenceStyled) { styledPicks = await pickStyledPhotos({ tenantId: tenant.id, storage: deps.storage, assets: all, generated: all.filter((a) => chosen.has(a.id) && a.tags.includes('generated')), topic: `${job.brief.main_subject} ${job.userMessage}` }).catch(() => []); if (styledPicks.length) photoList = styledPicks.map((pick) => ({ id: pick.id, label: pick.label })); console.info(JSON.stringify({ event: 'marketing-video.styled-photos', jobId: job.id, photos: styledPicks.map((pick) => ({ id: pick.id, label: pick.label, quality: pick.quality })) })); }
      const conceptInput: ConceptInput = { request: job.userMessage, subject: job.brief.main_subject, seconds: job.brief.length_seconds ?? (referenceStyled ? Math.round(blueprint!.styled!.totalSeconds) : referenceCustom ? Math.round(blueprint!.design!.totalSeconds) : 15), ...(referenceStyled ? { reference: styledDesign(blueprint!.design!, blueprint!.styled!) } : referenceCustom ? { reference: blueprint!.design } : {}), business: { name: kit.name || input.brief.businessName, type: input.brief.businessType, location: input.brief.location, services: input.brief.services, description: input.brief.description, tone: input.brief.brandVoice?.tone ?? '' }, photos: photoList, ...(heroPhotoAsset ? { heroPhoto: heroPhotoAsset } : {}), props: PROP_KINDS, look, style: job.brief.style, platform: job.brief.platform, instructions: job.brief.key_instructions };
      // the director's order: the creative strategy first (the model decides what kind of video this is and how it is built), then the storyboard from it. Without a strategy the older single step is used.
      let plannedStrategy: Strategy | null = null; let concept: Concept | null = null;
      if (!referenceCustom && !referenceStyled && deps.planVideo) {
        const pictures = review ? review.assets.map((fact) => ({ id: fact.id, label: fact.label, provenance: fact.provenance, kind: fact.kind, shows: fact.shows, relevance: fact.relevance, quality: fact.quality, best_use: fact.best_use })) : all.filter((asset) => asset.kind !== 'logo').slice(0, 8).map((asset) => ({ id: asset.id, label: asset.label, provenance: provenanceOf(asset) }));
        // a picture the strategy asks for is made with the same generator the app already uses (switched on by the owner, capped per day, no people or text); only a real generated picture counts, never the stand-in artwork
        const generate: GenerateVisual = async (subject, look, style) => { const made = await ensureGeneratedVisual({ tenantId: tenant.id, subject, ...(look ? { look } : {}), ...(style ? { style } : {}), kit, business: { businessName: input.brief.businessName, businessType: input.brief.businessType, location: input.brief.location, services: input.brief.services }, storage: deps.storage, make: deps.makePicture, ...(deps.inspectPicture ? { inspect: deps.inspectPicture } : {}), complete: deps.complete }).catch(() => null); return made && made.kind === 'ai-image' ? { id: made.asset.id, label: made.asset.label, reused: made.reused } : null; };
        const planned = await deps.planVideo({ ...conceptInput, pictures }, realisticImagesEnabled() || deps.makePicture ? { generate } : {}).catch(() => null);
        if (planned) console.info(JSON.stringify({ event: 'marketing-video.plan', jobId: job.id, strategy: planned.strategy ? { format: planned.strategy.format, visual: planned.strategy.visual, pacing: planned.strategy.pacing, beats: planned.strategy.beats.length, coverage: planned.strategy.assets.coverage } : null, scenes: planned.concept?.scenes.length ?? 0, notes: planned.notes }));
        if (planned?.concept) { concept = planned.concept; plannedStrategy = planned.strategy; if (plannedStrategy) { const byId = new Map([...pictures.map((p) => [p.id, p.label] as const), ...planned.generated.map((g) => [g.id, g.label] as const)]); for (const g of planned.generated) { const meta = await deps.storage.getAssetMeta(tenant.id, g.id).catch(() => null); if (meta && !all.some((asset) => asset.id === g.id)) all.push(meta); seen.set(g.id, { id: g.id, label: g.label, provenance: 'ai_image', kind: 'ai_image', shows: g.subject, relevance: 8, quality: 7, best_use: 'support', width: meta?.width ?? 1024, height: meta?.height ?? 1536 }); } const used = plannedStrategy.assets.plan.filter((p) => p.role !== 'unused' && byId.has(p.id)).map((p) => ({ id: p.id, label: byId.get(p.id)! })); if (used.length) photoList = used; assetFacts = Object.fromEntries([...seen.values()].map((fact) => [fact.id, { shows: fact.shows, kind: fact.kind, best_use: fact.best_use, ...(fact.focus ? { focus: fact.focus } : {}) }])); } }
      }
      if (!concept) concept = await deps.writeConcept(conceptInput).catch(() => null);
      // reference-text protection: nothing of the reference's brand, words or lines may be in the new video. The concept is checked by code; if anything is found it is written
      // again (twice, with what was found added to the forbidden list), and as a last resort the offending words are taken out.
      if (concept && forbidden) {
        let found = findReferenceText(conceptSources(concept), forbidden); textCheck.firstFound = found.length;
        for (let again = 0; again < 2 && found.length; again += 1) {
          const extra: ReferenceText = { ...forbidden, words: [...forbidden.words, ...found.map((v) => v.found)] };
          concept = (await deps.writeConcept({ ...conceptInput, forbidden: extra }).catch(() => null)) ?? concept; textCheck.regenerated += 1;
          found = findReferenceText(conceptSources(concept), forbidden);
        }
        if (found.length) { concept = redactConcept(concept, forbidden); textCheck.redacted = true; }
      }
      if (concept) console.info(JSON.stringify({ event: 'marketing-video.concept', jobId: job.id, reference: referenceCustom, title: concept.title, mood: concept.mood, palette: concept.palette, scenes: concept.scenes.map((scene) => ({ role: scene.role, seconds: scene.seconds, headline: scene.headline, subtext: scene.subtext, visual: scene.visual, direction: scene.direction ?? null, photo: scene.photoId })) }));
      if (!concept) inventNote = 'The video idea could not be written.';
      else {
        const candidate = conceptPlan(concept, kit, photoList);
        codeStyle = 'custom';
        // a product advert reference: the scenes are built straight from the reference's design blueprint (the business's own photo as the hero when one fits, else the ready-made prop for the subject)
        let ad: CodeVideoResult | null = null;
        if (referenceStyled && styledPicks.length && deps.renderProductAd) {
          // the reference's shots, one by one: its camera, its joins, its grade and overlays and the way its words come in, over the business's own photos, with the brand colour as the accent
          const spec = blueprint!.styled!; const K = concept.scenes.length; const N = spec.scenes.length;
          const withPhotos: Concept = { ...concept, scenes: concept.scenes.map((scene, k) => ({ ...scene, photoId: photoList[k % photoList.length].id })) };
          const used = photoList.filter((photo) => withPhotos.scenes.some((scene) => scene.photoId === photo.id)); const names = used.map((_, i) => `p${i + 1}`); const focus = used.map((photo) => styledPicks.find((pick) => pick.id === photo.id)?.focus ?? { x: 0.5, y: 0.5 });
          const wordsAt = spec.scenes.map((_, j) => { const k = Math.floor((j * K) / N); return j === Math.ceil((k * N) / K) ? k : -1; });
          ad = await deps.renderProductAd({ tenantId: tenant.id, concept: withPhotos, kit, logoId, workDir: earlyDir, outPath: path.join(earlyDir, 'animated.mp4'), palette: conceptPalette(withPhotos), hero: used[0].id, photos: photoList, script: () => buildStyledScript({ concept: withPhotos, spec, photos: names, focus, accent: kit.accent, wordsAt }) });
          console.info(JSON.stringify({ event: 'marketing-video.styled', jobId: job.id, shots: N, photos: used.length, ok: ad.ok, grade: spec.look, overlays: spec.video.overlays, ...(ad.ok ? (process.env.PILOT_DEBUG_CODE === 'on' ? { script: ad.script } : {}) : { reason: ad.reason }) }));
          if (ad.ok) coded = ad;
        }
        if (!(ad && ad.ok) && referenceCustom && deps.renderProductAd) {
          // the hero: the business's own photo of the product, else the picture generated for it, else the drawn product; never a drawn one when the business's own exists
          const heroPhoto = product.found ? product.asset!.id : product.mode === 'generated_image' ? product.asset!.id : null; const kind = heroKindFor(`${job.brief.main_subject} ${job.userMessage}`);
          const hero = heroPhoto ? heroPhoto : kind ? `prop:${kind}` : null;
          if (hero) {
            ad = await deps.renderProductAd({ tenantId: tenant.id, concept, design: blueprint!.design!, kit, logoId, workDir: earlyDir, outPath: path.join(earlyDir, 'animated.mp4'), palette: conceptPalette(concept), hero, photos: photoList });
            console.info(JSON.stringify({ event: 'marketing-video.product-ad', jobId: job.id, hero, ok: ad.ok, palette: conceptPalette(concept), ...(ad.ok ? (process.env.PILOT_DEBUG_CODE === 'on' ? { script: ad.script } : {}) : { reason: ad.reason }) }));
            if (ad.ok) coded = ad;
          }
        }
        // two fresh attempts at drawing it before giving up: the first draft sometimes breaks a layout rule that a new draft does not
        for (let attempt = 0; attempt < 2 && !(ad && ad.ok); attempt += 1) {
          coded = await deps.renderCode({ tenantId: tenant.id, plan: candidate, kit, logoId, workDir: earlyDir, outPath: path.join(earlyDir, 'animated.mp4'), style: 'custom', subject: job.brief.main_subject, palette: conceptPalette(concept), look: plannedStrategy ? lookOf(plannedStrategy) : look, ...(plannedStrategy ? { strategy: plannedStrategy, ...(job.brief.platform ? { platform: job.brief.platform } : {}) } : {}), ...(Object.keys(assetFacts).length ? { assetFacts } : {}), ...(heroPhotoAsset && !plannedStrategy ? { heroPhoto: heroPhotoAsset } : {}), ...(referenceCustom ? { design: blueprint!.design } : {}), ...(forbidden ? { forbidden } : {}) });
          if (coded.ok) break; console.warn(JSON.stringify({ event: 'marketing-video.custom-attempt-failed', jobId: job.id, attempt: attempt + 1, reason: coded.reason }));
        }
        // the way back for a photographed subject: Pilot's own photo-led code (the photograph in motion with crops, light, grade, words and logo), before any shape-drawn or standard video
        if (!(coded && coded.ok) && heroPhotoAsset && deps.renderProductAd) {
          console.warn(JSON.stringify({ event: 'marketing-video.photo-ad-fallback', jobId: job.id, reason: coded?.ok === false ? coded.reason : 'the custom script was not made' }));
          const focus = await heroFocus((await (await deps.storage.openAsset(tenant.id, heroPhotoAsset.id))?.read()) ?? Buffer.alloc(0));
          const photoAd = await deps.renderProductAd({ tenantId: tenant.id, concept, kit, logoId, workDir: earlyDir, outPath: path.join(earlyDir, 'animated.mp4'), palette: conceptPalette(concept), hero: heroPhotoAsset.id, photos: photoList, script: (c, h) => buildPhotoAdScript(c, h, focus) });
          console.info(JSON.stringify({ event: 'marketing-video.photo-ad', jobId: job.id, hero: heroPhotoAsset, ok: photoAd.ok, ...(photoAd.ok ? {} : { reason: photoAd.reason }) }));
          if (photoAd.ok) coded = photoAd;
        }
        if (!coded) coded = { ok: false, reason: 'No custom video was drawn.' };
        if (coded.ok) customPlan = candidate; else { inventNote = coded.reason; console.warn(JSON.stringify({ event: 'marketing-video.custom-fallback', jobId: job.id, reason: coded.reason })); coded = null; codeStyle = 'open'; }
      }
    }
    const plan = explained?.ok ? explainerPlan(explained, kit) : customPlan ?? await deps.planAnimated({ request: animatedRequest(job), brief: input.brief, kit, assets: all.filter((asset) => chosen.has(asset.id)), logoId, context: { signals: input.signals, insights: input.insights }, platform, durationSeconds: job.brief.length_seconds ?? undefined });
    progress.phase = 'making';
    const workDir = earlyDir ?? await deps.storage.makeTempDir(`gen-${job.id}`); dir = workDir;
    const { spec, assets } = await loadPlanAssets(deps, tenant.id, plan.spec, kit.logoUrl);
    const silent = explained?.ok ? path.join(workDir, 'explainer.mp4') : path.join(workDir, 'animated.mp4');
    if (!explained?.ok && !coded?.ok && deps.renderCode && choice.use) {
      // the scene library written as code (also the way back from a custom video that could not be made), then the standard renderer
      if (choice.invent && !attemptedCustom) {
        console.info(JSON.stringify({ event: 'marketing-video.code-path', jobId: job.id, invent: true, why: choice.why }));
        codeStyle = 'invent'; coded = await deps.renderCode({ tenantId: tenant.id, plan, kit, logoId, workDir, outPath: silent, style: 'invent', subject: job.brief.main_subject });
        if (!coded.ok) { inventNote = coded.reason; console.warn(JSON.stringify({ event: 'marketing-video.invent-fallback', jobId: job.id, reason: coded.reason })); codeStyle = 'open'; coded = await deps.renderCode({ tenantId: tenant.id, plan, kit, logoId, workDir, outPath: silent, style: 'open' }); }
      } else if (choice.invent) coded = await deps.renderCode({ tenantId: tenant.id, plan, kit, logoId, workDir, outPath: silent, style: 'open' });
      else coded = await deps.renderCode({ tenantId: tenant.id, plan, kit, logoId, workDir, outPath: silent });
      if (!coded.ok) console.warn(JSON.stringify({ event: 'marketing-video.code-fallback', jobId: job.id, reason: coded.reason }));
    }
    if (!explained?.ok && !coded?.ok) await deps.renderSpec({ spec, assets, outPath: silent });
    progress.phase = 'music';
    // an explainer already has its voice and music mixed in
    const { finalPath, musicNote } = explained?.ok ? { finalPath: silent, musicNote: explained.note } : await withMusic(deps, workDir, silent, job, job.id);
    const words = await writeCaption({ brief: job.brief, input, platform, complete: deps.complete, scenes: plan.summary.scenes.map((scene) => [scene.headline, scene.subtext].filter(Boolean).join(' - ')) });
    // the last check before the video is accepted: every piece of text that is on screen or in the post, and the words in the drawing script, against the reference's own text
    let referenceCheck: ReferenceCheck | undefined;
    if (forbidden) {
      const gather = () => [...plan.summary.scenes.flatMap((scene, i) => [{ where: `scene ${i + 1} headline`, text: scene.headline }, { where: `scene ${i + 1} subtext`, text: scene.subtext }, ...(scene.items ?? []).map((item) => ({ where: `scene ${i + 1} item`, text: item }))]), { where: 'caption', text: words.caption }, { where: 'end card', text: words.end_card_text }, { where: 'call to action', text: words.cta }, ...words.hashtags.map((tag) => ({ where: 'hashtag', text: tag })), ...(coded?.ok ? scriptStrings(coded.script).map((text) => ({ where: 'drawing script', text })) : [])];
      let found = findReferenceText(gather(), forbidden); textCheck.firstFound += found.length;
      if (found.length) { words.caption = redact(words.caption, forbidden); words.end_card_text = redact(words.end_card_text, forbidden); words.cta = redact(words.cta, forbidden); words.hashtags = words.hashtags.filter((tag) => !findReferenceText([{ where: 'hashtag', text: tag }], forbidden).length); textCheck.redacted = true; found = findReferenceText(gather(), forbidden); }
      textCheck.finalFound = found.length;
      referenceCheck = { detected: { brands: forbidden.brands, words: forbidden.words, phrases: forbidden.phrases }, found_first: textCheck.firstFound, regenerated: textCheck.regenerated, redacted: textCheck.redacted, found_final: found.length, passed: found.length === 0 };
      console.info(JSON.stringify({ event: 'marketing-video.reference-text-check', jobId: job.id, ...referenceCheck, remaining: found.slice(0, 5) }));
      if (found.length) throw new SceneFailure('The new video still contained wording from your reference video, so it was not accepted. Please try again.');
    }
    storyboard = animatedStoryboard({ ...plan, spec }, words, job.brief, job.id);
    storyboard.renderer = explained?.ok ? 'explainer' : coded?.ok ? 'code' : 'template';
    if (explained?.ok) delete storyboard.animated_spec;
    if (coded?.ok) { storyboard.code_script_sha = coded.scriptSha; storyboard.code_style = codeStyle; delete storyboard.animated_spec; } // a code-drawn video is changed by asking for it again, not by recutting a template
    await saveJobStoryboard(tenant.id, job.id, storyboard);
    const videoId = randomUUID(); await deps.storage.saveVideo(tenant.id, videoId, finalPath);
    const link = videoLink(videoId);
    const libraryItemId = await (earlierItem ? updateLibraryItem(tenant.id, earlierItem, job, storyboard, link, musicNote, 'animated') : addToLibrary(tenant.id, job, storyboard, link, musicNote, 'animated')).catch((error) => { console.error('library item could not be added', error instanceof Error ? error.name : 'unknown'); return null; });
    const result: JobResult = { video_url: link, caption: storyboard.caption, hashtags: storyboard.hashtags, cta: storyboard.cta, total_seconds: storyboard.total_seconds, scene_count: storyboard.scenes.length, provider: 'Pilot animation', estimated_credits: 0, music: musicNote, engine: 'animated', renderer: storyboard.renderer, ...(explained?.ok ? { voiceover: explained.voiceover ?? 'none' } : {}), ...(referenceCheck ? { reference_check: referenceCheck } : {}), ...(choice.use && choice.invent && !explained?.ok ? { code: coded?.ok && (codeStyle === 'invent' || codeStyle === 'custom') ? 'invented' as const : 'fell_back' as const, ...(inventNote ? { code_note: inventNote.slice(0, 200) } : {}) } : {}), ...(blueprint ? { reference: explained?.ok || (referenceCustom && coded?.ok && codeStyle === 'custom') ? 'followed' as const : 'fallback' as const, ...(explained && !explained.ok ? { reference_note: explained.reason.slice(0, 200) } : referenceCustom && inventNote ? { reference_note: inventNote.slice(0, 200) } : {}) } : {}), ...(generated && plan.summary.photosUsed.some((photo) => photo.id === generated.id) ? { generated_visual: generated.label, generated_kind: generatedKind } : {}), library_item_id: libraryItemId, error: null, finished_at: new Date().toISOString() };
    await finishJob(tenant.id, job.id, 'ready', result);
    console.info(JSON.stringify({ event: 'marketing-video.ready', engine: 'animated', tenantId: tenant.id, jobId: job.id, scenes: storyboard.scenes.length, seconds: storyboard.total_seconds, photos: plan.summary.photosUsed.length }));
    return 'ready';
  } catch (error) {
    console.error('animated video failed', error instanceof Error ? error.name : 'unknown');
    await finishJob(tenant.id, job.id, 'failed', { video_url: null, caption: storyboard?.caption ?? '', hashtags: storyboard?.hashtags ?? [], cta: storyboard?.cta ?? '', total_seconds: storyboard?.total_seconds ?? 0, scene_count: storyboard?.scenes.length ?? 0, provider: 'Pilot animation', estimated_credits: 0, music: null, engine: 'animated', library_item_id: null, error: `${failureMessage(error)} No credits were used.`, finished_at: new Date().toISOString() }).catch(() => undefined);
    return 'failed';
  } finally {
    workers.delete(job.id);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Loads the pictures a plan draws. A missing logo is simply left out; a missing photo is said plainly. */
async function loadPlanAssets(deps: GenerationDeps, tenantId: string, plan: VideoSpec, logoUrl: string | null): Promise<{ spec: VideoSpec; assets: Assets }> {
  const spec = structuredClone(plan);
  const { assets, missing } = await loadAssets({ ids: assetsNeeded(spec), tenantId, storage: deps.storage, logoUrl });
  if (missing.length) {
    if (missing.every((id) => id === spec.brand.logo)) delete spec.brand.logo;
    else throw new SceneFailure('One of your photos is no longer available. Ask for the video again.');
  }
  return { spec, assets };
}

// ---- changing a video that is already made -------------------------------------------------------------------------------------

/**
 * Makes a changed version of a finished video, redoing only what the change needs (see iteration.ts): a new caption, new music, or the
 * saved clips joined again with a new ending / a colour grade / one scene remade. Only remade scenes use Runway credits. The result is
 * a new job (iteration_of points at the earlier one); the Library draft is updated in place with the new version.
 */
async function runIteration({ tenant, job, earlier, plan, engine, deps }: { tenant: Tenant; job: MarketingJob; earlier: MarketingJob; plan: IterationPlan; engine: VideoEngine; deps: GenerationDeps }): Promise<'ready' | 'failed'> {
  let dir: string | null = null;
  const credits: { total: number | null } = { total: null };
  const progress: Progress = { phase: 'planning', scenes: [], total: 0, done: 0 };
  workers.set(job.id, progress);
  const storyboard: Storyboard = structuredClone(earlier.storyboard!);
  try {
    const platform: PlatformId = job.brief.platform === 'tiktok' ? 'tiktok' : 'instagram';
    const input = await deps.loadInput(tenant);
    const workDir = await deps.storage.makeTempDir(`gen-${job.id}`); dir = workDir;
    const previousId = videoIdOf(earlier.result!.video_url!);
    let finalPath: string | null = null; let musicNote = earlier.result!.music; let link = earlier.result!.video_url!;

    if (plan.recaption) {
      const words = await writeCaption({ brief: job.brief, input, platform, complete: deps.complete, scenes: storyboard.scenes.filter((s) => s.kind === 'clip').map((s) => s.description), instruction: job.userMessage, previous: { caption: storyboard.caption, hashtags: storyboard.hashtags } });
      storyboard.caption = words.caption; storyboard.hashtags = words.hashtags; storyboard.cta = words.cta || storyboard.cta;
    }

    if (plan.kind === 'music_only') {
      progress.phase = 'music';
      const bytes = previousId ? await readVideo(deps.storage, tenant.id, previousId) : null;
      if (!bytes) throw new SceneFailure('The earlier video is no longer available. Ask me to make it again.');
      const source = path.join(workDir, 'source.mp4'); await writeFile(source, bytes);
      storyboard.music_seed = job.id; // new music: a new take
      const profile = musicProfile(job.brief.style, job.brief.key_instructions, job.id);
      const out = path.join(workDir, 'remixed.mp4');
      if (profile) { await deps.addMusic({ videoPath: source, outPath: out, profile, wavPath: path.join(workDir, 'music.wav'), seed: job.id }); musicNote = `${profile.name}: ${profile.description}`; }
      else { await silenceVideo({ videoPath: source, outPath: out }); musicNote = null; }
      finalPath = out;
    } else if (plan.kind === 'recut' && engine === 'animated') {
      // a free animated video with a new ending: the saved scene plan is edited and drawn again (no outside service, no credits)
      progress.phase = 'making';
      if (!storyboard.animated_spec) throw new SceneFailure('I do not have the earlier animation saved. Ask me to make the video again.');
      const endScene = storyboard.scenes[storyboard.scenes.length - 1];
      const text = plan.endText ?? await reviseEndText({ previous: endScene.on_screen_text, instruction: job.userMessage, input, complete: deps.complete });
      const kit = await loadBrandKit(tenant.id);
      const { spec, assets } = await loadPlanAssets(deps, tenant.id, editEndText(storyboard.animated_spec, text), kit.logoUrl);
      const silent = path.join(workDir, 'animated.mp4');
      await deps.renderSpec({ spec, assets, outPath: silent });
      storyboard.animated_spec = spec; storyboard.scenes[storyboard.scenes.length - 1] = { ...endScene, on_screen_text: text };
      progress.phase = 'music';
      storyboard.music_seed = storyboard.music_seed ?? earlier.id; // the music is kept
      const scored = await withMusic(deps, workDir, silent, job, storyboard.music_seed);
      finalPath = scored.finalPath; musicNote = scored.musicNote;
    } else if (plan.kind === 'recut') {
      progress.scenes = storyboard.scenes.map((scene) => ({ role: scene.role, state: 'waiting' as SceneState })); progress.total = storyboard.scenes.length; progress.phase = 'making';
      const files: string[] = new Array(storyboard.scenes.length);
      const gradedIndexes: number[] = [];
      const work = storyboard.scenes.map((scene, index) => ({ scene, index }));
      // a clip that was not kept cannot be reused, so it is made again (the plan already checked, this is a safety net)
      const redo = new Set(plan.redoScenes);
      for (const { scene, index } of work.filter(({ scene }) => scene.kind === 'clip')) {
        gradedIndexes.push(index);
        if (redo.has(index)) continue;
        const bytes = scene.clip_video_id ? await readVideo(deps.storage, tenant.id, scene.clip_video_id) : null;
        if (bytes) { const file = path.join(workDir, `clip-${index}.mp4`); await writeFile(file, bytes); files[index] = file; progress.scenes[index].state = 'done'; progress.done += 1; } else redo.add(index);
      }
      const remade = work.filter(({ index }) => redo.has(index));
      const changesTheScene = /\b(?:different|change|new|instead|rather|show|add|remove|more|less|another|swap|replace)\b/i.test(job.userMessage) || !Object.keys(plan.sceneSeconds).length;
      await pool(remade, 2, async ({ scene, index }) => {
        progress.scenes[index].state = 'making';
        try {
          const seconds = plan.sceneSeconds[index] ?? scene.seconds;
          const description = changesTheScene ? await reviseScene({ scene, instruction: plan.sceneInstruction, brief: job.brief, complete: deps.complete }) : scene.description;
          const fresh = remakeScene(scene, { description, seconds, brief: job.brief });
          const url = await makeClip(deps, tenant.id, fresh, credits);
          const file = path.join(workDir, `clip-${index}.mp4`); await writeFile(file, await deps.fetchClip(url)); files[index] = file;
          fresh.clip_video_id = await keepClip(deps, tenant.id, file); storyboard.scenes[index] = fresh;
          progress.scenes[index].state = 'done'; progress.done += 1;
        } catch (error) { progress.scenes[index].state = 'failed'; throw error; }
      });
      for (const { scene, index } of work.filter(({ scene }) => scene.kind === 'end_card')) {
        progress.scenes[index].state = 'making';
        const text = plan.endText ?? (plan.redoEnding ? await reviseEndText({ previous: scene.on_screen_text, instruction: job.userMessage, input, complete: deps.complete }) : scene.on_screen_text);
        const file = path.join(workDir, `end-${index}.mp4`);
        await renderEndCard({ tenantId: tenant.id, text, seconds: scene.seconds, outPath: file, storage: deps.storage });
        storyboard.scenes[index] = { ...scene, on_screen_text: text }; files[index] = file; progress.scenes[index].state = 'done'; progress.done += 1;
      }
      if (plan.grade !== null) storyboard.grade = plan.grade;
      storyboard.total_seconds = storyboard.scenes.reduce((sum, scene) => sum + scene.seconds, 0);
      progress.phase = 'joining';
      const joined = path.join(workDir, 'final.mp4');
      await deps.stitch(files, joined, { grade: storyboard.grade ?? 0, gradedIndexes });
      progress.phase = 'music';
      storyboard.music_seed = storyboard.music_seed ?? earlier.id; // the music is kept: the same seed gives the same track
      const scored = await withMusic(deps, workDir, joined, job, storyboard.music_seed);
      finalPath = scored.finalPath; musicNote = scored.musicNote;
    }

    if (finalPath) { const videoId = randomUUID(); await deps.storage.saveVideo(tenant.id, videoId, finalPath); link = videoLink(videoId); }
    await saveJobStoryboard(tenant.id, job.id, storyboard);
    const libraryItemId = await updateLibraryItem(tenant.id, earlier.result!.library_item_id, job, storyboard, link, musicNote, engine).catch((error) => { console.error('library item could not be updated', error instanceof Error ? error.name : 'unknown'); return earlier.result!.library_item_id; });
    const result: JobResult = { video_url: link, caption: storyboard.caption, hashtags: storyboard.hashtags, cta: storyboard.cta, total_seconds: storyboard.total_seconds, scene_count: storyboard.scenes.length, provider: engine === 'animated' ? 'Pilot animation' : 'Runway', estimated_credits: credits.total ?? 0, music: musicNote, engine, library_item_id: libraryItemId, error: null, finished_at: new Date().toISOString() };
    await finishJob(tenant.id, job.id, 'ready', result);
    console.info(JSON.stringify({ event: 'marketing-video.iterated', engine, tenantId: tenant.id, jobId: job.id, iterationOf: earlier.id, kind: plan.kind, remadeScenes: plan.redoScenes.length, estimatedCredits: credits.total ?? 0 }));
    return 'ready';
  } catch (error) {
    console.error('marketing video change failed', error instanceof Error ? error.name : 'unknown');
    await finishJob(tenant.id, job.id, 'failed', { video_url: null, caption: storyboard.caption, hashtags: storyboard.hashtags, cta: storyboard.cta, total_seconds: storyboard.total_seconds, scene_count: storyboard.scenes.length, provider: 'Runway', estimated_credits: credits.total, music: null, engine, library_item_id: null, error: `${failureMessage(error)} ${engine === 'animated' ? 'No credits were used.' : creditsNote(credits.total)}`, finished_at: new Date().toISOString() }).catch(() => undefined);
    return 'failed';
  } finally {
    workers.delete(job.id);
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The video as a Library concept. A free animated video is a Standard Video (its saved scene plan can be opened and changed); Runway footage is an AI video. */
function conceptFor(engine: VideoEngine, storyboard: Storyboard, link: string, music: string | null): NonNullable<ContentItem['video']> {
  const audio = music ? `Includes original background music made for this video (${music}). You can replace it in the platform’s own app.` : 'Silent video. Add music or sound in the platform’s own app.';
  const scenes = storyboard.scenes.map((scene) => ({ seconds: scene.seconds, visual: scene.description, onScreenText: scene.on_screen_text }));
  return engine === 'animated'
    ? { mode: 'standard', plan: (storyboard.animated_spec ?? undefined) as unknown as Record<string, unknown> | undefined, durationSeconds: storyboard.total_seconds, scenes, transitions: 'Fades, slides and wipes', audioDirection: audio, render: { status: 'ready', url: link, provider: 'Standard Video' } }
    : { mode: 'ai', durationSeconds: storyboard.total_seconds, scenes, transitions: 'Hard cuts', audioDirection: audio, render: { status: 'ready', url: link, provider: 'Runway' } };
}

const visualNote = (job: MarketingJob, engine: VideoEngine) => {
  const photos = job.selection?.has_good_match ? job.selection.selected_assets.map((asset) => asset.label) : [];
  if (photos.length) return `${engine === 'animated' ? 'Uses' : 'Starts from'} your photo${photos.length > 1 ? 's' : ''}: ${photos.join(', ')}.`;
  return engine === 'animated' ? 'Brand colours, text and motion. No photos of your business were made up.' : 'Generated from text alone. No photos of your business were made up.';
};

/** A draft in the Marketing Library, so the finished video is easy to find again. Nothing is approved, scheduled or posted. */
async function addToLibrary(tenantId: string, job: MarketingJob, storyboard: Storyboard, link: string, music: string | null, engine: VideoEngine = 'runway'): Promise<string> {
  const platform: PlatformId = job.brief.platform === 'tiktok' ? 'tiktok' : 'instagram';
  const item: Omit<ContentItem, 'id' | 'createdAt' | 'updatedAt'> = {
    kind: 'video', platform, status: 'draft', hook: (storyboard.caption.split(/\n/)[0] || job.brief.main_subject).slice(0, 140), caption: storyboard.caption, cta: storyboard.cta, hashtags: storyboard.hashtags,
    suggestedVisual: visualNote(job, engine),
    postingFormat: `${engine === 'animated' ? 'Animated video' : 'AI video'}, 9:16, ${storyboard.total_seconds} seconds`, topic: job.brief.main_subject.slice(0, 200), goal: '', tone: '', why: 'Made from your request.',
    evidence: [{ label: 'Your request', source: 'business', detail: job.userMessage.slice(0, 300) }], scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null, image: null,
    video: conceptFor(engine, storyboard, link, music),
  };
  return (await createContent(tenantId, item)).id;
}

/** Puts the new version in the same Library draft (back to Draft for review), or makes a new draft if that one is gone. */
async function updateLibraryItem(tenantId: string, itemId: string | null, job: MarketingJob, storyboard: Storyboard, link: string, music: string | null, engine: VideoEngine): Promise<string> {
  const existing = itemId ? await getContent(tenantId, itemId) : null;
  if (!existing) return addToLibrary(tenantId, job, storyboard, link, music, engine);
  await saveContent(tenantId, {
    ...existing, status: 'draft', approvedAt: null, publishedAt: null, scheduledFor: null, scheduledTime: null, caption: storyboard.caption, cta: storyboard.cta, hashtags: storyboard.hashtags,
    hook: (storyboard.caption.split(/\n/)[0] || existing.hook).slice(0, 140), postingFormat: `${engine === 'animated' ? 'Animated video' : 'AI video'}, 9:16, ${storyboard.total_seconds} seconds`, updatedAt: new Date().toISOString(),
    suggestedVisual: visualNote(job, engine), video: conceptFor(engine, storyboard, link, music),
  });
  return existing.id;
}

/**
 * Starts the video for a confirmed job that has its asset selection: the job becomes "generating" and the video is made in the
 * background. Returns false (and changes nothing) when it cannot start.
 */
export async function startVideoGeneration({ tenant, job, deps }: { tenant: Tenant; job: MarketingJob; deps?: GenerationDeps }): Promise<{ started: boolean; promise?: Promise<'ready' | 'failed'> }> {
  if (!job.selection || (job.status !== 'confirmed' && job.status !== 'failed') || isGenerating(job.id)) return { started: false };
  await markJobGenerating(tenant.id, job.id);
  const promise = runGeneration({ tenant, job: { ...job, status: 'generating' }, deps });
  return { started: true, promise };
}
