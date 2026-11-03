import { spawn } from 'node:child_process';
import { ffmpegPath } from './standard-video/ffmpeg.js';
import { assertPublic } from './standard-video/assets.js';

/**
 * Joins the finished clips into one video: every clip is brought to the same 720x1280 vertical frame (letterboxed, never stretched),
 * 30 frames a second, and they are played one after another. A silent audio track is added because some platforms reject a video with
 * none. No music or sound is added here.
 */
export const FRAME = { width: 720, height: 1280, fps: 30 } as const;
const MAX_CLIP_BYTES = 150 * 1024 * 1024;

/** Downloads one finished clip. Only secure public https addresses are fetched, with a size and time limit. */
export async function downloadClip(link: string, { timeoutMs = 120_000 }: { timeoutMs?: number } = {}): Promise<Buffer> {
  const url = new URL(link);
  await assertPublic(url);
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`A clip could not be downloaded (${response.status}).`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_CLIP_BYTES) throw new Error('A clip was larger than expected.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_CLIP_BYTES) throw new Error('A clip was larger than expected.');
  return bytes;
}

/** A colour grade for the generated clips: below 0 is darker (and a little more contrast), above 0 is brighter. */
export const gradeFilter = (grade: number) => (Math.abs(grade) < 0.005 ? '' : `eq=brightness=${grade.toFixed(2)}:contrast=${(1 + Math.abs(grade) * 0.4).toFixed(2)}:saturation=${(grade < 0 ? 0.93 : 1.05).toFixed(2)},`);

export type StitchOptions = { timeoutMs?: number; /** the grade to apply to the generated clips */ grade?: number; /** which of the inputs are generated clips (the end card is never graded) */ gradedIndexes?: number[] };

export function stitchArgs(clipPaths: string[], outPath: string, { grade = 0, gradedIndexes }: Pick<StitchOptions, 'grade' | 'gradedIndexes'> = {}): string[] {
  const n = clipPaths.length;
  const { width, height, fps } = FRAME;
  const normalise = clipPaths.map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,${!gradedIndexes || gradedIndexes.includes(i) ? gradeFilter(grade) : ''}fps=${fps},format=yuv420p[v${i}]`).join(';');
  const join = `${clipPaths.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[v]`;
  return ['-hide_banner', '-loglevel', 'error', '-y', ...clipPaths.flatMap((path) => ['-i', path]), '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-filter_complex', `${normalise};${join}`, '-map', '[v]', '-map', `${n}:a`, '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '64k', outPath];
}

export async function stitchClips(clipPaths: string[], outPath: string, { timeoutMs = 5 * 60_000, grade = 0, gradedIndexes }: StitchOptions = {}): Promise<void> {
  if (!clipPaths.length) throw new Error('There are no clips to join.');
  const binary = ffmpegPath();
  if (!binary) throw new Error('FFmpeg is not available on this server.');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, stitchArgs(clipPaths, outPath, { grade, gradedIndexes }), { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-600); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Joining the clips took too long and was stopped.')); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`FFmpeg could not start: ${error.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg stopped with code ${code}. ${errors.trim()}`.trim())); });
  });
}
