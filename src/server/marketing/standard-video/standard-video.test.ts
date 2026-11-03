import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, utimes, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { drawFrame, progressOf, sceneStarts } from './draw';
import { ensureFonts } from './fonts';
import { ffmpegAvailable, ffmpegPath } from './ffmpeg';
import { getStandardTask, resetJobsForTests, startStandardRender, StandardVideoError } from './jobs';
import { renderVideoSpec } from './render';
import { sizes, totalSeconds, validateSpec, assetsNeeded, type VideoSpec } from './spec';
import { isSafeId, LocalVolumeStorage } from './storage';
import { parseBrandColors, sampleSpec, specFromConcept, type BrandKit } from './templates';
import type { VideoConcept } from '@/lib/marketing-content';

const run = promisify(execFile);
const kit: BrandKit = { name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null };
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let root: string;
let storage: LocalVolumeStorage;
beforeAll(async () => { await ensureFonts(); });
beforeEach(async () => { resetJobsForTests(); root = await mkdtemp(path.join(os.tmpdir(), 'sv-test-')); storage = new LocalVolumeStorage(root, false); });
afterAll(async () => { resetJobsForTests(); });

const concept: VideoConcept = { durationSeconds: 15, transitions: 'Quick cuts', audioDirection: 'Upbeat', render: { status: 'not_generated' }, scenes: [
  { seconds: 3, visual: 'Leaf-filled pool edge', onScreenText: 'Pool closing? We handle it.', voiceover: 'We remove leaves and debris.' },
  { seconds: 3, visual: 'Technician testing water', onScreenText: 'Balance the water.' },
  { seconds: 3, visual: 'Pump check', onScreenText: 'Check pool equipment.' },
] };
const item = { platform: 'tiktok' as const, hook: 'Pool closing? We handle it.', cta: 'Book your pool closing today.' };

const waitFor = async (condition: () => Promise<boolean>, ms = 90_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error('timed out waiting'); };
const probe = async (file: string) => { const { stderr } = await run(ffmpegPath()!, ['-hide_banner', '-i', file]).catch((error) => ({ stderr: String(error.stderr ?? '') })); return stderr; };

describe('scene plans are validated', () => {
  const base = () => ({ version: 1, size: '540x960', fps: 30, brand: { name: 'X' }, scenes: [{ seconds: 2, background: { type: 'solid', color: '#112233' }, elements: [{ type: 'text', text: 'Hello', x: 10, y: 10, size: 40, color: '#fff' }] }] });
  it('accepts a simple plan and fills in the brand defaults', () => {
    const result = validateSpec(base());
    expect(result).toMatchObject({ ok: true, spec: { size: '540x960', fps: 30, audio: 'silent', brand: { primary: '#0B1F44', secondary: '#2454D6' } } });
  });
  it('rejects bad sizes, empty plans, too many scenes, too long videos, bad colours, empty text and unknown elements', () => {
    expect(validateSpec({ ...base(), size: '999x999' })).toMatchObject({ ok: false, error: expect.stringMatching(/size must be one of/) });
    expect(validateSpec({ ...base(), scenes: [] })).toMatchObject({ ok: false, error: 'The video needs at least one scene.' });
    expect(validateSpec({ ...base(), scenes: Array.from({ length: 13 }, () => base().scenes[0]) })).toMatchObject({ ok: false, error: expect.stringMatching(/at most 12 scenes/) });
    expect(validateSpec({ ...base(), scenes: Array.from({ length: 4 }, () => ({ ...base().scenes[0], seconds: 20 })) })).toMatchObject({ ok: false, error: expect.stringMatching(/at most 60 seconds/) });
    expect(validateSpec({ ...base(), scenes: [{ ...base().scenes[0], background: { type: 'solid', color: 'url(javascript:alert(1))' } }] })).toMatchObject({ ok: false, error: expect.stringMatching(/must be a colour/) });
    expect(validateSpec({ ...base(), scenes: [{ ...base().scenes[0], elements: [{ type: 'text', text: '   ', x: 0, y: 0, size: 40, color: '#fff' }] }] })).toMatchObject({ ok: false, error: 'A text element has no text.' });
    expect(validateSpec({ ...base(), scenes: [{ ...base().scenes[0], elements: [{ type: 'script', code: 'x' }] }] })).toMatchObject({ ok: false, error: expect.stringMatching(/not recognised/) });
    expect(validateSpec({ ...base(), scenes: [{ ...base().scenes[0], background: { type: 'image', asset: '../../etc/passwd' } }] })).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid image name/) });
    expect(validateSpec(null)).toMatchObject({ ok: false });
  });
  it('lists the pictures a plan needs', () => {
    const spec = (validateSpec({ ...base(), brand: { name: 'X', logo: 'logo' }, scenes: [{ seconds: 2, background: { type: 'image', asset: 'cake1' }, elements: [{ type: 'image', asset: 'cake2', x: 0, y: 0, width: 10, height: 10 }] }] }) as { spec: VideoSpec }).spec;
    expect(assetsNeeded(spec).sort()).toEqual(['cake1', 'cake2', 'logo']);
  });
});

describe('templates', () => {
  it('builds a branded plan from a video concept: a scene per step plus a call-to-action ending', () => {
    const spec = specFromConcept({ concept, item, kit, hasLogo: false });
    expect(spec.size).toBe('1080x1920');
    expect(spec.scenes).toHaveLength(4);
    const texts = spec.scenes.flatMap((scene) => scene.elements.filter((el) => el.type === 'text').map((el) => (el as { text: string }).text));
    expect(texts).toEqual(expect.arrayContaining(['Pool closing? We handle it.', 'We remove leaves and debris.', 'Balance the water.', 'Check pool equipment.', 'Book your pool closing today.', 'Somerset Pool Service']));
    expect(totalSeconds(spec)).toBeGreaterThanOrEqual(9);
    expect(spec.scenes.at(-1)!.transition).toBeUndefined();
    expect(spec.audio).toBe('silent');
  });
  it('uses real photos as backgrounds when it has them, and only those', () => {
    const spec = specFromConcept({ concept, item, kit, hasLogo: true, photos: ['cake1'] });
    expect(spec.scenes.slice(0, 3).every((scene) => scene.background.type === 'image')).toBe(true);
    expect(assetsNeeded(spec).sort()).toEqual(['cake1', 'logo']);
    expect(assetsNeeded(specFromConcept({ concept, item, kit, hasLogo: false }))).toEqual([]);
  });
  it('uses a square video for LinkedIn and a vertical one elsewhere', () => {
    expect(specFromConcept({ concept, item: { ...item, platform: 'linkedin' }, kit, hasLogo: false }).size).toBe('1080x1080');
  });
  it('reads brand colours out of free text, falling back to the Connection Pilot palette', () => {
    expect(parseBrandColors('Deep teal #0a5f5f and cream #FFF3E0, accent #f59e0b')).toEqual({ primary: '#0A5F5F', secondary: '#FFF3E0', accent: '#F59E0B' });
    expect(parseBrandColors('green and gold')).toEqual({ primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF' });
    expect(parseBrandColors(null).primary).toBe('#0B1F44');
  });
  it('switches text to dark on a light brand colour', () => {
    expect(specFromConcept({ concept, item, kit: { ...kit, primary: '#F5F0E8' }, hasLogo: false }).brand.textColor).toBe('#0B1F44');
  });
  it('trims very long text so it fits on screen', () => {
    const long = { ...concept, scenes: [{ seconds: 3, visual: 'x', onScreenText: 'word '.repeat(80) }, concept.scenes[1]] };
    const headline = specFromConcept({ concept: long, item, kit, hasLogo: false }).scenes[0].elements.find((el) => el.type === 'text') as { text: string };
    expect(headline.text.length).toBeLessThanOrEqual(90);
  });
});

describe('drawing frames', () => {
  const spec = (validateSpec({ version: 1, size: '540x960', fps: 30, brand: { name: 'Somerset' }, scenes: [
    { seconds: 2, background: { type: 'gradient', from: '#0B1F44', to: '#2454D6' }, transition: { type: 'slide-left', seconds: 0.5 }, elements: [{ type: 'text', text: 'First scene', x: 40, y: 400, width: 460, size: 60, weight: 800, color: '#FFFFFF', animation: { type: 'slide-up', delay: 0.2, duration: 0.5 } }] },
    { seconds: 2, background: { type: 'solid', color: '#7C3AED' }, elements: [{ type: 'text', text: 'Second scene', x: 40, y: 400, width: 460, size: 60, color: '#FFFFFF' }] },
  ] }) as { spec: VideoSpec }).spec;
  const frame = (time: number) => { const canvas = createCanvas(540, 960); drawFrame(canvas.getContext('2d'), spec, new Map(), time); return canvas.data(); };
  const pixel = (buffer: Buffer, x: number, y: number) => [...buffer.subarray((y * 540 + x) * 4, (y * 540 + x) * 4 + 4)];

  it('draws the background and animates text in over time', () => {
    const start = frame(0); const later = frame(1);
    expect(pixel(start, 270, 20)).not.toEqual([0, 0, 0, 0]); // the background is opaque
    expect(Buffer.compare(start, later)).not.toBe(0);
    expect(progressOf({ type: 'fade', delay: 0.2, duration: 0.5 }, 0)).toBe(0);
    expect(progressOf({ type: 'fade', delay: 0.2, duration: 0.5 }, 5)).toBe(1);
    expect(progressOf(undefined, 0)).toBe(1);
  });
  it('is repeatable: the same moment always gives the same picture', () => {
    expect(Buffer.compare(frame(0.9), frame(0.9))).toBe(0);
  });
  it('moves from one scene to the next through the transition', () => {
    expect(sceneStarts(spec)).toEqual([0, 2]);
    const before = frame(1.2); const during = frame(1.75); const after = frame(2.2);
    expect(pixel(after, 270, 100).slice(0, 3)).toEqual([0x7C, 0x3A, 0xED]); // the second scene's solid colour
    expect(Buffer.compare(during, before)).not.toBe(0);
    expect(Buffer.compare(during, after)).not.toBe(0);
  });
});

describe.skipIf(!ffmpegAvailable())('making a real MP4', () => {
  it('renders a short Standard Video to an actual H.264 MP4 with a silent audio track', async () => {
    const out = path.join(root, 'sample.mp4');
    const spec = sampleSpec(kit, false);
    const result = await renderVideoSpec({ spec, assets: new Map(), outPath: out });
    expect(result).toEqual({ frames: 120, seconds: 4, width: 720, height: 1280 });
    const info = await stat(out);
    expect(info.size).toBeGreaterThan(10_000);
    const text = await probe(out);
    expect(text).toMatch(/Video: h264/);
    expect(text).toMatch(/720x1280/);
    expect(text).toMatch(/Audio: aac/);
    expect(text).toMatch(/Duration: 00:00:04/);
    expect(text).toMatch(/yuv420p/);
    expect((await readdir(root)).filter((name) => name.endsWith('.png'))).toEqual([]); // no frame files exist
  }, 120_000);

  it('renders a branded video from a concept at full size, and reports how long it took', async () => {
    const out = path.join(root, 'full.mp4');
    const started = Date.now();
    const spec = specFromConcept({ concept, item, kit, hasLogo: false });
    await renderVideoSpec({ spec, assets: new Map(), outPath: out });
    const seconds = (Date.now() - started) / 1000;
    expect(await probe(out)).toMatch(/1080x1920/);
    console.info(`full-size ${totalSeconds(spec)}s video rendered in ${seconds.toFixed(1)}s, ${(await stat(out)).size} bytes`);
  }, 180_000);

  it('stops and cleans up when cancelled or when it takes too long', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(renderVideoSpec({ spec: sampleSpec(kit, false), assets: new Map(), outPath: path.join(root, 'x.mp4'), signal: controller.signal })).rejects.toThrow(/cancelled/);
    await expect(renderVideoSpec({ spec: sampleSpec(kit, false), assets: new Map(), outPath: path.join(root, 'y.mp4'), timeoutMs: -1 })).rejects.toThrow(/took too long/);
  }, 60_000);

  it('draws a real photo and logo into the video', async () => {
    const photo = createCanvas(400, 300); const pctx = photo.getContext('2d'); pctx.fillStyle = '#ff0000'; pctx.fillRect(0, 0, 400, 300);
    const image = await loadImage(photo.toBuffer('image/png'));
    const spec = (validateSpec({ version: 1, size: '540x960', fps: 12, brand: { name: 'Somerset', logo: 'logo' }, scenes: [{ seconds: 1, background: { type: 'image', asset: 'photo', kenBurns: { from: 1, to: 1.1 } }, elements: [{ type: 'brand', position: 'top' }] }] }) as { spec: VideoSpec }).spec;
    const canvas = createCanvas(540, 960); drawFrame(canvas.getContext('2d'), spec, new Map([['photo', image], ['logo', image]]), 0.5);
    const middle = [...canvas.data().subarray((600 * 540 + 270) * 4, (600 * 540 + 270) * 4 + 3)];
    expect(middle[0]).toBeGreaterThan(200); expect(middle[1]).toBeLessThan(60); // the red photo fills the picture
    await renderVideoSpec({ spec, assets: new Map([['photo', image], ['logo', image]]), outPath: path.join(root, 'photo.mp4') });
    expect(await probe(path.join(root, 'photo.mp4'))).toMatch(/540x960/);
  }, 60_000);
});

describe('storage keeps businesses apart', () => {
  it('only accepts safe ids, and never paths', () => {
    expect(isSafeId(TENANT_A)).toBe(true);
    for (const bad of ['../etc/passwd', 'a/b', '..', '', 'short', 'x'.repeat(65), 'has space123', undefined, 42]) expect(isSafeId(bad)).toBe(false);
  });
  it('stores each business’s video in its own folder and cannot read another’s', async () => {
    const temp = await storage.makeTempDir(TENANT_A);
    await writeFile(path.join(temp, 'v.mp4'), 'video-bytes');
    await storage.saveVideo(TENANT_A, 'video-aaaa-1111', path.join(temp, 'v.mp4'));
    expect(await storage.hasVideo(TENANT_A, 'video-aaaa-1111')).toBe(true);
    expect(await storage.hasVideo(TENANT_B, 'video-aaaa-1111')).toBe(false);
    expect(await storage.openVideo(TENANT_B, 'video-aaaa-1111')).toBeNull();
    expect(await storage.openVideo(TENANT_A, '../../' + TENANT_B)).toBeNull();
    const file = (await storage.openVideo(TENANT_A, 'video-aaaa-1111'))!;
    expect(file.size).toBe(11);
    expect(await storage.usage(TENANT_A)).toBe(11);
    expect(await storage.usage(TENANT_B)).toBe(0);
    await expect(storage.saveVideo('../' + TENANT_B, 'video-aaaa-1111', path.join(temp, 'v.mp4'))).rejects.toThrow(/not valid/);
    await storage.deleteVideo(TENANT_A, 'video-aaaa-1111');
    expect(await storage.hasVideo(TENANT_A, 'video-aaaa-1111')).toBe(false);
  });
  it('serves a business’s own pictures only to that business', async () => {
    const dir = path.dirname(storage.assetPath(TENANT_A, 'cake-photo-1')); await mkdir(dir, { recursive: true });
    await writeFile(storage.assetPath(TENANT_A, 'cake-photo-1'), 'img');
    expect(await storage.openAsset(TENANT_A, 'cake-photo-1')).not.toBeNull();
    expect(await storage.openAsset(TENANT_B, 'cake-photo-1')).toBeNull();
    expect(await storage.openAsset(TENANT_A, '../../../etc/passwd')).toBeNull();
  });
  it('removes working folders that are left behind, and only old ones', async () => {
    const old = await storage.makeTempDir('job-old-0001'); const fresh = await storage.makeTempDir('job-new-0001');
    const longAgo = new Date(Date.now() - 3 * 3600_000); await utimes(old, longAgo, longAgo);
    expect(await storage.sweepTemp(3600_000)).toBe(1);
    expect(await readdir(path.join(root, 'tmp'))).toEqual([path.basename(fresh)]);
  });
  it('says where it keeps files and whether they survive a restart', () => {
    expect(new LocalVolumeStorage('/data/marketing', true).describe()).toEqual({ kind: 'local-volume', persistent: true, location: '/data/marketing' });
    expect(storage.describe().persistent).toBe(false);
  });
});

describe.skipIf(!ffmpegAvailable())('background rendering jobs', () => {
  it('queues a render, stores the finished MP4 for that business only, and leaves no working files behind', async () => {
    const spec = sampleSpec(kit, false);
    const { taskId } = await startStandardRender({ tenantId: TENANT_A, spec, assets: new Map(), storage });
    expect(['processing']).toContain((await getStandardTask({ tenantId: TENANT_A, taskId, storage })).status);
    await waitFor(async () => (await getStandardTask({ tenantId: TENANT_A, taskId, storage })).status !== 'processing');
    const done = await getStandardTask({ tenantId: TENANT_A, taskId, storage });
    expect(done).toEqual({ status: 'succeeded', url: `/api/marketing/media/videos/${taskId}.mp4` });
    const stored = (await storage.openVideo(TENANT_A, taskId))!;
    expect(stored.size).toBeGreaterThan(10_000);
    expect(await probe(path.join(root, 'tenants', TENANT_A, 'videos', `${taskId}.mp4`))).toMatch(/Video: h264/);
    // another business cannot see it, even with the id
    expect(await getStandardTask({ tenantId: TENANT_B, taskId, storage })).toMatchObject({ status: 'failed' });
    expect(await storage.openVideo(TENANT_B, taskId)).toBeNull();
    // working files are gone
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  }, 120_000);

  it('reports a failed render honestly and still cleans up', async () => {
    const bad = sampleSpec(kit, false);
    const { taskId } = await startStandardRender({ tenantId: TENANT_A, spec: { ...bad, size: 'nonsense' as never }, assets: new Map(), storage });
    await waitFor(async () => (await getStandardTask({ tenantId: TENANT_A, taskId, storage })).status !== 'processing');
    expect(await getStandardTask({ tenantId: TENANT_A, taskId, storage })).toMatchObject({ status: 'failed', message: expect.stringMatching(/could not be made/) });
    expect(await storage.hasVideo(TENANT_A, taskId)).toBe(false);
    expect(await readdir(path.join(root, 'tmp'))).toEqual([]);
  }, 60_000);

  it('still finds a finished video after the server restarts, and says plainly when a render was lost', async () => {
    const { taskId } = await startStandardRender({ tenantId: TENANT_A, spec: sampleSpec(kit, false), assets: new Map(), storage });
    await waitFor(async () => (await getStandardTask({ tenantId: TENANT_A, taskId, storage })).status === 'succeeded');
    resetJobsForTests(); // as if the server restarted
    expect(await getStandardTask({ tenantId: TENANT_A, taskId, storage })).toMatchObject({ status: 'succeeded' });
    expect(await getStandardTask({ tenantId: TENANT_A, taskId: 'lost-task-0001', storage })).toMatchObject({ status: 'failed', message: expect.stringMatching(/server restarted/) });
  }, 120_000);

  it('refuses to start when the business has used up its storage', async () => {
    process.env.MARKETING_MEDIA_MAX_MB_PER_BUSINESS = '50';
    try {
      const temp = await storage.makeTempDir(TENANT_A); await writeFile(path.join(temp, 'big'), Buffer.alloc(51 * 1024 * 1024));
      await storage.saveVideo(TENANT_A, 'big-video-0001', path.join(temp, 'big'));
      await expect(startStandardRender({ tenantId: TENANT_A, spec: sampleSpec(kit, false), assets: new Map(), storage })).rejects.toBeInstanceOf(StandardVideoError);
      await expect(startStandardRender({ tenantId: TENANT_B, spec: sampleSpec(kit, false), assets: new Map(), storage })).resolves.toHaveProperty('taskId'); // other businesses are not affected
    } finally { delete process.env.MARKETING_MEDIA_MAX_MB_PER_BUSINESS; }
  }, 60_000);
});

afterAll(async () => { await rm(os.tmpdir() + '/__noop__', { force: true }); });
export { sizes };
