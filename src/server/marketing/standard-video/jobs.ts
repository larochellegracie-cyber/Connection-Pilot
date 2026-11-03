import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Assets } from './draw.js';
import { renderVideoSpec } from './render.js';
import type { VideoSpec } from './spec.js';
import { getMediaStorage, type MediaStorage } from './storage.js';

/**
 * Renders run in the background on this server, one or two at a time, so many videos can be made without a per-video
 * fee and without overloading a small server. A job's working files are always removed when it ends, successful or not.
 */
export class StandardVideoError extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage); this.name = 'StandardVideoError'; }
}

export type TaskState = { status: 'processing' | 'succeeded' | 'failed'; message?: string; progress?: number; url?: string };
type Job = { id: string; tenantId: string; status: 'queued' | 'rendering' | 'done' | 'failed'; progress: number; error?: string; startedAt: number; finishedAt?: number };

const jobs = new Map<string, Job>();
const waiting: Array<() => void> = [];
let running = 0;

const limit = () => Math.max(1, Number(process.env.STANDARD_VIDEO_CONCURRENCY) || 1);
const perBusinessCap = () => Math.max(50, Number(process.env.MARKETING_MEDIA_MAX_MB_PER_BUSINESS) || 500) * 1024 * 1024;
const TEMP_MAX_AGE_MS = 60 * 60 * 1000;
export const videoLink = (id: string) => `/api/marketing/media/videos/${id}.mp4`;

let sweeper: ReturnType<typeof setInterval> | null = null;
function ensureSweeper(storage: MediaStorage) {
  if (sweeper) return;
  sweeper = setInterval(() => { void storage.sweepTemp(TEMP_MAX_AGE_MS).catch(() => undefined); }, 30 * 60 * 1000);
  sweeper.unref?.();
}

async function slot(): Promise<() => void> {
  if (running >= limit()) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  return () => { running -= 1; waiting.shift()?.(); };
}

function prune() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
}

/** Queues a render and returns its id straight away. The finished file is stored for this business only. */
export async function startStandardRender({ tenantId, spec, assets, storage = getMediaStorage() }: { tenantId: string; spec: VideoSpec; assets: Assets; storage?: MediaStorage }): Promise<{ taskId: string }> {
  if ((await storage.usage(tenantId)) > perBusinessCap()) throw new StandardVideoError('This business has used up its video storage. Delete some finished videos and try again.');
  ensureSweeper(storage);
  void storage.sweepTemp(TEMP_MAX_AGE_MS).catch(() => undefined); // working files left by a crashed render never pile up
  prune();
  const id = randomUUID();
  const job: Job = { id, tenantId, status: 'queued', progress: 0, startedAt: Date.now() };
  jobs.set(id, job);
  void (async () => {
    const release = await slot();
    let temp: string | null = null;
    try {
      job.status = 'rendering';
      temp = await storage.makeTempDir(id);
      const out = path.join(temp, 'video.mp4');
      await renderVideoSpec({ spec, assets, outPath: out, onProgress: (fraction) => { job.progress = fraction; } });
      await storage.saveVideo(tenantId, id, out);
      job.status = 'done'; job.progress = 1;
    } catch (error) {
      job.status = 'failed'; job.error = error instanceof Error ? error.message.slice(0, 300) : 'The video could not be made.';
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true }).catch(() => undefined);
      job.finishedAt = Date.now();
      release();
    }
  })();
  return { taskId: id };
}

/** Where a video is. It only answers for the business that asked for it. */
export async function getStandardTask({ tenantId, taskId, storage = getMediaStorage() }: { tenantId: string; taskId: string; storage?: MediaStorage }): Promise<TaskState> {
  const job = jobs.get(taskId);
  if (job && job.tenantId === tenantId) {
    if (job.status === 'queued') return { status: 'processing', message: 'Waiting for its turn to be made.', progress: 0 };
    if (job.status === 'rendering') return { status: 'processing', message: 'Making the video.', progress: job.progress };
    if (job.status === 'failed') return { status: 'failed', message: `The video could not be made. ${job.error ?? ''}`.trim() };
    return { status: 'succeeded', url: videoLink(taskId) };
  }
  // After a restart the job is forgotten, but a finished file is still there.
  if (await storage.hasVideo(tenantId, taskId)) return { status: 'succeeded', url: videoLink(taskId) };
  return { status: 'failed', message: 'This video was not finished (the server restarted while it was being made). Start it again.' };
}

export function resetJobsForTests() { jobs.clear(); waiting.length = 0; running = 0; if (sweeper) { clearInterval(sweeper); sweeper = null; } }
