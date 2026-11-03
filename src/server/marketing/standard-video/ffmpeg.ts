import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as nodeModule from 'node:module';
import path from 'node:path';

/** Finds the FFmpeg program: FFMPEG_PATH if the app settings give one, otherwise the one installed with the app. */
export function ffmpegPath(): string | null {
  const override = process.env.FFMPEG_PATH?.trim();
  if (override) return override;
  try { return nodeModule.createRequire(path.join(process.cwd(), 'package.json'))('@ffmpeg-installer/ffmpeg').path as string; } catch { return null; }
}
export const ffmpegAvailable = () => ffmpegPath() !== null;

export type Encoder = { stdin: ChildProcessWithoutNullStreams['stdin']; done: Promise<void>; kill: () => void };

/**
 * Starts FFmpeg reading raw frames from its input and writing an H.264 MP4 that plays on Instagram, TikTok, Facebook
 * and LinkedIn. Frames are piped in, so no frame files are ever written to disk. A silent audio track is added because
 * some platforms reject video with no audio stream.
 */
export function startEncoder({ width, height, fps, outPath }: { width: number; height: number; fps: number; outPath: string }): Encoder {
  const binary = ffmpegPath();
  if (!binary) throw new Error('FFmpeg is not available on this server.');
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-map', '0:v', '-map', '1:a', '-shortest',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '64k', '-r', String(fps), outPath];
  const child = spawn(binary, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-800); });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => reject(new Error(`FFmpeg could not start: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg stopped with code ${code}. ${errors.trim()}`.trim()))));
  });
  child.stdin.on('error', () => { /* the exit code above reports the real problem */ });
  return { stdin: child.stdin, done, kill: () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } } };
}
