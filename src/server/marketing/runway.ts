import RunwayML, { APIConnectionError, APIError, AuthenticationError, BadRequestError, PermissionDeniedError, RateLimitError, TaskFailedError, TaskTimedOutError } from '@runwayml/sdk';
import { getSecret } from '#airo/secrets';
import type { ContentItem, PlatformId, VideoConcept } from '@/lib/marketing-content.js';
import type { VideoProvider, VideoTaskState } from './providers.js';

/**
 * Runway, through the official @runwayml/sdk. The API key is RUNWAYML_API_SECRET in the app's settings: it is read here,
 * handed to the SDK, and never logged, returned or put into an error message.
 *
 * Making a video takes a minute or more, so this is two steps: start (returns a task id straight away) and retrieve
 * (reports progress, and the finished video's link when it exists).
 */
export const RUNWAY_MODEL = 'gen4.5' as const;
const MAX_SECONDS = 10; // gen4.5 makes clips of 2 to 10 seconds
const MIN_SECONDS = 2;
const PROMPT_LIMIT = 1000;

export function runwaySecret(): string | null {
  const value = getSecret('RUNWAYML_API_SECRET');
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export const isRunwayConfigured = () => runwaySecret() !== null;

/** The subset of the SDK this file uses, so tests can stand in for it without touching the network. */
export type RunwayClientLike = {
  textToVideo: { create: (body: { model: typeof RUNWAY_MODEL; promptText: string; ratio: '1280:720' | '720:1280'; duration: number }) => Promise<{ id: string; estimatedCost?: { credits: number } }> };
  /** Starts a clip from a still image (the owner's own photo) as its first frame. */
  imageToVideo?: { create: (body: { model: typeof RUNWAY_MODEL; promptImage: string; promptText: string; ratio: '720:1280' | '1280:720'; duration: number }) => Promise<{ id: string; estimatedCost?: { credits: number } }> };
  tasks: { retrieve: (id: string) => Promise<{ id: string; status: string; output?: string[]; failure?: string; failureCode?: string; progress?: number }> };
};

export function createRunwayClient(): RunwayClientLike {
  const apiKey = runwaySecret();
  if (!apiKey) throw new RunwayNotConfiguredError();
  return new RunwayML({ apiKey, maxRetries: 1, timeout: 30_000 }) as unknown as RunwayClientLike;
}

export class RunwayNotConfiguredError extends Error {
  constructor() { super('Runway is not connected. RUNWAYML_API_SECRET is not set in this app’s settings.'); this.name = 'RunwayNotConfiguredError'; }
}

/** Plain-language reasons for what Runway can say, with no keys, headers or raw responses in them. */
export function runwayProblem(error: unknown): string {
  if (error instanceof RunwayNotConfiguredError) return error.message;
  if (error instanceof AuthenticationError) return 'Runway did not accept the API key, so nothing was started. Check RUNWAYML_API_SECRET in the app settings.';
  if (error instanceof PermissionDeniedError) return 'Runway says this account is not allowed to make that video (for example, not enough credits or access).';
  if (error instanceof RateLimitError) return 'Runway is busy or the account has reached its limit. Try again in a few minutes.';
  if (error instanceof BadRequestError) return `Runway could not accept that video request${apiDetail(error) ? `: ${apiDetail(error)}` : '.'}`;
  if (error instanceof TaskFailedError) return `Runway could not make the video${error.taskDetails && 'failure' in error.taskDetails && typeof error.taskDetails.failure === 'string' ? `: ${error.taskDetails.failure.slice(0, 200)}` : '.'}`;
  if (error instanceof TaskTimedOutError) return 'Runway is still working on the video. Check again in a minute.';
  if (error instanceof APIConnectionError) return 'Pilot could not reach Runway. Check the connection and try again.';
  if (error instanceof APIError) return `Runway returned an error (${error.status ?? 'unknown'}). Nothing was made.`;
  return 'Something went wrong talking to Runway, and no video was made.';
}
function apiDetail(error: APIError): string {
  const body = error.error as { error?: unknown; message?: unknown } | undefined;
  const text = typeof body?.error === 'string' ? body.error : typeof body?.message === 'string' ? body.message : '';
  return text.replace(/\s+/g, ' ').slice(0, 200);
}

const ratioFor = (platform: PlatformId): '1280:720' | '720:1280' => (platform === 'linkedin' ? '1280:720' : '720:1280');

/**
 * Turns the video plan's scenes into one prompt. Only the visuals are sent: on-screen text, logos and phone numbers are
 * left to the editor, because generated video cannot be trusted to spell them. The clip is generated footage, not the
 * business's real work.
 */
export function buildRunwayPrompt(concept: Pick<VideoConcept, 'scenes' | 'transitions'>, item: Pick<ContentItem, 'topic' | 'platform'>): string {
  const shots = concept.scenes.map((scene, index) => `${index + 1}. ${scene.visual.replace(/\s+/g, ' ').trim()}`).filter((line) => line.length > 3);
  const intro = `Short ${ratioFor(item.platform) === '720:1280' ? 'vertical' : 'landscape'} video for a local service business${item.topic ? `, about: ${item.topic}` : ''}. Realistic, natural light, clean and friendly. Shots in order: `;
  const outro = ` ${concept.transitions ? `Transitions: ${concept.transitions.replace(/\s+/g, ' ').trim()}. ` : ''}No on-screen text, captions, logos or phone numbers.`;
  let prompt = intro;
  for (const shot of shots) { if ((prompt + shot + outro).length + 1 > PROMPT_LIMIT) break; prompt += `${shot} `; }
  prompt = `${prompt.trim()}${outro}`;
  return prompt.length > PROMPT_LIMIT ? `${prompt.slice(0, PROMPT_LIMIT - 1).trim()}` : prompt;
}

export function runwayRequestFor(concept: VideoConcept, item: Pick<ContentItem, 'topic' | 'platform'>) {
  const duration = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(concept.durationSeconds || MAX_SECONDS)));
  return { model: RUNWAY_MODEL, promptText: buildRunwayPrompt(concept, item), ratio: ratioFor(item.platform), duration };
}

export async function startRunwayVideo(concept: VideoConcept, item: Pick<ContentItem, 'topic' | 'platform'>, client: RunwayClientLike = createRunwayClient()): Promise<{ taskId: string; estimatedCredits: number | null; note: string }> {
  if (!concept.scenes.some((scene) => scene.visual.trim())) throw new Error('The video plan has no scenes to film.');
  const request = runwayRequestFor(concept, item);
  const task = await client.textToVideo.create(request);
  if (!task?.id) throw new Error('Runway did not return a task id.');
  const clipped = concept.durationSeconds > request.duration ? ` Runway makes clips of up to ${MAX_SECONDS} seconds, so this clip is ${request.duration} seconds, shorter than the ${concept.durationSeconds}-second plan.` : '';
  return { taskId: task.id, estimatedCredits: task.estimatedCost?.credits ?? null, note: `This is AI-generated footage, not your real work.${clipped}` };
}

/** Where a started video is now. Success needs a real https link; anything else is reported as it is. */
export async function getRunwayVideo(taskId: string, client: RunwayClientLike = createRunwayClient()): Promise<VideoTaskState> {
  const task = await client.tasks.retrieve(taskId);
  switch (task.status) {
    case 'SUCCEEDED': {
      const url = task.output?.find((link) => typeof link === 'string' && /^https:\/\/\S+$/.test(link));
      return url ? { status: 'succeeded', url } : { status: 'failed', message: 'Runway said the video was done but did not give a link to it, so no video is available.' };
    }
    case 'FAILED': return { status: 'failed', message: `Runway could not make the video${task.failure ? `: ${String(task.failure).slice(0, 200)}` : '.'}` };
    case 'CANCELLED': return { status: 'failed', message: 'The video was cancelled at Runway, so none was made.' };
    case 'PENDING': case 'THROTTLED': case 'RUNNING': return { status: 'processing', message: task.status === 'RUNNING' ? 'Runway is making the video.' : 'Waiting in Runway’s queue.', ...(typeof task.progress === 'number' && { progress: Math.max(0, Math.min(1, task.progress)) }) };
    default: return { status: 'processing', message: 'Runway is working on the video.' };
  }
}

/** One short vertical clip: from text alone, or starting from the owner's own photo (a base64 data URI of at most 5 MB). */
export type ClipRequest = { prompt: string; seconds: number; imageDataUri?: string };

export async function startRunwayClip(request: ClipRequest, client: RunwayClientLike = createRunwayClient()): Promise<{ taskId: string; estimatedCredits: number | null }> {
  const duration = Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, Math.round(request.seconds)));
  const promptText = request.prompt.slice(0, PROMPT_LIMIT);
  if (!promptText.trim()) throw new Error('The scene has nothing to make.');
  let task;
  if (request.imageDataUri) {
    if (!client.imageToVideo) throw new Error('This Runway connection cannot start a clip from a photo.');
    task = await client.imageToVideo.create({ model: RUNWAY_MODEL, promptImage: request.imageDataUri, promptText, ratio: '720:1280', duration });
  } else {
    task = await client.textToVideo.create({ model: RUNWAY_MODEL, promptText, ratio: '720:1280', duration });
  }
  if (!task?.id) throw new Error('Runway did not return a task id.');
  return { taskId: task.id, estimatedCredits: task.estimatedCost?.credits ?? null };
}

export const runwayProvider: VideoProvider = {
  id: 'runway',
  label: 'Runway',
  isConfigured: isRunwayConfigured,
  start: (concept, item) => startRunwayVideo(concept, item),
  retrieve: (taskId) => getRunwayVideo(taskId),
  describeError: runwayProblem,
};
