import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ffmpegPath } from './standard-video/ffmpeg';
import { addMusic, composeMusic, musicProfile, SAMPLE_RATE, toWav, videoSeconds } from './music';

const must = (style: string[], instructions: string[] = [], seed = 's') => musicProfile(style, instructions, seed)!;
const rms = (samples: Float32Array, from = 0, to = samples.length) => { let sum = 0; for (let i = from; i < to; i += 1) sum += samples[i] * samples[i]; return Math.sqrt(sum / Math.max(1, to - from)); };
const peak = (samples: Float32Array) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
/** Loud hits per second: counts rises in the short-term energy, a rough beat count. */
const onsets = (samples: Float32Array) => { const win = Math.floor(SAMPLE_RATE * 0.02); let hits = 0; let prev = 0; for (let i = 0; i + win < samples.length; i += win) { const e = rms(samples, i, i + win); if (e > prev * 1.9 && e > 0.04) hits += 1; prev = e; } return hits / (samples.length / SAMPLE_RATE); };

describe('how the music is chosen', () => {
  it.each([
    [['dark', 'cinematic'], { feel: 'drone', bpm: 84, minor: true }],
    [['dramatic'], { feel: 'drone', minor: true }],
    [['fast', 'high energy'], { feel: 'beat', bpm: 124, drums: 2 }],
    [['luxury', 'elegant'], { feel: 'pad', bpm: 72, drums: 0, minor: false }],
    [['calm'], { feel: 'pad', drums: 0 }],
    [['bright', 'fun'], { feel: 'bounce', bpm: 112, minor: false }],
    [['summer'], { feel: 'bounce' }],
    [['retro'], { feel: 'retro', bpm: 100 }],
    [['modern'], { feel: 'beat', bpm: 100, drums: 1 }],
    [[], { feel: 'beat', bpm: 100 }],
    [['dark', 'fast'], { feel: 'beat', bpm: 110, minor: true, drums: 2 }], // a combination: the beat, faster, in a minor key
    [['bright', 'calm'], { feel: 'pad' }],
  ])('%j -> %j', (style, expected) => { expect(must(style as string[])).toMatchObject(expected); });

  it('honours “dramatic music” in the instructions, and “no music”', () => {
    expect(must(['modern'], ['dramatic music'])).toMatchObject({ feel: 'drone', minor: true });
    for (const none of ['no music', 'without music', 'No background music please', 'silent', 'no sound']) expect(musicProfile(['dark'], [none], 's')).toBeNull();
  });
  it('describes the choice in plain words for the owner', () => {
    expect(must(['dark', 'cinematic'])).toMatchObject({ name: 'Dark cinematic', description: 'a low drone and slow pulse in a minor key, with a rising swell and a final hit, 84 BPM' });
    expect(must(['fast']).description).toBe('a driving beat with kick, snare, hats and bass, 124 BPM');
  });
  it('is repeatable for the same style and seed, and varies the key between seeds', () => {
    expect(musicProfile(['dark'], [], 'job-a')).toEqual(musicProfile(['dark'], [], 'job-a'));
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => musicProfile(['dark'], [], seed)!.rootMidi)).size).toBeGreaterThan(1);
  });
});

describe('composing the track', () => {
  it('makes a stereo track exactly as long as asked, that is audible, not clipped, and fades in and out', () => {
    for (const style of [['dark', 'cinematic'], ['fast'], ['luxury'], ['bright', 'fun'], ['retro'], []]) {
      const track = composeMusic(must(style), 6, 'x');
      expect(track.left.length).toBe(6 * SAMPLE_RATE); expect(track.right.length).toBe(6 * SAMPLE_RATE);
      expect(rms(track.left)).toBeGreaterThan(0.05); expect(rms(track.right)).toBeGreaterThan(0.05); // audible
      expect(peak(track.left)).toBeLessThanOrEqual(0.71); expect(peak(track.right)).toBeLessThanOrEqual(0.71); // headroom for the AAC encode
      expect(Math.abs(track.left[0])).toBeLessThan(0.01); expect(Math.abs(track.left.at(-1)!)).toBeLessThan(0.01); // no click at either end
      expect(rms(track.left, track.left.length - 4000)).toBeLessThan(rms(track.left) * 0.6); // it fades out
      expect(track.left.every(Number.isFinite)).toBe(true);
    }
  });
  it('is deterministic: the same profile, length and seed give the same audio, and a different seed does not', () => {
    const a = composeMusic(must(['fast']), 4, 'seed-1'); const b = composeMusic(must(['fast']), 4, 'seed-1'); const c = composeMusic(must(['fast']), 4, 'seed-2');
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true); expect(Buffer.from(a.left.buffer).equals(Buffer.from(c.left.buffer))).toBe(false);
  });
  it('sounds different for different moods: a driving beat has far more hits than soft pads', () => {
    const fast = onsets(composeMusic(must(['fast']), 8, 'x').left); const pads = onsets(composeMusic(must(['luxury']), 8, 'x').left);
    expect(fast).toBeGreaterThan(pads * 2); expect(fast).toBeGreaterThan(2);
  });
  it('handles very short and long videos', () => {
    expect(composeMusic(must(['dark']), 2, 'x').left.length).toBe(2 * SAMPLE_RATE);
    const long = composeMusic(must(['bright']), 30, 'x'); expect(rms(long.left)).toBeGreaterThan(0.05);
  });
  it('writes a valid 16-bit stereo WAV', () => {
    const wav = toWav(composeMusic(must(['dark']), 1, 'x'));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF'); expect(wav.subarray(8, 16).toString()).toBe('WAVEfmt '); expect(wav.readUInt16LE(22)).toBe(2); expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE); expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.length).toBe(44 + SAMPLE_RATE * 4);
  });
});

describe('putting the music into the video', () => {
  let dir: string;
  const run = (args: string[]) => new Promise<string>((resolve, reject) => { const child = spawn(ffmpegPath()!, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; child.stderr.on('data', (c) => { err += c.toString(); }); child.on('close', (code) => (code === 0 || /At least one output file|Output file #0 does not contain/.test(err) ? resolve(err) : reject(new Error(err)))); });
  const meanVolume = async (file: string) => Number((await run(['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'])).match(/mean_volume: (-?[\d.]+) dB/)![1]);
  beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'music-')); await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=5:size=720x1280:rate=30', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(dir, 'silent.mp4')]); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('replaces the silent audio with the music, leaves the picture exactly as it was, and keeps the length', async () => {
    const out = path.join(dir, 'scored.mp4');
    expect(await meanVolume(path.join(dir, 'silent.mp4'))).toBeLessThan(-80); // it starts silent
    const { seconds } = await addMusic({ videoPath: path.join(dir, 'silent.mp4'), outPath: out, profile: must(['dark', 'cinematic']), wavPath: path.join(dir, 'm.wav'), seed: 'x' });
    expect(seconds).toBeGreaterThan(4.9); expect(seconds).toBeLessThan(5.2);
    expect(await meanVolume(out)).toBeGreaterThan(-25); // and now it has sound
    const info = await run(['-hide_banner', '-i', out]);
    expect(info).toMatch(/Video: h264.*720x1280/); expect(info).toMatch(/Audio: aac.*stereo/); expect(await videoSeconds(out)).toBeCloseTo(seconds, 1);
    expect((await readFile(out)).subarray(4, 8).toString()).toBe('ftyp');
  }, 120_000);
  it('reports plainly if the video cannot be read', async () => {
    await expect(videoSeconds(path.join(dir, 'missing.mp4'))).rejects.toThrow(/could not be read/);
    await expect(addMusic({ videoPath: path.join(dir, 'missing.mp4'), outPath: path.join(dir, 'x.mp4'), profile: must(['dark']), wavPath: path.join(dir, 'x.wav') })).rejects.toThrow();
  }, 60_000);
});
