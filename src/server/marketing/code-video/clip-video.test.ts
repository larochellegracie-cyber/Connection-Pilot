import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';

vi.mock('#airo/secrets', () => ({ getSecret: () => 'test' }));
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { saveBusinessImage } from '../standard-video/business-assets.js';
import { LocalVolumeStorage } from '../standard-video/storage.js';
import { cleanIdea } from './idea.js';
import { clipPrompt, planShots, renderClipVideo, type ClipDeps } from './clip-video.js';
import { availableMethods, methodsText } from './production.js';

const exec = promisify(execFile); const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const shot = (beat: string, seconds: number, extra: Record<string, unknown> = {}) => ({ beat, seconds, source: 'generated', still: `a ${beat} picture`, motion: `slow push-in while the ${beat} subject moves`, words: '', ...extra });

describe('the production method decides how a video is made', () => {
  it('reads the method and the timed shots from an idea, and offers only methods that can run', () => {
    const idea = cleanIdea({ type: 'mini story', title: 'T', logline: 'L', story: 'S', scenes: 4, method: 'generated_clip', shots: [shot('hook', 3), shot('cta', 4, { words: 'Call now' }), { beat: 'empty' }] });
    expect(idea?.method).toBe('generated_clip'); expect(idea?.shots.map((s) => s.beat)).toEqual(['hook', 'cta']);
    expect(cleanIdea({ type: 'x', logline: 'L', story: 'S', scenes: 1, method: 'nonsense' })?.method).toBe('photo_montage');
    expect(availableMethods()).toContain('motion_graphics'); expect(methodsText(['generated_clip'])).toMatch(/REAL MOTION/);
  });
  it('keeps shots to whole seconds the video model makes and holds the total to the cap, with the motion first in the prompt', () => {
    const planned = planShots([shot('a', 12), shot('b', 1), shot('c', 9)].map((s) => ({ ...s, source: 'generated' as const })), 14);
    expect(planned.every((s) => s.seconds >= 2 && s.seconds <= 10)).toBe(true); expect(planned.reduce((a, s) => a + s.seconds, 0)).toBeLessThanOrEqual(14);
    expect(clipPrompt(planned[0], { visual_style: 'moody' } as never).startsWith('slow push-in')).toBe(true);
  });
  it('makes a starting picture per shot, animates each, cuts them together and lays the words over', async () => {
    const bin = ffmpegPath(); if (!bin) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'clips-')); const storage = new LocalVolumeStorage(path.join(dir, 'media'), false);
    try {
      const c = createCanvas(256, 384); const x = c.getContext('2d'); x.fillStyle = '#336699'; x.fillRect(0, 0, 256, 384);
      const bytes = c.toBuffer('image/jpeg'); const made: string[] = [];
      const generate = async (subject: string) => { const meta = await saveBusinessImage({ tenantId: TENANT, bytes, originalName: `${made.length}.jpg`, storage, fields: { kind: 'photo', label: subject.slice(0, 40), description: '', tags: ['generated', 'ai-image'] } } as never); made.push(meta.id); return { id: meta.id, label: meta.label }; };
      const requests: string[] = [];
      const deps: ClipDeps = { startClip: async (r) => { requests.push(r.prompt); const file = path.join(dir, `src-${requests.length}.mp4`); await exec(bin, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=720x1280:rate=30:duration=${r.seconds}`, '-pix_fmt', 'yuv420p', file]); return { taskId: file, estimatedCredits: r.seconds * 12 }; }, checkClip: async (id) => ({ status: 'succeeded', url: id }), fetchClip: async (url) => readFile(url), sleep: async () => undefined, pollMs: 1, clipTimeoutMs: 5000 };
      const idea = cleanIdea({ type: 'mini story', title: 'T', logline: 'L', story: 'S', scenes: 2, method: 'generated_clip', visual_style: 'moody', cta: 'Tap to call', shots: [shot('hook', 2, { words: 'One drip' }), shot('cta', 2, { words: 'Tap to call' })] })!;
      const out = path.join(dir, 'out.mp4');
      const result = await renderClipVideo({ tenantId: TENANT, idea, business: { name: 'Brightline Plumbing', type: 'Plumbing' }, accent: '#1E6FD9', pictures: [], storage, facts: 'Brightline Plumbing tap to call one drip', generate, complete: async () => JSON.stringify({ problems: [] }), workDir: path.join(dir, 'work'), outPath: out, deps });
      if (!result.ok) throw new Error(result.reason); expect(result.ok).toBe(true);
      expect(made.length).toBe(2); expect(requests.length).toBe(2); expect(requests[0]).toMatch(/^slow push-in/); expect(result.credits).toBe(48); expect(result.seconds).toBe(4);
      expect((await stat(out)).size).toBeGreaterThan(1000);
      const info = await exec(bin, ['-i', out]).catch((e: { stderr: string }) => e.stderr); expect(String(info)).toMatch(/1080x1920/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);
});
