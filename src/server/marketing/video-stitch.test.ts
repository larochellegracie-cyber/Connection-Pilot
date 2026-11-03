import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ffmpegPath } from './standard-video/ffmpeg';
import { stitchArgs, stitchClips, downloadClip } from './video-stitch';

let dir: string;
const run = (args: string[]) => new Promise<string>((resolve, reject) => { const child = spawn(ffmpegPath()!, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; child.stderr.on('data', (c) => { err += c.toString(); }); child.on('close', (code) => (code === 0 || /At least one output file must be specified/.test(err) ? resolve(err) : reject(new Error(err)))); });
const makeClip = async (name: string, seconds: number, size: string) => { const file = path.join(dir, name); await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=${seconds}:size=${size}:rate=24`, '-pix_fmt', 'yuv420p', file]); return file; };
const probe = (file: string) => run(['-hide_banner', '-i', file]);
beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'stitch-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('joining the clips', () => {
  it('joins clips of different sizes into one 720x1280 video, one after another, with a silent audio track', async () => {
    const clips = [await makeClip('a.mp4', 2, '720x1280'), await makeClip('b.mp4', 2, '1280x720'), await makeClip('c.mp4', 1, '480x480')];
    const out = path.join(dir, 'out.mp4');
    await stitchClips(clips, out);
    const info = await probe(out);
    expect(info).toMatch(/Video: h264.*720x1280/); expect(info).toMatch(/Audio: aac/); expect(info).toMatch(/30 fps/);
    const [, h, m, s] = info.match(/Duration: (\d+):(\d+):([\d.]+)/)!.map(Number); const seconds = h * 3600 + m * 60 + s;
    expect(seconds).toBeGreaterThan(4.6); expect(seconds).toBeLessThan(5.6); // 2 + 2 + 1
    expect((await readFile(out)).subarray(4, 8).toString()).toBe('ftyp');
  }, 120_000);
  it('builds a plain command: every clip normalised, then joined, with only silent audio', () => {
    const args = stitchArgs(['/a.mp4', '/b.mp4'], '/out.mp4').join(' ');
    expect(args).toContain('concat=n=2:v=1:a=0[v]'); expect(args).toContain('scale=720:1280:force_original_aspect_ratio=decrease'); expect(args).toContain('anullsrc'); expect(args).toContain('-map [v] -map 2:a');
  });
  it('refuses to join nothing, and reports a damaged clip plainly', async () => {
    await expect(stitchClips([], path.join(dir, 'x.mp4'))).rejects.toThrow(/no clips/);
    const bad = path.join(dir, 'bad.mp4'); await (await import('node:fs/promises')).writeFile(bad, 'not a video');
    await expect(stitchClips([bad], path.join(dir, 'y.mp4'))).rejects.toThrow(/FFmpeg stopped/);
  }, 60_000);
  it('only downloads clips from secure public addresses', async () => {
    for (const link of ['http://example.com/a.mp4', 'https://localhost/a.mp4', 'https://127.0.0.1/a.mp4', 'https://10.0.0.5/a.mp4']) await expect(downloadClip(link)).rejects.toThrow();
  });
});
