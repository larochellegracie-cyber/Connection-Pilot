import type { ContentItem, VideoConcept, VideoMode } from '@/lib/marketing-content.js';
import { runwayProvider } from './runway.js';
import { standardProvider } from './standard-video/provider.js';

/**
 * Where actual video files would come from. No video-generation service is connected to this project, so none is
 * listed here, and Pilot never says a video exists unless a provider returned a real file. To add one, implement
 * VideoProvider, list it below, and give it its own key in the app settings.
 */
export type VideoTaskState = { status: 'processing' | 'succeeded' | 'failed'; url?: string; message?: string; progress?: number };
type VideoSubject = Pick<ContentItem, 'platform' | 'caption' | 'topic' | 'hook' | 'cta'>;
/** Who the video is for. Providers that keep files use it so one business can never reach another's. */
export type VideoContext = { tenantId: string; contentId?: string };

export type VideoProvider = {
  id: string;
  label: string;
  /** standard = low-cost rendering on our own servers; ai = a paid generative-video service. A provider with no mode is treated as ai, so it is never used by accident. */
  mode?: VideoMode;
  isConfigured: () => boolean;
  /** For providers that return the finished file in one call. */
  render?: (concept: VideoConcept, item: VideoSubject) => Promise<{ url: string }>;
  /** For providers that work in the background: start returns a task id, retrieve reports on it. */
  start?: (concept: VideoConcept, item: VideoSubject, context: VideoContext) => Promise<{ taskId: string; estimatedCredits: number | null; note?: string }>;
  retrieve?: (taskId: string, context: VideoContext) => Promise<VideoTaskState>;
  /** Turns a provider failure into a plain sentence that contains no keys or raw responses. */
  describeError?: (error: unknown) => string;
};

export const providerMode = (provider: VideoProvider): VideoMode => provider.mode ?? 'ai';

export const videoProviders: VideoProvider[] = [standardProvider, runwayProvider];

export type ProviderStatus = { configured: boolean; provider: string | null; message: string };

export function videoGenerationStatus(providers: VideoProvider[] = videoProviders, mode: VideoMode = 'standard'): ProviderStatus {
  const ready = providers.find((provider) => providerMode(provider) === mode && provider.isConfigured());
  if (ready) return { configured: true, provider: ready.label, message: `${mode === 'standard' ? 'Standard videos' : 'AI videos'} are made with ${ready.label}.` };
  if (mode === 'ai') return { configured: false, provider: null, message: 'AI video needs a video provider connection (Runway), and it is not connected.' };
  return { configured: false, provider: null, message: 'Making the actual video file needs a video provider connection, and none is connected yet. Until then Pilot writes the full video plan (hook, scenes, on-screen text, audio direction and caption) for you to film or hand to an editor.' };
}

export const imageGenerationStatus: ProviderStatus = { configured: true, provider: 'Pilot', message: 'Each post gets your own photo when one suits it. Otherwise Pilot draws a branded graphic from your colours, logo and the post’s words. It never makes realistic pictures of places, vehicles, people or work you have not shown it.' };

export type RenderOutcome = { ok: true; url: string; provider: string } | { ok: false; providerRequired: boolean; message: string };

/** Asks the connected provider for the video. Success requires a real https file; anything else is reported as not made. */
export async function renderVideo(item: ContentItem, providers: VideoProvider[] = videoProviders): Promise<RenderOutcome> {
  if (item.kind !== 'video' || !item.video) return { ok: false, providerRequired: false, message: 'Only a video concept can be turned into a video.' };
  const provider = providers.find((candidate) => candidate.isConfigured() && candidate.render);
  if (!provider) return { ok: false, providerRequired: true, message: videoGenerationStatus(providers).message };
  if (!provider.render) return { ok: false, providerRequired: false, message: `${provider.label} makes videos in the background. Start the video first, then check on it.` };
  try {
    const { url } = await provider.render(item.video, item);
    if (!/^https:\/\/\S+$/.test(url)) return { ok: false, providerRequired: false, message: `${provider.label} did not return a video file, so no video was made.` };
    return { ok: true, url, provider: provider.label };
  } catch (error) {
    return { ok: false, providerRequired: false, message: `The video was NOT made. ${provider.label} said: ${error instanceof Error ? error.message.slice(0, 200) : 'it could not finish.'}` };
  }
}


export type StartOutcome = { ok: true; taskId: string; provider: string; estimatedCredits: number | null; note: string } | { ok: false; providerRequired: boolean; message: string };
export type CheckOutcome = { ok: true; state: VideoTaskState; provider: string } | { ok: false; message: string };

/**
 * Starts a video. The mode decides which kind of provider is used: "standard" (the default) never touches a paid
 * generative-video service, and "ai" is only used when it is asked for by name. A missing provider is reported, never
 * swapped for the other mode.
 */
export async function startVideo(item: ContentItem, context: VideoContext, providers: VideoProvider[] = videoProviders, mode: VideoMode = 'standard'): Promise<StartOutcome> {
  if (item.kind !== 'video' || !item.video) return { ok: false, providerRequired: false, message: 'Only a video concept can be turned into a video.' };
  const provider = providers.find((candidate) => providerMode(candidate) === mode && candidate.isConfigured() && candidate.start);
  if (!provider) return { ok: false, providerRequired: true, message: videoGenerationStatus(providers, mode).message };
  try {
    const started = await provider.start!({ ...item.video, mode }, item, context);
    return { ok: true, taskId: started.taskId, provider: provider.label, estimatedCredits: started.estimatedCredits, note: started.note ?? '' };
  } catch (error) {
    return { ok: false, providerRequired: false, message: `The video was NOT started. ${provider.describeError?.(error) ?? `${provider.label} could not start it.`}` };
  }
}

/** Asks the provider that started a video how it is going. */
export async function checkVideo(taskId: string, providerLabel: string, context: VideoContext, providers: VideoProvider[] = videoProviders): Promise<CheckOutcome> {
  const provider = providers.find((candidate) => candidate.label === providerLabel && candidate.retrieve);
  if (!provider) return { ok: false, message: `${providerLabel} is not connected, so its video cannot be checked.` };
  if (!provider.isConfigured()) return { ok: false, message: `${provider.label} is not connected, so its video cannot be checked.` };
  try { return { ok: true, state: await provider.retrieve!(taskId, context), provider: provider.label }; }
  catch (error) { return { ok: false, message: `Could not check the video. ${provider.describeError?.(error) ?? `${provider.label} did not answer.`}` }; }
}
