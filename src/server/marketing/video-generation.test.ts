import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const mocks = vi.hoisted(() => ({ markGenerating: vi.fn(), saveStoryboard: vi.fn(), finish: vi.fn(), createContent: vi.fn(), getJob: vi.fn(), getContent: vi.fn(), saveContent: vi.fn() }));
vi.mock('./marketing-jobs.js', () => ({ markJobGenerating: (...a: unknown[]) => mocks.markGenerating(...a), saveJobStoryboard: (...a: unknown[]) => mocks.saveStoryboard(...a), finishJob: (...a: unknown[]) => mocks.finish(...a), getMarketingJob: (...a: unknown[]) => mocks.getJob(...a) }));
vi.mock('./store.js', () => ({ loadBrandKit: async () => ({ name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null }), createContent: (...a: unknown[]) => mocks.createContent(...a), getContent: (...a: unknown[]) => mocks.getContent(...a), saveContent: (...a: unknown[]) => mocks.saveContent(...a) }));
vi.mock('./service.js', () => ({ aiComplete: async () => '{}', loadMarketingInput: async () => ({}) }));

import { ffmpegPath } from './standard-video/ffmpeg';
import { LocalVolumeStorage } from './standard-video/storage';
import { saveBusinessImage } from './standard-video/business-assets';
import { failureMessage, getGenerationProgress, referenceDataUri, runGeneration, startVideoGeneration, type GenerationDeps } from './video-generation';
import { RunwayNotConfiguredError } from './runway';
import { stitchClips } from './video-stitch';
import { addMusic } from './music';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant = { id: TENANT, businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' };
const input = { brief: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', website: '', description: 'Pool openings and closings.', services: ['Pool closing'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: '', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true }, signals: [], trends: [], insights: [], existing: [], now: new Date('2026-10-23T12:00:00Z'), timezone: 'America/Toronto' };
const scenesReply = JSON.stringify({ scenes: [{ role: 'hook', description: 'A cover draws across the water.' }, { role: 'main', description: 'The cover settles over the pool.' }, { role: 'support', description: 'A detail of the cover edge.' }] });
const GOOD = 'Is your pool ready for the first freeze?\n\nSomerset Pool Service closes pools across Windsor-Essex, from water balance to the cover.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
const captionReply = (caption = GOOD, end = 'Book your pool closing') => JSON.stringify({ caption, hashtags: ['PoolClosing', 'WindsorEssex', 'PoolCare', 'SomersetPoolService'], cta: 'Book at somersetpoolservice.com or call (519) 982-4901.', end_card_text: end });
const ai = async (system: string) => (/storyboard for ONE/.test(system) ? scenesReply : /write the words for the closing card/i.test(system) ? JSON.stringify({ end_card_text: 'Call (519) 982-4901 today' }) : /rewrite ONE scene/i.test(system) ? JSON.stringify({ description: 'The main shot, now with the cover pulled slowly back to show clear water.' }) : captionReply());
const none = { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'n', selected_at: 'x' };
const job = (extra: Record<string, unknown> = {}) => ({ id: 'job-0001', status: 'confirmed', userMessage: 'Make me a 15 second TikTok about pool closing', brief: { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: [], iteration_of: null }, selection: none, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a', ...extra }) as any;

let root: string; let storage: LocalVolumeStorage; let clip: Buffer; let photoId: string;
const run = (args: string[]) => new Promise<string>((resolve, reject) => { const child = spawn(ffmpegPath()!, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; child.stderr.on('data', (c) => { err += c.toString(); }); child.on('close', (code) => (code === 0 || /At least one output file/.test(err) ? resolve(err) : reject(new Error(err)))); });
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'gen-test-')); storage = new LocalVolumeStorage(root, false);
  const file = path.join(root, 'fake.mp4'); await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=720x1280:rate=24', '-pix_fmt', 'yuv420p', file]); clip = await readFile(file);
  const c = createCanvas(900, 600); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 900, 600);
  photoId = (await saveBusinessImage({ tenantId: TENANT, bytes: c.toBuffer('image/jpeg'), originalName: 'cover.jpg', fields: { kind: 'product', label: 'Winter cover going on' }, storage })).id;
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

let started: Array<{ prompt: string; seconds: number; imageDataUri?: string }>; let concurrent = 0; let peak = 0;
const deps = (over: Partial<GenerationDeps> = {}): GenerationDeps => ({
  startClip: async (request) => { started.push(request); concurrent += 1; peak = Math.max(peak, concurrent); await new Promise((r) => setTimeout(r, 5)); concurrent -= 1; return { taskId: `task-${started.length}`, estimatedCredits: 50 }; },
  checkClip: async () => ({ status: 'succeeded', url: 'https://cdn.example.com/clip.mp4' }), fetchClip: async () => clip, stitch: (clips, out) => stitchClips(clips, out), addMusic, planAnimated: async () => { throw new Error('the free path is not used here'); }, renderSpec: async () => undefined, storage,
  complete: ai, loadInput: async () => input as never, sleep: async () => undefined, pollMs: 1, clipTimeoutMs: 5000, ...over,
});
beforeEach(() => { started = []; concurrent = 0; peak = 0; for (const spy of Object.values(mocks)) spy.mockReset(); for (const spy of [mocks.markGenerating, mocks.saveStoryboard, mocks.finish]) spy.mockResolvedValue(undefined);
  mocks.createContent.mockImplementation(async () => ({ id: 'lib-0001' })); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('making the video', () => {
  it('plans, makes each scene, draws the end card, joins everything, saves the video, and marks the job ready with the caption', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps() });
    expect(outcome).toBe('ready');
    expect(mocks.saveStoryboard).toHaveBeenCalledTimes(2); // once planned, once again with the saved clip ids
    const [t, id, storyboard] = mocks.saveStoryboard.mock.calls[0]; expect([t, id]).toEqual([TENANT, 'job-0001']); expect(storyboard.scenes.map((s: any) => s.role)).toEqual(['hook', 'main', 'support', 'ending']);
    const kept = mocks.saveStoryboard.mock.calls[1][2]; expect(kept.scenes.filter((s: any) => s.kind === 'clip').every((s: any) => /^[0-9a-f-]{36}$/.test(s.clip_video_id))).toBe(true); expect(kept.scenes[3].clip_video_id).toBeNull();
    for (const scene of kept.scenes.filter((s: any) => s.kind === 'clip')) expect(await storage.openVideo(TENANT, scene.clip_video_id)).not.toBeNull(); // each clip is saved, so a later change can reuse it
    expect(started).toHaveLength(3); // the ending is never sent to the generator
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    const [ft, fid, status, result] = mocks.finish.mock.calls[0];
    expect([ft, fid, status]).toEqual([TENANT, 'job-0001', 'ready']);
    expect(result).toMatchObject({ caption: GOOD, cta: 'Book at somersetpoolservice.com or call (519) 982-4901.', hashtags: ['#PoolClosing', '#WindsorEssex', '#PoolCare', '#SomersetPoolService'], scene_count: 4, total_seconds: 15, provider: 'Runway', estimated_credits: 150, library_item_id: 'lib-0001', error: null });
    expect(result.video_url).toMatch(/^\/api\/marketing\/media\/videos\/[0-9a-f-]{36}\.mp4$/);
    const stored = await storage.openVideo(TENANT, result.video_url.split('/').pop().replace('.mp4', ''));
    expect(stored).not.toBeNull(); const parts: Buffer[] = []; for await (const part of stored!.stream()) parts.push(Buffer.from(part)); const bytes = Buffer.concat(parts);
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
    const out = path.join(root, 'check.mp4'); await (await import('node:fs/promises')).writeFile(out, bytes); const info = await run(['-hide_banner', '-i', out]);
    expect(info).toMatch(/Video: h264.*720x1280/); expect(info).toMatch(/Audio: aac/); // one vertical video
    const loudness = Number((await run(['-hide_banner', '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-'])).match(/mean_volume: (-?[\d.]+) dB/)![1]);
    expect(loudness).toBeGreaterThan(-25); // with real music in it, not a silent track
    expect(result.music).toBe('Dark cinematic: a low drone and slow pulse in a minor key, with a rising swell and a final hit, 84 BPM');
    const [, h, m, s] = info.match(/Duration: (\d+):(\d+):([\d.]+)/)!.map(Number); expect(h * 3600 + m * 60 + s).toBeGreaterThan(8); // 3 clips of 2s + the 3s end card
  }, 180_000);

  it('adds music that fits the brief’s style, and says which in the result and the Library draft', async () => {
    await runGeneration({ tenant, job: job({ userMessage: 'Make me a 15 second AI video about pool closing', brief: { ...job().brief, style: ['fast', 'high energy'] } }), deps: deps() }); // asked for in so many words: the Runway path
    const result = mocks.finish.mock.calls[0][3];
    expect(result.music).toBe('Driving: a driving beat with kick, snare, hats and bass, 124 BPM');
    expect(mocks.createContent.mock.calls[0][1].video.audioDirection).toBe('Includes original background music made for this video (Driving: a driving beat with kick, snare, hats and bass, 124 BPM). You can replace it in the platform’s own app.');
  }, 120_000);

  it('adds no music, and says so, when the owner asked for none', async () => {
    await runGeneration({ tenant, job: job({ brief: { ...job().brief, key_instructions: ['no music'] } }), deps: deps() });
    expect(mocks.finish.mock.calls[0][2]).toBe('ready'); expect(mocks.finish.mock.calls[0][3].music).toBeNull(); expect(mocks.createContent.mock.calls[0][1].video.audioDirection).toMatch(/Silent video/);
  }, 120_000);

  it('still delivers the video, silent and honestly labelled, if the music cannot be added', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ addMusic: async () => { throw new Error('FFmpeg stopped with code 1. /private/secret/path'); } }) });
    expect(outcome).toBe('ready'); const result = mocks.finish.mock.calls[0][3];
    expect(result.music).toBeNull(); expect(result.video_url).toMatch(/^\/api\/marketing\/media\/videos\//); expect(result.error).toBeNull();
    expect(mocks.createContent.mock.calls[0][1].video.audioDirection).toMatch(/Silent video/); expect(JSON.stringify(mocks.finish.mock.calls)).not.toMatch(/secret/);
  }, 120_000);

  it('adds a draft to the Library with the finished video, and posts nothing', async () => {
    await runGeneration({ tenant, job: job(), deps: deps() });
    const [tenantId, item] = mocks.createContent.mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(item).toMatchObject({ kind: 'video', platform: 'tiktok', status: 'draft', scheduledFor: null, approvedAt: null, publishedAt: null, caption: GOOD, video: { mode: 'ai', durationSeconds: 15, render: { status: 'ready', provider: 'Runway' } } });
    expect(item.video.render.url).toMatch(/^\/api\/marketing\/media\/videos\//); expect(item.video.audioDirection).toMatch(/Includes original background music made for this video/); expect(item.suggestedVisual).toMatch(/No photos of your business were made up/);
  }, 120_000);

  it('starts the hook and main scenes from the owner’s selected photo, and the rest from text', async () => {
    const selection = { selected_assets: [{ id: photoId, label: 'Winter cover going on', description: '', type: 'photo', reason: 'r', score: 3 }], has_good_match: true, fallback_needed: false, note: 'n', selected_at: 'x' };
    await runGeneration({ tenant, job: job({ selection }), deps: deps() });
    expect(started.map((s) => !!s.imageDataUri)).toEqual([true, true, true]); // one photo: every supporting shot uses it too
    expect(started[0].imageDataUri).toMatch(/^data:image\/(jpeg|png);base64,/); expect(started[0].prompt).toContain('Start from the reference image');
    expect(mocks.createContent.mock.calls[0][1].suggestedVisual).toContain('Starts from your photo: Winter cover going on');
  }, 120_000);

  it('generates from text alone, with no reference image, when nothing fits', async () => {
    await runGeneration({ tenant, job: job(), deps: deps() });
    expect(started.every((s) => s.imageDataUri === undefined)).toBe(true); expect(started.every((s) => s.prompt.includes('Style: dark, cinematic.'))).toBe(true); expect(started.every((s) => s.seconds >= 2 && s.seconds <= 10)).toBe(true);
  }, 120_000);

  it('makes at most two scenes at a time', async () => {
    await runGeneration({ tenant, job: job({ brief: { ...job().brief, length_seconds: 20 } }), deps: deps() });
    expect(started).toHaveLength(4); expect(peak).toBeLessThanOrEqual(2);
  }, 120_000);

  it('reports progress while it works, and none once it has finished', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; }); const seen: Array<ReturnType<typeof getGenerationProgress>> = [];
    const run1 = runGeneration({ tenant, job: job(), deps: deps({ startClip: async (req) => { seen.push(JSON.parse(JSON.stringify(getGenerationProgress('job-0001')))); await gate; started.push(req); return { taskId: 't', estimatedCredits: null }; } }) });
    await new Promise((r) => setTimeout(r, 300)); release(); await run1;
    expect(seen[0]).toMatchObject({ phase: 'making', total: 4, done: 0 }); expect(seen[0]!.scenes.map((s) => s.role)).toEqual(['hook', 'main', 'support', 'ending']);
    expect(getGenerationProgress('job-0001')).toBeNull();
  }, 120_000);
});

describe('when something goes wrong', () => {
  it('tries a failed scene once more, and still finishes', async () => {
    let calls = 0;
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ checkClip: async (id) => (++calls === 1 ? { status: 'failed', message: 'The scene was rejected.' } : { status: 'succeeded', url: 'https://cdn.example.com/c.mp4' }) }) });
    expect(outcome).toBe('ready'); expect(started.length).toBe(4); // three scenes, one of them started twice
  }, 120_000);

  it('marks the job failed, with a plain reason and no secrets, when a scene fails twice; nothing is saved to the library', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ checkClip: async () => ({ status: 'failed', message: 'The scene was rejected.' }) }) });
    expect(outcome).toBe('failed');
    const [, , status, result] = mocks.finish.mock.calls[0];
    expect(status).toBe('failed'); expect(result).toMatchObject({ video_url: null, error: 'The scene was rejected. About 200 Runway credits may have been used before it stopped.', library_item_id: null }); // 4 attempts started (3 scenes + 1 retry) at 50 each
    expect(mocks.createContent).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.finish.mock.calls)).not.toMatch(/sk-|key_|Bearer/);
  }, 120_000);

  it('does not retry when the video service refuses outright (not connected, no credits)', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ startClip: async () => { started.push({ prompt: '', seconds: 2 }); throw new RunwayNotConfiguredError(); } }) });
    expect(outcome).toBe('failed'); expect(started.length).toBeLessThanOrEqual(2); // each lane stopped at its first refusal
    expect(mocks.finish.mock.calls[0][3].error).toBe('Runway is not connected. RUNWAYML_API_SECRET is not set in this app’s settings. No Runway credits were used.');
  }, 120_000);

  it('stops a scene that takes too long, and says so', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ checkClip: async () => ({ status: 'processing' }), clipTimeoutMs: 20, pollMs: 5, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }) });
    expect(outcome).toBe('failed'); expect(mocks.finish.mock.calls[0][3].error).toMatch(/^A scene took too long to make and was stopped\. (?:About \d+ Runway credits may have been used before it stopped|No Runway credits were used)\.$/);
  }, 120_000);

  it('fails cleanly if the clips cannot be joined, and never throws', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ stitch: async () => { throw new Error('FFmpeg stopped with code 1. secret-path'); } }) });
    expect(outcome).toBe('failed'); expect(mocks.finish.mock.calls[0][3].error).toMatch(/^The video encoder had a problem joining the clips\. About 150 Runway credits may have been used before it stopped\.$/);
  }, 120_000);

  it('says plainly when a selected photo has since been deleted', async () => {
    const selection = { selected_assets: [{ id: 'deleted-photo-1', label: 'Gone', description: '', type: 'photo', reason: 'r', score: 3 }], has_good_match: true, fallback_needed: false, note: 'n', selected_at: 'x' };
    expect(await runGeneration({ tenant, job: job({ selection }), deps: deps() })).toBe('failed');
    expect(mocks.finish.mock.calls[0][3].error).toBe('One of your selected photos is no longer available. Ask for the video again. No Runway credits were used.');
  }, 120_000);

  it('turns errors into plain sentences', () => {
    expect(failureMessage(new Error('FFmpeg stopped with code 1. /private/path'))).toBe('The video encoder had a problem joining the clips.');
    expect(failureMessage(new Error('Joining the clips took too long and was stopped.'))).toBe('The video took too long to make and was stopped.');
    expect(failureMessage(new Error('weird sk-live-abc123'))).toBe('Something went wrong while making the video, and nothing was finished.');
  });
});

describe('starting the video', () => {
  it('moves a confirmed job to "generating" and makes it in the background', async () => {
    const result = await startVideoGeneration({ tenant, job: job(), deps: deps() });
    expect(result.started).toBe(true); expect(mocks.markGenerating).toHaveBeenCalledWith(TENANT, 'job-0001');
    expect(await result.promise).toBe('ready');
  }, 120_000);
  it('retries a failed job when asked again', async () => {
    const result = await startVideoGeneration({ tenant, job: job({ status: 'failed' }), deps: deps() });
    expect(result.started).toBe(true); await result.promise;
  }, 120_000);
  it('does nothing without a selection, before the owner has confirmed, or while one is already being made', async () => {
    expect((await startVideoGeneration({ tenant, job: job({ selection: null }), deps: deps() })).started).toBe(false);
    expect((await startVideoGeneration({ tenant, job: job({ status: 'brief_ready' }), deps: deps() })).started).toBe(false);
    expect((await startVideoGeneration({ tenant, job: job({ status: 'generating' }), deps: deps() })).started).toBe(false);
    expect(mocks.markGenerating).not.toHaveBeenCalled(); expect(started).toHaveLength(0);
  });
});

describe('the reference photo', () => {
  it('is sent as a data URI, and only for this business’s own photo', async () => {
    expect(await referenceDataUri(TENANT, photoId, storage)).toMatch(/^data:image\/jpeg;base64,/);
    expect(await referenceDataUri('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', photoId, storage)).toBeNull();
    expect(await referenceDataUri(TENANT, 'no-such-photo', storage)).toBeNull();
  });
});
