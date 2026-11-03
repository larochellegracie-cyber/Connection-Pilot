import { once } from 'node:events';
import { drawFrame, type Assets } from './draw.js';
import { startEncoder } from './ffmpeg.js';
import { ensureFonts } from './fonts.js';
import { sizes, totalSeconds, type VideoSpec } from './spec.js';

export type RenderResult = { frames: number; seconds: number; width: number; height: number };

/**
 * Draws every frame with the canvas library and pipes it straight into FFmpeg, which writes the MP4 to `outPath`.
 * No frame files are created. Stops (and kills FFmpeg) if the signal aborts or the time limit passes.
 */
export async function renderVideoSpec({ spec, assets, outPath, signal, timeoutMs = 4 * 60_000, onProgress }: { spec: VideoSpec; assets: Assets; outPath: string; signal?: AbortSignal; timeoutMs?: number; onProgress?: (fraction: number) => void }): Promise<RenderResult> {
  await ensureFonts();
  const { createCanvas } = await import('@napi-rs/canvas');
  const { width, height } = sizes[spec.size];
  const seconds = totalSeconds(spec);
  const frames = Math.max(1, Math.round(seconds * spec.fps));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const encoder = startEncoder({ width, height, fps: spec.fps, outPath });
  const deadline = Date.now() + timeoutMs;
  encoder.done.catch(() => undefined); // the failure is reported below
  try {
    for (let frame = 0; frame < frames; frame += 1) {
      if (signal?.aborted) throw new Error('The video was cancelled.');
      if (Date.now() > deadline) throw new Error('The video took too long to make and was stopped.');
      drawFrame(ctx, spec, assets, frame / spec.fps);
      const raw = canvas.data();
      if (!encoder.stdin.write(raw)) await once(encoder.stdin, 'drain');
      if (frame % 15 === 0) onProgress?.(frame / frames);
    }
    encoder.stdin.end();
    await encoder.done;
  } catch (error) {
    encoder.kill();
    throw error;
  }
  onProgress?.(1);
  return { frames, seconds, width, height };
}
