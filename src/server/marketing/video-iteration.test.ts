import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const mocks = vi.hoisted(() => ({ markGenerating: vi.fn(), saveStoryboard: vi.fn(), finish: vi.fn(), createContent: vi.fn(), getJob: vi.fn(), getContent: vi.fn(), saveContent: vi.fn() }));
vi.mock('./marketing-jobs.js', () => ({ markJobGenerating: (...a: unknown[]) => mocks.markGenerating(...a), saveJobStoryboard: (...a: unknown[]) => mocks.saveStoryboard(...a), finishJob: (...a: unknown[]) => mocks.finish(...a), getMarketingJob: (...a: unknown[]) => mocks.getJob(...a) }));
vi.mock('./store.js', () => ({ loadBrandKit: async () => ({ name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null }), createContent: (...a: unknown[]) => mocks.createContent(...a), getContent: (...a: unknown[]) => mocks.getContent(...a), saveContent: (...a: unknown[]) => mocks.saveContent(...a) }));
vi.mock('./service.js', () => ({ aiComplete: async () => '{}', loadMarketingInput: async () => ({}) }));

import { detectCreativeRequest } from '@/lib/marketing-creative-mode';
import { mergeFallback } from './creative-brief';
import { ffmpegPath } from './standard-video/ffmpeg';
import { LocalVolumeStorage } from './standard-video/storage';
import { addMusic } from './music';
import { runGeneration, startVideoGeneration, type GenerationDeps } from './video-generation';
import { stitchClips } from './video-stitch';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant = { id: TENANT, businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' };
const input = { brief: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', website: 'https://somersetpoolservice.com', description: 'Pool openings and closings.', services: ['Pool closing'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: 'Professional', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true }, signals: [], trends: [], insights: [], existing: [], now: new Date('2026-10-23T12:00:00Z'), timezone: 'America/Toronto' };
const none = { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'n', selected_at: 'x' };
const GOOD = 'Is your pool ready for the first freeze?\n\nSomerset Pool Service closes pools across Windsor-Essex, from water balance to the cover.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
const NEWER = 'Cover on, worries off. Is your pool ready to close for winter?\n\nSomerset Pool Service closes pools across Windsor-Essex.\n\nCall (519) 982-4901 or book at somersetpoolservice.com.';
const caption = (text: string) => JSON.stringify({ caption: text, hashtags: ['PoolClosing', 'WindsorEssex', 'PoolCare', 'SomersetPoolService'], cta: 'Call (519) 982-4901 or book at somersetpoolservice.com.', end_card_text: 'Book your pool closing' });
let calls: { captions: number; revised: number; endText: number };
const ai = async (system: string, prompt = '') => {
  if (/storyboard for ONE/.test(system)) return JSON.stringify({ scenes: [{ role: 'hook', description: 'A cover draws across the water.' }, { role: 'main', description: 'The cover settles over the pool.' }, { role: 'support', description: 'A detail of the cover edge.' }] });
  if (/write the words for the closing card/i.test(system)) { calls.endText += 1; return JSON.stringify({ end_card_text: 'Call (519) 982-4901 today' }); }
  if (/rewrite ONE scene/i.test(system)) { calls.revised += 1; return JSON.stringify({ description: 'The main shot again, with the cover pulled back to show clear water.' }); }
  calls.captions += 1; return caption(/owner asked for this change to the caption/.test(prompt) ? NEWER : GOOD);
};

let root: string; let storage: LocalVolumeStorage; let clip: Buffer;
const run = (args: string[]) => new Promise<string>((resolve, reject) => { const child = spawn(ffmpegPath()!, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; child.stderr.on('data', (c) => { err += c.toString(); }); child.on('close', (code) => (code === 0 || /At least one output file|Output file #0 does not contain/.test(err) ? resolve(err) : reject(new Error(err)))); });
const meanVolume = async (file: string) => Number((await run(['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'])).match(/mean_volume: (-?[\d.]+) dB/)![1]);
const videoBytes = async (link: string) => { const f = await storage.openVideo(TENANT, link.split('/').pop()!.replace('.mp4', '')); const parts: Buffer[] = []; for await (const p of f!.stream()) parts.push(Buffer.from(p)); return Buffer.concat(parts); };

let started: Array<{ prompt: string; seconds: number }>; let fetched = 0; let stitchCalls: Array<{ n: number; options: unknown }>; let musicCalls: Array<{ feel: string }>;
const deps = (over: Partial<GenerationDeps> = {}): GenerationDeps => ({
  startClip: async (request) => { started.push(request); return { taskId: `task-${started.length}`, estimatedCredits: 50 }; },
  checkClip: async () => ({ status: 'succeeded', url: 'https://cdn.example.com/clip.mp4' }), fetchClip: async () => { fetched += 1; return clip; },
  stitch: (clips, out, options) => { stitchCalls.push({ n: clips.length, options }); return stitchClips(clips, out, options); },
  addMusic: (opts) => { musicCalls.push({ feel: opts.profile.feel }); return addMusic(opts); }, planAnimated: async () => { throw new Error('the free path is not used here'); }, renderSpec: async () => undefined, storage, complete: ai, loadInput: async () => input as never, sleep: async () => undefined, pollMs: 1, clipTimeoutMs: 5000, ...over,
});

const baseBrief = { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: [], iteration_of: null };
const baseJob = { id: 'job-base-0001', status: 'confirmed', userMessage: 'Make me a 15 second TikTok about pool closing', brief: baseBrief, selection: none, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a' } as any;
/** The finished earlier video, exactly as the first run left it. */
let earlier: any;
const iterate = async (message: string, over: { brief?: Record<string, unknown>; deps?: Partial<GenerationDeps>; earlierOverride?: any } = {}) => {
  const previous = over.earlierOverride ?? earlier;
  const brief = over.brief ?? mergeFallback(previous.brief, message, detectCreativeRequest(message), 'Somerset Pool Service', previous.id);
  const job = { id: `job-iter-${Math.random().toString(36).slice(2, 8)}`, status: 'generating', userMessage: message, brief, selection: previous.selection, storyboard: null, result: null, createdAt: 'b', updatedAt: 'b' } as any;
  for (const spy of [mocks.finish, mocks.saveStoryboard, mocks.saveContent, mocks.createContent]) spy.mockClear();
  mocks.getJob.mockImplementation(async (_t: string, id: string) => (id === previous.id ? previous : null)); // the job being changed, as given
  started = []; fetched = 0; stitchCalls = []; musicCalls = []; calls = { captions: 0, revised: 0, endText: 0 };
  const outcome = await runGeneration({ tenant, job, deps: deps(over.deps) });
  return { outcome, job, result: mocks.finish.mock.calls[0]?.[3], status: mocks.finish.mock.calls[0]?.[2], storyboard: mocks.saveStoryboard.mock.calls.at(-1)?.[2] };
};

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'iter-test-')); storage = new LocalVolumeStorage(root, false);
  const file = path.join(root, 'fake.mp4'); await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=720x1280:rate=24', '-pix_fmt', 'yuv420p', file]); clip = await readFile(file);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  for (const spy of Object.values(mocks)) spy.mockReset();
  for (const spy of [mocks.markGenerating, mocks.saveStoryboard, mocks.finish, mocks.saveContent]) spy.mockResolvedValue(undefined);
  mocks.createContent.mockResolvedValue({ id: 'lib-new-01' });
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
  if (!earlier) {
    started = []; stitchCalls = []; musicCalls = []; calls = { captions: 0, revised: 0, endText: 0 };
    await runGeneration({ tenant, job: baseJob, deps: deps() });
    const result = mocks.finish.mock.calls[0][3]; const storyboard = mocks.saveStoryboard.mock.calls.at(-1)![2];
    earlier = { ...baseJob, id: 'job-base-0001', status: 'ready', storyboard, result: { ...result, library_item_id: 'lib-0001' } };
    for (const spy of [mocks.finish, mocks.saveStoryboard]) spy.mockClear();
  }
  mocks.getJob.mockImplementation(async (_t: string, id: string) => (id === earlier?.id ? earlier : null));
  mocks.getContent.mockImplementation(async (_t: string, id: string) => (id === 'lib-0001' ? { id: 'lib-0001', kind: 'video', platform: 'tiktok', status: 'approved', approvedAt: '2026-10-23T00:00:00Z', scheduledFor: '2026-10-25', publishedAt: null, hook: 'old hook', caption: 'old caption', cta: 'old', hashtags: ['#old'], video: { mode: 'ai', durationSeconds: 15, scenes: [], transitions: 'Hard cuts', audioDirection: 'x', render: { status: 'ready', url: earlier.result.video_url, provider: 'Runway' } } } : null));
}, 240_000);

describe('the first video keeps its clips so a change can reuse them', () => {
  it('has a saved clip for every generated scene, and a finished video', () => {
    expect(earlier.storyboard.scenes.filter((s: any) => s.kind === 'clip').every((s: any) => /^[0-9a-f-]{36}$/.test(s.clip_video_id))).toBe(true); expect(earlier.storyboard.music_seed).toBe('job-base-0001');
    expect(earlier.result).toMatchObject({ video_url: expect.stringMatching(/^\/api\/marketing\/media\/videos\//), music: expect.stringMatching(/^Driving|Dark cinematic/) });
  });
});

describe('changing a finished video', () => {
  it('a new caption: no Runway, no new video, the same file; the Library draft gets the new words and goes back to Draft', async () => {
    const r = await iterate('make the caption punchier');
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(0); expect(fetched).toBe(0); expect(stitchCalls).toHaveLength(0); expect(musicCalls).toHaveLength(0);
    expect(r.result).toMatchObject({ video_url: earlier.result.video_url, caption: NEWER, estimated_credits: 0, library_item_id: 'lib-0001', error: null }); // the same video
    expect(calls.captions).toBe(1);
    const [, saved] = mocks.saveContent.mock.calls[0];
    expect(saved).toMatchObject({ id: 'lib-0001', status: 'draft', approvedAt: null, scheduledFor: null, caption: NEWER, hook: 'Cover on, worries off. Is your pool ready to close for winter?' }); expect(mocks.createContent).not.toHaveBeenCalled(); // updated in place, no second draft
  }, 120_000);

  it('new music: the same picture with a new track, and no Runway', async () => {
    const r = await iterate('make the music more dramatic');
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(0); expect(fetched).toBe(0); expect(musicCalls).toHaveLength(1);
    expect(r.result.video_url).not.toBe(earlier.result.video_url); expect(r.result.music).toMatch(/^Dark cinematic/); expect(r.result.estimated_credits).toBe(0);
    const out = path.join(root, 'music-only.mp4'); await writeFile(out, await videoBytes(r.result.video_url)); expect(await meanVolume(out)).toBeGreaterThan(-25);
    const same = (file: string) => run(['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-f', 'md5', '-']);
    const before = path.join(root, 'before.mp4'); await writeFile(before, await videoBytes(earlier.result.video_url)); expect(await same(out)).toBe(await same(before)); // the picture is untouched
  }, 120_000);

  it('taking the music out leaves a silent track', async () => {
    const r = await iterate('remove the music');
    expect(r.outcome).toBe('ready'); expect(r.result.music).toBeNull(); expect(musicCalls).toHaveLength(0);
    const out = path.join(root, 'silent.mp4'); await writeFile(out, await videoBytes(r.result.video_url)); expect(await meanVolume(out)).toBeLessThan(-80);
  }, 120_000);

  it('keeps the music exactly when the change does not touch it: the same seed, so the same track', async () => {
    const r = await iterate('change the ending to "Book your closing today"');
    expect(musicCalls).toHaveLength(1); expect(r.storyboard.music_seed).toBe(earlier.storyboard.music_seed); expect(r.result.music).toBe(earlier.result.music);
    const m = await iterate('make the music more dramatic');
    expect(m.storyboard.music_seed).toBe(m.job.id); expect(m.storyboard.music_seed).not.toBe(earlier.storyboard.music_seed); // new music is a new take
  }, 120_000);

  it('a new ending: only the end card is drawn again; every clip is reused, so no credits', async () => {
    const r = await iterate('change the ending to "Book your closing today"');
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(0); expect(stitchCalls).toEqual([{ n: 4, options: { grade: 0, gradedIndexes: [0, 1, 2] } }]);
    expect(r.storyboard.scenes[3].on_screen_text).toBe('Book your closing today'); expect(r.result.estimated_credits).toBe(0); expect(r.result.video_url).not.toBe(earlier.result.video_url);
    expect(r.storyboard.scenes.filter((s: any) => s.kind === 'clip').map((s: any) => s.clip_video_id)).toEqual(earlier.storyboard.scenes.filter((s: any) => s.kind === 'clip').map((s: any) => s.clip_video_id)); // the same saved clips
    expect(r.result.caption).toBe(earlier.result.caption); // the caption is kept
  }, 120_000);

  it('a new ending with no words given: Pilot writes new ones', async () => {
    const r = await iterate('change the ending');
    expect(calls.endText).toBe(1); expect(r.storyboard.scenes[3].on_screen_text).toBe('Call (519) 982-4901 today'); expect(started).toHaveLength(0);
  }, 120_000);

  it('“make it darker”: the saved clips are re-joined with a darker grade, free', async () => {
    const brighter = { ...earlier, brief: { ...earlier.brief, style: ['bright', 'calm'] } };
    const r = await iterate('make it darker', { earlierOverride: brighter });
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(0); expect(stitchCalls[0].options).toEqual({ grade: -0.1, gradedIndexes: [0, 1, 2] }); expect(r.storyboard.grade).toBe(-0.1);
  }, 120_000);

  it('“make the product shot longer”: only the main shot is made again, 2 seconds longer; the other scenes are reused', async () => {
    const r = await iterate('make the product shot longer');
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(1); expect(started[0].seconds).toBe(earlier.storyboard.scenes[1].seconds + 2);
    expect(started[0].prompt).toContain('Style: dark, cinematic.'); expect(fetched).toBe(1); // one new clip downloaded; the other two were read from storage
    expect(r.storyboard.scenes[1].seconds).toBe(earlier.storyboard.scenes[1].seconds + 2); expect(r.storyboard.scenes[1].clip_video_id).not.toBe(earlier.storyboard.scenes[1].clip_video_id);
    expect(r.storyboard.scenes[0].clip_video_id).toBe(earlier.storyboard.scenes[0].clip_video_id); expect(r.storyboard.scenes[2].clip_video_id).toBe(earlier.storyboard.scenes[2].clip_video_id);
    expect(r.storyboard.scenes[1].description).toBe(earlier.storyboard.scenes[1].description); // a length change keeps what the scene shows
    expect(r.result.estimated_credits).toBe(50); expect(r.storyboard.total_seconds).toBe(earlier.storyboard.total_seconds + 2);
    expect(r.result.video_url).not.toBe(earlier.result.video_url);
  }, 120_000);

  it('asking for a different main shot rewrites that scene, and only that one', async () => {
    const r = await iterate('show the pool with the cover pulled back in the main shot');
    expect(started).toHaveLength(1); expect(calls.revised).toBe(1); expect(r.storyboard.scenes[1].description).toBe('The main shot again, with the cover pulled back to show clear water.');
    expect(started[0].prompt).toContain('The main shot again, with the cover pulled back');
  }, 120_000);

  it('a change to the look (“more fun”) makes the whole video again: every scene, with the new style', async () => {
    const r = await iterate('make it more fun');
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(3); expect(started.every((s) => s.prompt.includes('fun'))).toBe(true); expect(r.result.estimated_credits).toBe(150);
    expect(r.storyboard.scenes.filter((s: any) => s.kind === 'clip').every((s: any) => s.clip_video_id !== earlier.storyboard.scenes[0].clip_video_id)).toBe(true);
  }, 120_000);

  it('makes the whole video again when an earlier clip was not kept and the change needs it', async () => {
    const lost = { ...earlier, storyboard: { ...earlier.storyboard, scenes: earlier.storyboard.scenes.map((s: any, i: number) => (i === 0 ? { ...s, clip_video_id: null } : s)) } };
    const r = await iterate('change the ending', { earlierOverride: lost });
    expect(r.outcome).toBe('ready'); expect(started).toHaveLength(3); // full: the plan cannot reuse the missing clip
  }, 120_000);

  it('marks the change failed with a plain reason, and leaves the Library draft and the earlier video alone', async () => {
    const r = await iterate('make the product shot longer', { deps: { checkClip: async () => ({ status: 'failed', message: 'The scene was rejected.' }) } });
    expect(r.outcome).toBe('failed'); expect(r.status).toBe('failed'); expect(r.result).toMatchObject({ video_url: null, error: 'The scene was rejected. About 100 Runway credits may have been used before it stopped.' }); // the scene was tried twice, at 50 each
    expect(mocks.saveContent).not.toHaveBeenCalled(); expect(await storage.openVideo(TENANT, earlier.result.video_url.split('/').pop().replace('.mp4', ''))).not.toBeNull();
  }, 120_000);

  it('adds a new Library draft if the earlier one was deleted', async () => {
    mocks.getContent.mockResolvedValue(null);
    const r = await iterate('make the caption punchier');
    expect(r.outcome).toBe('ready'); expect(mocks.createContent).toHaveBeenCalledTimes(1); expect(r.result.library_item_id).toBe('lib-new-01');
  }, 120_000);

  it('starts a change only for a confirmed job that has its selection (the same guards as the first video)', async () => {
    const job = { id: 'job-iter-guard', status: 'brief_ready', userMessage: 'x', brief: earlier.brief, selection: none } as any;
    expect((await startVideoGeneration({ tenant, job, deps: deps() })).started).toBe(false);
  });
});
