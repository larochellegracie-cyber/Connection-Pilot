import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FPS = 4; const W = 54; const H = 96;

/**
 * Checks the FINISHED video, not the script: it reads the encoded file back at a small size and looks for what a viewer would notice at once.
 *  HARD (the video is not usable): it cannot be read, a stretch of blank (near-black or near-white and flat) frames, or the wrong length.
 *  SOFT (usable but weak, worth one revision): a stretch of two seconds or more where almost nothing changes (a still picture), or little movement overall.
 * Each problem names the seconds it covers so the code writer can find the scene. Plain arithmetic on a few hundred tiny frames; no model, no cost.
 */
export type RenderQuality = { ok: boolean; hard: string[]; soft: string[]; seconds: number; motion: number };

export async function checkRenderedVideo({ file, ffmpeg, expectedSeconds, tolerance = 0.25 }: { file: string; ffmpeg: string; expectedSeconds?: number; /** how far from the expected length is still fine, as a fraction (scenes joined by live transitions overlap, so a custom video runs a little short) */ tolerance?: number }): Promise<RenderQuality> {
  let raw: Buffer;
  try { raw = (await run(ffmpeg, ['-v', 'error', '-i', file, '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 120_000 })).stdout; } catch { return { ok: false, hard: ['The finished video could not be read back.'], soft: [], seconds: 0, motion: 0 }; }
  const size = W * H; const count = Math.floor(raw.length / size);
  if (count < 2) return { ok: false, hard: ['The finished video has no frames.'], soft: [], seconds: 0, motion: 0 };
  const seconds = count / FPS;
  const mean: number[] = []; const spread: number[] = []; const diff: number[] = [];
  for (let f = 0; f < count; f += 1) {
    let sum = 0; let sq = 0; let d = 0;
    for (let i = 0; i < size; i += 1) { const v = raw[f * size + i]; sum += v; sq += v * v; if (f) d += Math.abs(v - raw[(f - 1) * size + i]); }
    const m = sum / size; mean.push(m); spread.push(Math.sqrt(Math.max(0, sq / size - m * m))); diff.push(f ? d / size : 0);
  }
  const at = (frame: number) => (frame / FPS).toFixed(1);
  const runs = (test: (f: number) => boolean, minFrames: number) => { const found: Array<[number, number]> = []; let start = -1; for (let f = 1; f <= count; f += 1) { const hit = f < count && test(f); if (hit && start < 0) start = f; if (!hit && start >= 0) { if (f - start >= minFrames) found.push([start, f]); start = -1; } } return found; };
  const hard: string[] = []; const soft: string[] = [];
  if (expectedSeconds && Math.abs(seconds - expectedSeconds) > expectedSeconds * tolerance) hard.push(`The finished video is ${seconds.toFixed(1)} seconds long instead of about ${expectedSeconds}.`);
  for (const [a, b] of runs((f) => spread[f] < 3 && (mean[f] < 8 || mean[f] > 248), FPS)) hard.push(`From ${at(a)}s to ${at(b)}s the video is a blank ${mean[a] < 128 ? 'black' : 'white'} frame. Something in that scene is not being drawn (a photo or layer is missing, or everything fades out).`);
  // a still stretch: little change between frames. The last 2.5 seconds may hold on the sign-off.
  for (const [a, b] of runs((f) => diff[f] < 0.3, FPS * 2)) if (!(b >= count && (b - a) / FPS <= 2.5)) soft.push(`From ${at(a)}s to ${at(b)}s the picture is almost still: nothing moves. Keep the camera, light or graphics moving in that scene.`);
  const motion = diff.reduce((s, v) => s + v, 0) / Math.max(1, count - 1);
  if (motion < 0.6) soft.push(`The video barely moves overall (motion ${motion.toFixed(2)}): add continuous camera moves, moving light and animated graphics.`);
  return { ok: !hard.length && !soft.length, hard, soft, seconds, motion };
}
