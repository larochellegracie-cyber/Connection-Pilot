import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { ensureFonts } from './fonts';
import { ffmpegAvailable, ffmpegPath } from './ffmpeg';
import { loadAssets } from './assets';
import { AssetProblem, saveBusinessImage, updateBusinessImage } from './business-assets';
import { cleanImage } from './images';
import { fitDurations, parseRequest, planStandardVideo, removeUngrounded } from './planner';
import { renderVideoSpec } from './render';
import { assetsNeeded, totalSeconds, validateSpec } from './spec';
import { LocalVolumeStorage } from './storage';
import type { BusinessBrief } from '../store';
import type { BrandKit } from './templates';

const run = promisify(execFile);
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const kit: BrandKit = { name: 'Maple Lane Bakery', primary: '#5A2E1B', secondary: '#C77B3F', accent: '#F6D9B0', logoUrl: null };
const brief: BusinessBrief = {
  businessName: 'Maple Lane Bakery', businessType: 'bakery', location: 'Ottawa', website: '', description: 'A family bakery making birthday cakes and fresh bread.',
  services: ['Chocolate birthday cake', 'Sourdough bread'], pricing: '', targetCustomers: '', sellingPoints: ['Baked fresh every morning'], promotions: '', hours: '',
  brandVoice: { tone: 'warm', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true,
} as BusinessBrief;

/** A test picture made in memory (the fictional bakery's "photo"). Never used outside tests. */
const picture = (colour: string, w = 1200, h = 900, type: 'jpeg' | 'png' = 'jpeg') => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = colour; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(w / 4, h / 4, w / 2, h / 2); return type === 'jpeg' ? c.toBuffer('image/jpeg') : c.toBuffer('image/png'); };

let root: string; let storage: LocalVolumeStorage;
beforeAll(async () => { await ensureFonts(); root = await mkdtemp(path.join(os.tmpdir(), 'planner-test-')); storage = new LocalVolumeStorage(root, false); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const scripted = (answer: unknown) => vi.fn(async () => ({ text: JSON.stringify(answer), usage: { inputTokens: 900, outputTokens: 400 } }));
const answer = (cake: string, bread: string) => ({
  hook: 'Treat them to a chocolate birthday cake', cta: 'Order your cake today', caption: 'Fresh chocolate birthday cakes, baked at Maple Lane Bakery. Order yours today.', hashtags: ['#birthdaycake', '#bakery'], reasoning: 'Lead with the cake photo, end on ordering.',
  scenes: [
    { role: 'hook', seconds: 3, headline: 'Chocolate birthday cake', subtext: 'Baked fresh every morning', asset: cake, photoStyle: 'full', layout: 'bottom', animation: 'fade', transition: 'zoom' },
    { role: 'product', seconds: 5, headline: 'Rich, soft and made to share', subtext: '', asset: bread, photoStyle: 'full', layout: 'bottom', animation: 'slide-up', transition: 'slide-left' },
    { role: 'detail', seconds: 5, headline: 'Made fresh at Maple Lane Bakery', subtext: '', asset: null, photoStyle: 'card', layout: 'center', animation: 'pop', transition: 'wipe' },
    { role: 'cta', seconds: 4, headline: 'Order your cake today', subtext: '', asset: null, photoStyle: 'card', layout: 'center', animation: 'pop', transition: 'fade' },
  ],
});

describe('request reading', () => {
  it('reads length, platform and size from the owner’s words', () => {
    expect(parseRequest('Make me a 20-second Instagram ad for my chocolate cake.')).toMatchObject({ durationSeconds: 20, platform: 'instagram' });
    expect(parseRequest('a thirty second TikTok video')).toMatchObject({ durationSeconds: 30, platform: 'tiktok' });
    expect(parseRequest('a video').durationSeconds).toBeNull();
  });
  it('removes numbers and links that are not in the business information', () => {
    expect(removeUngrounded('50% off today', 'a bakery').removed).toBe(true);
    expect(removeUngrounded('Open since 2010', 'open since 2010').removed).toBe(false);
  });
  it('fits scene lengths to the requested total', () => {
    const scenes = fitDurations([{ seconds: 3 }, { seconds: 3 }, { seconds: 3 }] as never, 20);
    expect(scenes.reduce((sum, scene) => sum + scene.seconds, 0)).toBeCloseTo(20, 1);
  });
});

describe('business image upload', () => {
  it('stores a cleaned image for one business only, with its description', async () => {
    const meta = await saveBusinessImage({ tenantId: A, bytes: picture('#8B4513'), originalName: '../../evil name.jpg', fields: { kind: 'product', label: 'Chocolate birthday cake', tags: ['cake'] }, storage });
    expect(meta.originalName).not.toContain('/'); expect(meta.label).toBe('Chocolate birthday cake');
    expect((await storage.listAssets(A)).map((a) => a.id)).toContain(meta.id);
    expect(await storage.listAssets(B)).toEqual([]);
    expect(await storage.getAssetMeta(B, meta.id)).toBeNull();
    expect((await loadAssets({ ids: [meta.id], tenantId: B, storage, logoUrl: null })).missing).toEqual([meta.id]);
  });
  it('rejects files that are not pictures and products with no name', async () => {
    await expect(saveBusinessImage({ tenantId: A, bytes: Buffer.from('<svg onload=alert(1)/>'), originalName: 'x.svg', fields: { kind: 'photo' }, storage })).rejects.toBeInstanceOf(AssetProblem);
    await expect(saveBusinessImage({ tenantId: A, bytes: picture('#000'), originalName: 'x.jpg', fields: { kind: 'product' }, storage })).rejects.toBeInstanceOf(AssetProblem);
  });
  it('shrinks huge pictures and can relabel one', async () => {
    const big = await cleanImage(picture('#123456', 3000, 2400));
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(2160);
    const meta = await saveBusinessImage({ tenantId: A, bytes: picture('#222'), originalName: 'a.jpg', fields: { kind: 'photo', label: 'Shop front' }, storage });
    expect((await updateBusinessImage({ tenantId: A, assetId: meta.id, fields: { label: 'Storefront' }, storage }))?.label).toBe('Storefront');
    expect(await updateBusinessImage({ tenantId: B, assetId: meta.id, fields: { label: 'x' }, storage })).toBeNull();
  });
});

describe.skipIf(!ffmpegAvailable())('fictional bakery: chocolate birthday cake ad', () => {
  it('plans from the request, uses the cake photo, and renders a real MP4 without Runway', async () => {
    storage = new LocalVolumeStorage(await mkdtemp(path.join(os.tmpdir(), 'planner-bakery-')), false);
    const cake = await saveBusinessImage({ tenantId: A, bytes: picture('#4A2511', 1200, 1600), originalName: 'cake.jpg', fields: { kind: 'product', label: 'Chocolate birthday cake', description: 'Three-layer chocolate cake with candles', tags: ['cake', 'birthday'] }, storage });
    const bread = await saveBusinessImage({ tenantId: A, bytes: picture('#D9A441'), originalName: 'bread.jpg', fields: { kind: 'product', label: 'Sourdough bread' }, storage });
    const ai = scripted(answer('a2', 'a1')); // the AI wrongly offers the bread photo for scene 2 and aliases may be in any order
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const assets = await storage.listAssets(A);
    const plan = await planStandardVideo({ request: 'Make me a 20-second Instagram ad for my chocolate birthday cake. Make it appetizing and encourage people to order.', brief, kit, assets, logoId: null }, ai);

    expect(ai).toHaveBeenCalledTimes(1);
    expect(plan.usage).toMatchObject({ calls: 1, inputTokens: 900, outputTokens: 400 });
    expect(plan.summary.size).toBe('1080x1920');
    expect(plan.summary.durationSeconds).toBe(20);
    expect(plan.summary.scenes[0].role).toBe('hook');
    expect(plan.summary.scenes.at(-1)?.role).toBe('cta');
    expect(plan.summary.photosUsed.map((p) => p.id)).toContain(cake.id);
    expect(plan.summary.photosUsed.map((p) => p.id)).not.toContain(bread.id); // the unrelated bread photo is swapped for the cake
    const checked = validateSpec(plan.spec);
    expect(checked.ok).toBe(true);
    expect(totalSeconds(plan.spec)).toBeCloseTo(20, 1);
    expect(assetsNeeded(plan.spec)).toEqual([cake.id]);

    const out = path.join(root, 'bakery.mp4');
    const loaded = await loadAssets({ ids: assetsNeeded(plan.spec), tenantId: A, storage, logoUrl: null });
    expect(loaded.missing).toEqual([]);
    await renderVideoSpec({ spec: plan.spec, assets: loaded.assets, outPath: out, timeoutMs: 120_000 });
    expect((await stat(out)).size).toBeGreaterThan(20_000);
    const { stderr } = await run(ffmpegPath()!, ['-hide_banner', '-i', out]).catch((e) => ({ stderr: String(e.stderr) }));
    expect(stderr).toMatch(/Video: h264/); expect(stderr).toMatch(/1080x1920/); expect(stderr).toMatch(/Duration: 00:00:(19\.[5-9]|20\.[0-4])/);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('runway'))).toHaveLength(0);
    fetchSpy.mockRestore();
  }, 180_000);

  it('uses no photo, and says so, when nothing uploaded matches', async () => {
    const empty = new LocalVolumeStorage(await mkdtemp(path.join(os.tmpdir(), 'planner-empty-')), false);
    const plan = await planStandardVideo({ request: 'a 15-second video for my chocolate birthday cake', brief, kit, assets: await empty.listAssets(A), logoId: null }, scripted(answer('a1', 'a1')));
    expect(plan.summary.photosUsed).toEqual([]);
    expect(plan.notes.join(' ')).toMatch(/No pictures have been uploaded/);
    expect(assetsNeeded(plan.spec)).toEqual([]);
  });
});

describe('planner wording', () => {
  it('never shows the planner’s internal picture labels to the owner', async () => {
    const plan = await planStandardVideo({ request: 'a 15-second video for my chocolate birthday cake', brief, kit, assets: [], logoId: null }, scripted({ ...answer('a1', 'a1'), reasoning: 'The photo a1 is used to hook viewers, then a2 closes.' }));
    expect(plan.reasoning).not.toMatch(/\ba\d\b/);
    expect(plan.reasoning).toContain('your photo');
  });
});
