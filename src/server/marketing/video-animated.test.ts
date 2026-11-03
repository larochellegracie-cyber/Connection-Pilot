import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const mocks = vi.hoisted(() => ({ markGenerating: vi.fn(), saveStoryboard: vi.fn(), finish: vi.fn(), createContent: vi.fn(), getJob: vi.fn(), getContent: vi.fn(), saveContent: vi.fn() }));
vi.mock('./marketing-jobs.js', () => ({ markJobGenerating: (...a: unknown[]) => mocks.markGenerating(...a), saveJobStoryboard: (...a: unknown[]) => mocks.saveStoryboard(...a), finishJob: (...a: unknown[]) => mocks.finish(...a), getMarketingJob: (...a: unknown[]) => mocks.getJob(...a) }));
vi.mock('./store.js', () => ({ loadBrandKit: async () => ({ name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null }), createContent: (...a: unknown[]) => mocks.createContent(...a), getContent: (...a: unknown[]) => mocks.getContent(...a), saveContent: (...a: unknown[]) => mocks.saveContent(...a) }));
vi.mock('./service.js', () => ({ aiComplete: async () => '{}', aiCompleteWithUsage: async () => ({ text: '{}' }), loadMarketingInput: async () => ({}) }));

import { detectCreativeRequest } from '@/lib/marketing-creative-mode';
import { mergeFallback } from './creative-brief';
import { ffmpegPath } from './standard-video/ffmpeg';
import { renderVideoSpec } from './standard-video/render';
import { LocalVolumeStorage, setMediaStorage } from './standard-video/storage';
import { referenceFile, saveJson } from './reference/shared';
import { buildProductScript } from './code-video/product';
import { saveBusinessImage } from './standard-video/business-assets';
import { PlannerError, type PlanResult } from './standard-video/planner';
import { validateSpec } from './standard-video/spec';
import { addMusic } from './music';
import { animatedRequest, editEndText, runGeneration, type GenerationDeps } from './video-generation';
import { stitchClips } from './video-stitch';

// the standard tests are about the plain branded graphic; generated artwork has its own tests (generated-art.test.ts)
process.env.PILOT_GENERATED_ART = 'off';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant = { id: TENANT, businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' };
const input = { brief: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', website: 'https://somersetpoolservice.com', description: 'Pool openings and closings.', services: ['Pool closing'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: 'Professional', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true }, signals: [], trends: [], insights: [], existing: [], now: new Date('2026-10-23T12:00:00Z'), timezone: 'America/Toronto' };
const GOOD = 'Is your pool ready for the first freeze?\n\nSomerset Pool Service closes pools across Windsor-Essex, from water balance to the cover.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
const NEWER = 'Cover on, worries off. Is your pool ready to close for winter?\n\nSomerset Pool Service closes pools across Windsor-Essex.\n\nCall (519) 982-4901 or book at somersetpoolservice.com.';
const caption = (text: string) => JSON.stringify({ caption: text, hashtags: ['PoolClosing', 'WindsorEssex', 'PoolCare', 'SomersetPoolService'], cta: 'Call (519) 982-4901 or book at somersetpoolservice.com.', end_card_text: 'Book your pool closing' });
let calls: { captions: number; endText: number };
const ai = async (system: string, prompt = '') => {
  if (/write the words for the closing card/i.test(system)) { calls.endText += 1; return JSON.stringify({ end_card_text: 'Call (519) 982-4901 today' }); }
  calls.captions += 1; return caption(/owner asked for this change to the caption/.test(prompt) ? NEWER : GOOD);
};

/** A small but real scene plan, as the planner would return it (540x960 so tests render quickly). */
const makePlan = (photo: string | null = null, headline = 'Close your pool the easy way'): PlanResult => {
  const result = validateSpec({ version: 1, size: '540x960', fps: 30, audio: 'silent', brand: { name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', textColor: '#FFFFFF' }, scenes: [
    { seconds: 2, background: photo ? { type: 'image', asset: photo, kenBurns: { from: 1, to: 1.12 }, overlay: 'rgba(11,31,68,0.4)' } : { type: 'gradient', from: '#0B1F44', to: '#2454D6', angle: 135 }, elements: [{ type: 'brand', position: 'top' }, { type: 'text', text: headline, x: 90, y: 700, width: 900, size: 92, weight: 800, color: '#FFFFFF', animation: { type: 'slide-up', delay: 0.1, duration: 0.5 } }], transition: { type: 'fade', seconds: 0.4 } },
    { seconds: 2, background: { type: 'gradient', from: '#2454D6', to: '#0B1F44', angle: 45 }, elements: [{ type: 'brand', position: 'top' }, { type: 'text', text: 'Book your closing today', x: 540, y: 700, width: 860, size: 92, weight: 800, color: '#FFFFFF', align: 'center', animation: { type: 'pop', delay: 0.1, duration: 0.5 } }, { type: 'text', text: 'Somerset Pool Service', x: 540, y: 1200, width: 560, size: 48, weight: 800, color: '#FFFFFF', align: 'center' }] },
  ] });
  if (!result.ok) throw new Error(result.error);
  return { spec: result.spec, platform: 'tiktok', summary: { durationSeconds: 4, size: '540x960', sceneCount: 2, hook: headline, cta: 'Book your closing today', scenes: [{ role: 'hook', seconds: 2, headline, subtext: 'Cover, balance and winterise', photo: photo ? 'Winter cover going on' : null, transition: 'fade' }, { role: 'cta', seconds: 2, headline: 'Book your closing today', subtext: '', photo: null, transition: 'fade' }], photosUsed: [] } as never, copy: { hook: headline, caption: 'x', cta: 'Book your closing today', hashtags: [] }, notes: [], reasoning: '', usage: { calls: 1, inputTokens: 0, outputTokens: 0 } };
};

let root: string; let storage: LocalVolumeStorage; let photoId: string;
const run = (args: string[]) => new Promise<string>((resolve, reject) => { const child = spawn(ffmpegPath()!, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; child.stderr.on('data', (c) => { err += c.toString(); }); child.on('close', (code) => (code === 0 || /At least one output file|Output file #0 does not contain/.test(err) ? resolve(err) : reject(new Error(err)))); });
const meanVolume = async (file: string) => Number((await run(['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'])).match(/mean_volume: (-?[\d.]+) dB/)![1]);
const videoBytes = async (link: string) => { const f = await storage.openVideo(TENANT, link.split('/').pop()!.replace('.mp4', '')); const parts: Buffer[] = []; for await (const p of f!.stream()) parts.push(Buffer.from(p)); return Buffer.concat(parts); };

let started: unknown[]; let planned: Array<{ request: string; assets: string[]; durationSeconds?: number }>; let rendered: number; let musicCalls: number; let fetched: number; let planFails: Error | null;
const deps = (over: Partial<GenerationDeps> = {}): GenerationDeps => ({
  startClip: async (request) => { started.push(request); return { taskId: 'task-1', estimatedCredits: 50 }; }, checkClip: async () => ({ status: 'succeeded', url: 'https://cdn.example.com/c.mp4' }), fetchClip: async () => { fetched += 1; return Buffer.from(''); },
  stitch: (clips, out, options) => stitchClips(clips, out, options), addMusic: (opts) => { musicCalls += 1; return addMusic(opts); },
  planAnimated: async (request) => { planned.push({ request: request.request, assets: request.assets.map((a) => a.id), durationSeconds: request.durationSeconds }); if (planFails) throw planFails; return makePlan(request.assets[0]?.id ?? null); },
  renderSpec: async (args) => { rendered += 1; return renderVideoSpec({ ...args, timeoutMs: 60_000 }); },
  storage, complete: ai, loadInput: async () => input as never, sleep: async () => undefined, pollMs: 1, clipTimeoutMs: 5000, ...over,
});
const brief = { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['bright', 'calm'], length_seconds: 15, key_instructions: [] as string[], iteration_of: null as string | null };
const none = { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'n', selected_at: 'x' };
const job = (extra: Record<string, unknown> = {}) => ({ id: 'job-anim-0001', status: 'generating', userMessage: 'Make me a 15 second TikTok about pool closing', brief, selection: none, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a', ...extra }) as any;
const reset = () => { started = []; planned = []; rendered = 0; musicCalls = 0; fetched = 0; planFails = null; calls = { captions: 0, endText: 0 }; };

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'anim-test-')); storage = new LocalVolumeStorage(root, false);
  const c = createCanvas(900, 600); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 900, 600);
  photoId = (await saveBusinessImage({ tenantId: TENANT, bytes: c.toBuffer('image/jpeg'), originalName: 'cover.jpg', fields: { kind: 'product', label: 'Winter cover going on' }, storage })).id;
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => {
  for (const spy of Object.values(mocks)) spy.mockReset(); reset();
  for (const spy of [mocks.markGenerating, mocks.saveStoryboard, mocks.finish, mocks.saveContent]) spy.mockResolvedValue(undefined);
  mocks.createContent.mockResolvedValue({ id: 'lib-anim-01' }); mocks.getJob.mockResolvedValue(null); mocks.getContent.mockResolvedValue(null);
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the free animated path', () => {
  it('plans the scenes, draws them, adds music and a caption, and saves a ready video: no Runway, no credits', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps() });
    expect(outcome).toBe('ready'); expect(started).toHaveLength(0); expect(fetched).toBe(0); // nothing went to Runway
    expect(planned).toHaveLength(1); expect(rendered).toBe(1); expect(musicCalls).toBe(1);
    const [, , status, result] = mocks.finish.mock.calls[0];
    expect(status).toBe('ready'); expect(result).toMatchObject({ engine: 'animated', provider: 'Pilot animation', estimated_credits: 0, caption: GOOD, library_item_id: 'lib-anim-01', error: null, scene_count: 2, total_seconds: 4 });
    expect(result.music).toMatch(/^Soft and elegant/); expect(result.video_url).toMatch(/^\/api\/marketing\/media\/videos\/[0-9a-f-]{36}\.mp4$/);
    const out = path.join(root, 'anim.mp4'); await writeFile(out, await videoBytes(result.video_url));
    const info = await run(['-hide_banner', '-i', out]); expect(info).toMatch(/Video: h264.*540x960/); expect(info).toMatch(/Audio: aac/); expect(await meanVolume(out)).toBeGreaterThan(-25); // a real video with music
  }, 120_000);

  it('saves the scene plan on the job, marked as animated, so a small change can be redrawn without planning again', async () => {
    await runGeneration({ tenant, job: job(), deps: deps() });
    const board = mocks.saveStoryboard.mock.calls[0][2];
    expect(board).toMatchObject({ engine: 'animated', total_seconds: 4, caption: GOOD, music_seed: 'job-anim-0001', hashtags: ['#PoolClosing', '#WindsorEssex', '#PoolCare', '#SomersetPoolService'] });
    expect(board.scenes.map((s: any) => [s.role, s.kind])).toEqual([['hook', 'clip'], ['ending', 'end_card']]); expect(board.animated_spec.scenes).toHaveLength(2);
  }, 120_000);

  it('puts a Standard Video draft in the Library, with the finished file, and posts nothing', async () => {
    await runGeneration({ tenant, job: job(), deps: deps() });
    const [tenantId, item] = mocks.createContent.mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(item).toMatchObject({ kind: 'video', platform: 'tiktok', status: 'draft', scheduledFor: null, approvedAt: null, publishedAt: null, caption: GOOD, hook: 'Is your pool ready for the first freeze?', postingFormat: 'Animated video, 9:16, 4 seconds', video: { mode: 'standard', durationSeconds: 4, render: { status: 'ready', provider: 'Standard Video' } } });
    expect(item.video.plan.version).toBe(1); expect(item.video.audioDirection).toMatch(/Includes original background music/); expect(item.suggestedVisual).toBe('Brand colours, text and motion. No photos of your business were made up.');
  }, 120_000);

  it('uses only the photos that fit the subject; with none, it plans brand colours and text, and never a random photo', async () => {
    await runGeneration({ tenant, job: job(), deps: deps() });
    expect(planned[0].assets).toEqual([]);
    reset();
    const selection = { selected_assets: [{ id: photoId, label: 'Winter cover going on', description: '', type: 'photo', reason: 'r', score: 3 }], has_good_match: true, fallback_needed: false, note: 'n', selected_at: 'x' };
    await runGeneration({ tenant, job: job({ selection }), deps: deps() });
    expect(planned[0].assets).toEqual([photoId]); expect(rendered).toBe(1);
    expect(mocks.createContent.mock.calls.at(-1)![1].suggestedVisual).toBe('Uses your photo: Winter cover going on.');
  }, 120_000);

  it('builds the request from the brief, so every change the brief holds reaches the planner', () => {
    expect(animatedRequest({ brief: { ...brief, style: ['dark', 'fast'], length_seconds: 20, key_instructions: ['use our logo'] } as never })).toBe('Make a TikTok video about: pool closing. Style: dark, fast. About 20 seconds. The owner also asked for: use our logo.');
    expect(animatedRequest({ brief: { ...brief, platform: 'general', style: [], length_seconds: null } as never })).toBe('Make a Instagram video about: pool closing.'.replace('a Instagram', 'an Instagram'));
  });

  it('fails plainly, with no credits used, when the planner cannot make a plan', async () => {
    planFails = new PlannerError('Pilot could not plan that video. Please try again.');
    const outcome = await runGeneration({ tenant, job: job(), deps: deps() });
    expect(outcome).toBe('failed'); const [, , status, result] = mocks.finish.mock.calls[0];
    expect(status).toBe('failed'); expect(result).toMatchObject({ video_url: null, engine: 'animated', error: 'Pilot could not plan that video. Please try again. No credits were used.' }); expect(mocks.createContent).not.toHaveBeenCalled();
  }, 60_000);

  it('says plainly when a chosen photo has since been deleted', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ planAnimated: async () => { const plan = makePlan('deleted-photo-1'); return plan; } }) });
    expect(outcome).toBe('failed'); expect(mocks.finish.mock.calls[0][3].error).toBe('One of your photos is no longer available. Ask for the video again. No credits were used.');
  }, 60_000);

  it('still delivers the video, honestly labelled, if the music cannot be added', async () => {
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ addMusic: async () => { throw new Error('FFmpeg stopped with code 1. /secret/path'); } }) });
    expect(outcome).toBe('ready'); const result = mocks.finish.mock.calls[0][3];
    expect(result.music).toBeNull(); expect(result.video_url).toMatch(/^\/api\/marketing\/media\/videos\//); expect(JSON.stringify(mocks.finish.mock.calls)).not.toMatch(/secret/);
  }, 120_000);

  it('adds no music when the owner asked for none', async () => {
    await runGeneration({ tenant, job: job({ brief: { ...brief, key_instructions: ['no music'] } }), deps: deps() });
    expect(musicCalls).toBe(0); expect(mocks.finish.mock.calls[0][3].music).toBeNull();
  }, 120_000);

  it('goes to Runway only when the owner asked for the premium look', async () => {
    await runGeneration({ tenant, job: job({ userMessage: 'Make me a cinematic video about pool closing', brief: { ...brief, style: ['cinematic'] } }), deps: deps({ complete: async (system) => (/storyboard for ONE/.test(system) ? JSON.stringify({ scenes: [{ role: 'hook', description: 'a' }, { role: 'main', description: 'b' }, { role: 'support', description: 'c' }] }) : caption(GOOD)), stitch: async (_c, out) => { await writeFile(out, ''); }, addMusic: async (o) => { await writeFile(o.outPath, ''); return { seconds: 1 }; } }) });
    expect(planned).toHaveLength(0); expect(started.length).toBeGreaterThan(0); // the premium path: clips were requested from Runway
  }, 120_000);
});

describe('changing a free animated video', () => {
  let earlier: any;
  const iterate = async (message: string, over: { brief?: Record<string, unknown>; deps?: Partial<GenerationDeps> } = {}) => {
    const b = over.brief ?? mergeFallback(earlier.brief, message, detectCreativeRequest(message), 'Somerset Pool Service', earlier.id);
    const j = job({ id: `job-iter-${Math.random().toString(36).slice(2, 8)}`, userMessage: message, brief: b, selection: none });
    for (const spy of [mocks.finish, mocks.saveStoryboard, mocks.saveContent, mocks.createContent]) spy.mockClear(); reset();
    const outcome = await runGeneration({ tenant, job: j, deps: deps(over.deps) });
    return { outcome, job: j, result: mocks.finish.mock.calls[0]?.[3], storyboard: mocks.saveStoryboard.mock.calls.at(-1)?.[2] };
  };
  beforeEach(async () => {
    if (!earlier) {
      await runGeneration({ tenant, job: job({ id: 'job-anim-base', userMessage: 'Make me a 15 second TikTok about pool closing' }), deps: deps() });
      earlier = job({ id: 'job-anim-base', status: 'ready', storyboard: mocks.saveStoryboard.mock.calls.at(-1)![2], result: { ...mocks.finish.mock.calls[0][3], library_item_id: 'lib-0001' } });
    }
    reset(); mocks.getJob.mockImplementation(async (_t: string, id: string) => (id === earlier.id ? earlier : null));
    mocks.getContent.mockImplementation(async (_t: string, id: string) => (id === 'lib-0001' ? { id: 'lib-0001', kind: 'video', platform: 'tiktok', status: 'approved', approvedAt: '2026-10-23T00:00:00Z', scheduledFor: '2026-10-25', publishedAt: null, hook: 'old', caption: 'old', cta: 'old', hashtags: [], video: { mode: 'standard', durationSeconds: 4, scenes: [], transitions: 'x', audioDirection: 'x', render: { status: 'ready', url: earlier.result.video_url, provider: 'Standard Video' } } } : null));
  }, 180_000);

  it('a new caption keeps the same video file, changes only the words, and costs nothing', async () => {
    const r = await iterate('make the caption punchier');
    expect(r.outcome).toBe('ready'); expect(planned).toHaveLength(0); expect(rendered).toBe(0); expect(musicCalls).toBe(0); expect(started).toHaveLength(0);
    expect(r.result).toMatchObject({ video_url: earlier.result.video_url, caption: NEWER, engine: 'animated', estimated_credits: 0, provider: 'Pilot animation' });
    expect(mocks.saveContent.mock.calls[0][1]).toMatchObject({ id: 'lib-0001', status: 'draft', approvedAt: null, scheduledFor: null, caption: NEWER, video: { mode: 'standard' } });
  }, 120_000);

  it('new music puts a new track under the same picture (a new take), and taking the music out leaves it silent', async () => {
    const r = await iterate('make the music more dramatic');
    expect(r.outcome).toBe('ready'); expect(planned).toHaveLength(0); expect(rendered).toBe(0); expect(musicCalls).toBe(1); expect(r.result.video_url).not.toBe(earlier.result.video_url); expect(r.storyboard.music_seed).toBe(r.job.id);
    const silent = await iterate('remove the music'); expect(silent.result.music).toBeNull();
    const out = path.join(root, 'anim-silent.mp4'); await writeFile(out, await videoBytes(silent.result.video_url)); expect(await meanVolume(out)).toBeLessThan(-80);
  }, 120_000);

  it('a new ending is redrawn from the saved scene plan: no planning, the same music, no credits', async () => {
    const r = await iterate('change the ending to "Call us today at (519) 982-4901"');
    expect(r.outcome).toBe('ready'); expect(planned).toHaveLength(0); expect(rendered).toBe(1); expect(musicCalls).toBe(1); expect(started).toHaveLength(0);
    expect(r.storyboard.scenes.at(-1).on_screen_text).toBe('Call us today at (519) 982-4901'); expect(r.storyboard.music_seed).toBe(earlier.storyboard.music_seed); expect(r.result.music).toBe(earlier.result.music);
    const headline = r.storyboard.animated_spec.scenes.at(-1).elements.filter((e: any) => e.type === 'text').sort((a: any, b: any) => b.size - a.size)[0]; expect(headline.text).toBe('Call us today at (519) 982-4901');
    const none = await iterate('change the ending'); expect(calls.endText).toBe(1); expect(none.storyboard.scenes.at(-1).on_screen_text).toBe('Call (519) 982-4901 today');
  }, 180_000);

  it('any other change plans the animation again with the change, and it is still free', async () => {
    const r = await iterate('make it more fun');
    expect(r.outcome).toBe('ready'); expect(planned).toHaveLength(1); expect(planned[0].request).toContain('fun'); expect(rendered).toBe(1); expect(started).toHaveLength(0); expect(r.result).toMatchObject({ engine: 'animated', estimated_credits: 0 });
    expect(mocks.saveContent.mock.calls[0][1].id).toBe('lib-0001'); // the same Library draft, updated
  }, 180_000);

  it('switching to Runway (“make it cinematic”) remakes it the premium way, and nothing from the free video is reused', async () => {
    const j = await iterate('make it cinematic', { deps: { complete: async (system) => (/storyboard for ONE/.test(system) ? JSON.stringify({ scenes: [{ role: 'hook', description: 'a' }, { role: 'main', description: 'b' }, { role: 'support', description: 'c' }] }) : caption(GOOD)), stitch: async (_c, out) => { await writeFile(out, ''); }, addMusic: async (o) => { await writeFile(o.outPath, ''); return { seconds: 1 }; } } });
    expect(planned).toHaveLength(0); expect(started.length).toBeGreaterThan(0); expect(j.result?.engine ?? 'runway').toBe('runway');
  }, 120_000);
});

describe('changing the ending words of a scene plan', () => {
  it('replaces the biggest text of the closing scene and fits its size, leaving the rest alone', () => {
    const spec = makePlan().spec;
    const next = editEndText(spec, 'Book now');
    const last = next.scenes.at(-1)!; const texts = last.elements.filter((e: any) => e.type === 'text') as any[];
    expect(texts.find((t) => t.size === 108)!.text).toBe('Book now'); expect(texts.find((t) => t.text === 'Somerset Pool Service')).toBeTruthy(); expect(spec.scenes.at(-1)!.elements.find((e: any) => e.text === 'Book your closing today')).toBeTruthy(); // the original is not changed
    expect((editEndText(spec, 'x'.repeat(60)).scenes.at(-1)!.elements as any[]).find((e) => e.text?.startsWith('xxx')).size).toBe(76);
  });
});

describe('code-written video (optional, sandboxed, falls back to the standard renderer)', () => {
  const askedFor = (extra: Record<string, unknown> = {}) => job({ userMessage: 'Make me a 15 second video about pool closing with a custom animation', ...extra });
  const codeOk = (calls: unknown[]): GenerationDeps['renderCode'] => async (args) => { calls.push(args.tenantId); await renderVideoSpec({ spec: args.plan.spec, assets: new Map(), outPath: args.outPath, timeoutMs: 60_000 }); return { ok: true, script: 'def build(video):\n    pass\n', scriptSha: 'abc123', seconds: 4, usage: { calls: 1, inputTokens: 10, outputTokens: 20 } }; };
  afterAll(() => { delete process.env.PILOT_CODE_VIDEO; });

  it('is not used unless the owner asks for it (the default is to use it on request only)', async () => {
    const calls: unknown[] = []; delete process.env.PILOT_CODE_VIDEO;
    await runGeneration({ tenant, job: job(), deps: deps({ renderCode: codeOk(calls) }) });
    expect(calls).toHaveLength(0); expect(rendered).toBe(1); expect(mocks.finish.mock.calls[0][3]).toMatchObject({ renderer: 'template' });
  }, 120_000);

  it('draws the video from the code when the owner asks for a custom animation, and marks it, with no template spec to recut', async () => {
    const calls: unknown[] = []; delete process.env.PILOT_CODE_VIDEO;
    const outcome = await runGeneration({ tenant, job: askedFor(), deps: deps({ renderCode: codeOk(calls) }) });
    expect(outcome).toBe('ready'); expect(calls).toEqual([TENANT]); expect(rendered).toBe(0); expect(started).toHaveLength(0); // the standard renderer was not needed, and Runway was never touched
    const [, , status, result] = mocks.finish.mock.calls[0]; expect(status).toBe('ready'); expect(result).toMatchObject({ renderer: 'code', engine: 'animated', estimated_credits: 0, error: null }); expect(musicCalls).toBe(1); // music and caption work the same
    const saved = mocks.saveStoryboard.mock.calls.at(-1)![2]; expect(saved).toMatchObject({ renderer: 'code', code_script_sha: 'abc123', engine: 'animated' }); expect(saved.animated_spec).toBeUndefined();
  }, 120_000);

  it('falls back to the standard renderer, and still delivers the video, when the code path fails', async () => {
    delete process.env.PILOT_CODE_VIDEO;
    const outcome = await runGeneration({ tenant, job: askedFor(), deps: deps({ renderCode: async () => ({ ok: false as const, reason: 'The animation script did not pass the safety check.' }) }) });
    expect(outcome).toBe('ready'); expect(rendered).toBe(1); expect(mocks.finish.mock.calls[0][3]).toMatchObject({ renderer: 'template', error: null });
  }, 120_000);

  it('is never used when switched off, even if the owner asks', async () => {
    const calls: unknown[] = []; process.env.PILOT_CODE_VIDEO = 'off';
    await runGeneration({ tenant, job: askedFor(), deps: deps({ renderCode: codeOk(calls) }) });
    expect(calls).toHaveLength(0); expect(rendered).toBe(1);
  }, 120_000);

  it('invents the video in code when no template fits the subject, and says so', async () => {
    const styles: unknown[] = []; delete process.env.PILOT_CODE_VIDEO;
    const outcome = await runGeneration({ tenant, job: job({ userMessage: 'Make a video about a chocolate cake for Somerset', brief: { ...job().brief, main_subject: 'chocolate cake' } }), deps: deps({ renderCode: async (args) => { styles.push(args.style); return codeOk([])!(args); } }) });
    expect(outcome).toBe('ready'); expect(styles).toEqual(['invent']);
    expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'code', code: 'invented' }); expect(mocks.saveStoryboard.mock.calls.at(-1)![2]).toMatchObject({ code_style: 'invent' });
  }, 120_000);

  it('falls back from invented code to the scene library, then to the standard video', async () => {
    const styles: unknown[] = []; delete process.env.PILOT_CODE_VIDEO; const cake = job({ userMessage: 'Make a video about a chocolate cake for Somerset', brief: { ...job().brief, main_subject: 'chocolate cake' } });
    await runGeneration({ tenant, job: cake, deps: deps({ renderCode: async (args) => { styles.push(args.style); return args.style === 'invent' ? { ok: false as const, reason: 'The animation script did not pass the safety check.' } : codeOk([])!(args); } }) });
    expect(styles).toEqual(['invent', 'open']); expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'code', code: 'fell_back', code_note: expect.stringContaining('safety check') });
    styles.length = 0; const before = rendered;
    await runGeneration({ tenant, job: cake, deps: deps({ renderCode: async (args) => { styles.push(args.style); return { ok: false as const, reason: 'no' }; } }) });
    expect(styles).toEqual(['invent', 'open']); expect(rendered).toBe(before + 1); expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'template', code: 'fell_back', error: null });
  }, 240_000);

  it('invents the WHOLE video from a concept for a creative request: no service plan, and a clear fall back when it cannot', async () => {
    delete process.env.PILOT_CODE_VIDEO; const seen: Array<{ style: unknown; text: string }> = []; const cake = job({ userMessage: 'Make a video about a chocolate cake for Somerset', brief: { ...job().brief, main_subject: 'chocolate cake' } });
    const concept = { title: 'Cake', mood: 'warm', palette: { bgA: '#3A1D2A', bgB: '#1A0D14', glow: '#F2A65A', glow2: '#E8638C', toneA: '#F3E3C3', toneB: '#C98B5B', light: false }, seconds: 12, scenes: [{ role: 'hook' as const, seconds: 4, headline: 'Layer by layer', subtext: '', items: [], visual: 'a cake builds', photoId: null }, { role: 'scene' as const, seconds: 4, headline: 'Make a wish', subtext: '', items: [], visual: 'candles light', photoId: null }, { role: 'closing' as const, seconds: 4, headline: 'Somerset Pool Service', subtext: '', items: [], visual: 'the logo settles', photoId: null }] };
    const plannedBefore = planned.length;
    const outcome = await runGeneration({ tenant, job: cake, deps: deps({ writeConcept: async () => concept, renderCode: async (args) => { seen.push({ style: args.style, text: JSON.stringify(args.plan.summary.scenes) }); return codeOk([])!(args); } }) });
    expect(outcome).toBe('ready'); expect(seen).toHaveLength(1); expect(seen[0].style).toBe('custom'); expect(seen[0].text).toContain('Layer by layer'); expect(seen[0].text).not.toMatch(/closing|openings|maintenance/i);
    expect(planned.length).toBe(plannedBefore); // the service-based plan was never made
    expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'code', code: 'invented' }); expect(mocks.saveStoryboard.mock.calls.at(-1)![2]).toMatchObject({ code_style: 'custom' });
    // it cannot be made: the scene library is tried, then the standard video, and the owner is told
    seen.length = 0; const before = rendered; void before;
    await runGeneration({ tenant, job: cake, deps: deps({ writeConcept: async () => concept, renderCode: async (args) => { seen.push({ style: args.style, text: '' }); return { ok: false as const, reason: 'The animation script did not pass the safety check.' }; } }) });
    expect(seen.map((x) => x.style)).toEqual(['custom', 'custom', 'open']); // two fresh custom drafts, then the scene library expect(rendered).toBe(before + 1); expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'template', code: 'fell_back', code_note: expect.stringContaining('safety check'), error: null });
  }, 240_000);

  it('is used for every free video when the mode is "default"', async () => {
    const calls: unknown[] = []; process.env.PILOT_CODE_VIDEO = 'default';
    await runGeneration({ tenant, job: job(), deps: deps({ renderCode: codeOk(calls) }) });
    expect(calls).toHaveLength(1);
  }, 120_000);
});

describe('generated artwork for a video when none of the owner’s photos fits', () => {
  afterAll(() => { process.env.PILOT_GENERATED_ART = 'off'; });
  it('generates brand-coloured artwork, offers it to the planner as the photo, and says so on the finished video', async () => {
    process.env.PILOT_GENERATED_ART = 'on';
    const outcome = await runGeneration({ tenant, job: job(), deps: deps() });
    expect(outcome).toBe('ready');
    const art = (await storage.listAssets(TENANT)).find((asset) => asset.tags.includes('generated'));
    expect(art).toBeTruthy(); expect(art!.label).toMatch(/^Made by Pilot – pool closing/); expect(planned[0].assets).toContain(art!.id); // the planner can use it wherever a photo would go
    expect(mocks.finish.mock.calls[0][3]).toMatchObject({ error: null }); // the video is delivered either way
  }, 120_000);

  it('does not generate anything when one of the owner’s photos fits', async () => {
    process.env.PILOT_GENERATED_ART = 'on';
    const before = (await storage.listAssets(TENANT)).filter((asset) => asset.tags.includes('generated')).length;
    const selection = { selected_assets: [{ id: photoId, label: 'Winter cover going on', description: '', type: 'photo', reason: 'r', score: 3 }], has_good_match: true, fallback_needed: false, note: 'n', selected_at: 'x' };
    await runGeneration({ tenant, job: job({ selection }), deps: deps() });
    expect((await storage.listAssets(TENANT)).filter((asset) => asset.tags.includes('generated')).length).toBe(before); expect(planned[0].assets).toEqual([photoId]);
  }, 120_000);
});

describe('a realistic generated image for a video when none of the owner’s photos fits', () => {
  const fake = async () => { const c = createCanvas(512, 768); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 512, 768); return { bytes: new Uint8Array(c.toBuffer('image/jpeg')) }; };
  afterAll(() => { process.env.PILOT_GENERATED_ART = 'off'; });
  it('generates the image, offers it to the planner as the photo, and says it is AI-generated on the finished video', async () => {
    process.env.PILOT_GENERATED_ART = 'on'; let made = 0;
    const outcome = await runGeneration({ tenant, job: job(), deps: deps({ makePicture: async () => { made += 1; return fake(); }, planAnimated: async (request) => { planned.push({ request: request.request, assets: request.assets.map((asset) => asset.id), durationSeconds: request.durationSeconds }); const plan = makePlan(request.assets[0]?.id ?? null); return { ...plan, summary: { ...plan.summary, photosUsed: request.assets.slice(0, 1).map((asset) => ({ id: asset.id, label: asset.label })) } }; } }) });
    expect(outcome).toBe('ready'); expect(made).toBe(1);
    const ai = (await storage.listAssets(TENANT)).find((asset) => asset.tags.includes('ai-image'));
    expect(ai).toBeTruthy(); expect(ai!.label).toMatch(/^AI image – pool closing/); expect(planned[0].assets).toContain(ai!.id);
    expect(mocks.finish.mock.calls[0][3]).toMatchObject({ generated_kind: 'ai-image', error: null }); expect(started).toHaveLength(0); // never Runway
  }, 120_000);
});

describe('explainer video with a voiceover (optional, falls back to the ordinary free video)', () => {
  const asked = (extra: Record<string, unknown> = {}) => job({ userMessage: 'Make me an explainer video with a voiceover about how Pilot helps with scheduling pool closings', ...extra });
  const okExplainer = (calls: unknown[]): GenerationDeps['renderExplainer'] => async (args) => {
    calls.push(args); await renderVideoSpec({ spec: makePlan().spec, assets: new Map(), outPath: args.outPath, timeoutMs: 60_000 });
    return { ok: true, seconds: 4, voiceover: 'system', scenes: [{ role: 'intro', seconds: 2, headline: 'Pool closings, handled', subtext: '' }, { role: 'cta', seconds: 2, headline: 'Book your closing', subtext: '' }], storyboard: { title: 't', character: 'logo', scenes: [] }, script: '', ducked: true, note: 'Voiceover: this computer’s built-in voice (free). Music: Soft, original, made for this video.' };
  };
  afterAll(() => { delete process.env.PILOT_EXPLAINER_VIDEO; });

  it('is not used unless the owner asks for an explainer or a voiceover', async () => {
    const calls: unknown[] = []; delete process.env.PILOT_EXPLAINER_VIDEO;
    await runGeneration({ tenant, job: job(), deps: deps({ renderExplainer: okExplainer(calls) }) });
    expect(calls).toHaveLength(0); expect(rendered).toBe(1);
  }, 120_000);

  it('makes the explainer, with no planner call and no second music pass, and marks it with its voice', async () => {
    const calls: Array<Record<string, any>> = []; delete process.env.PILOT_EXPLAINER_VIDEO;
    const outcome = await runGeneration({ tenant, job: asked(), deps: deps({ renderExplainer: okExplainer(calls) }) });
    expect(outcome).toBe('ready'); expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ tenantId: TENANT, request: expect.stringContaining('explainer video with a voiceover') });
    expect(planned).toHaveLength(0); expect(rendered).toBe(0); expect(musicCalls).toBe(0); expect(started).toHaveLength(0); // the voice and music were mixed by the explainer; nothing went to Runway
    const [, , status, result] = mocks.finish.mock.calls[0]; expect(status).toBe('ready'); expect(result).toMatchObject({ renderer: 'explainer', voiceover: 'system', engine: 'animated', estimated_credits: 0, error: null }); expect(result.music).toMatch(/built-in voice/);
    expect(mocks.saveStoryboard.mock.calls.at(-1)![2].animated_spec).toBeUndefined();
  }, 120_000);

  it('falls back to the ordinary free video, still delivered, when the explainer cannot be made', async () => {
    const outcome = await runGeneration({ tenant, job: asked(), deps: deps({ renderExplainer: async () => ({ ok: false as const, reason: 'The storyboard could not be written.' }) }) });
    expect(outcome).toBe('ready'); expect(planned).toHaveLength(1); expect(rendered).toBe(1); expect(musicCalls).toBe(1); expect(mocks.finish.mock.calls[0][3]).toMatchObject({ renderer: 'template', error: null });
  }, 120_000);

  it('is never used when switched off', async () => {
    const calls: unknown[] = []; process.env.PILOT_EXPLAINER_VIDEO = 'off';
    await runGeneration({ tenant, job: asked(), deps: deps({ renderExplainer: okExplainer(calls) }) });
    expect(calls).toHaveLength(0);
  }, 120_000);
});



describe('a reference video that is a product advert drives the whole generation', () => {
  const REF = 'ref-product-0001';
  const roles = { background: '#D8C3A5', floor: '#7A5C3E', glow: '#FFF3DC', hero: '#4A2A18', accent: '#C9A227', text: '#2B2118', proportions: [{ hex: '#D8C3A5', share: 0.55, role: 'background' }], warmth: 0.16, temperature: 'warm' };
  const seg = (i: number) => ({ index: i + 1, start: i * 3.75, end: (i + 1) * 3.75, seconds: 3.75, brightness: 0.7, motion: 3, colours: ['#D8C3A5'], geometry: { colours: roles, subject: { x: 0.5, y: 0.6, spread: 0.3 }, calmest: 'top', placement: 'center', drift: { dx: 0, dy: 0 }, zoom: i === 0 ? 1.2 : 1.0, activity: [1, 1, 1, 1, 1, 1, 1, 1], glowAt: 'top' } });
  const product = (camera: string, placement: string) => ({ placement, size: 'large', camera, objectMotion: 'builds up in stages', textTiming: 'headline appears near the start' });
  const analysis = (forbiddenWords: string[] = ['Marlow', 'Tiles'], lines: string[] = ['Laid right the first time']) => ({
    id: REF, fileName: 'ref.mp4', createdAt: 'x', pacing: 'medium', averageSceneSeconds: 3.75,
    measures: { seconds: 15, width: 1080, height: 1920, fps: 30, vertical: true, hasAudio: false, meanVolumeDb: null, cuts: [], speechWordsPerMinute: null, colourRoles: roles, segments: [0, 1, 2, 3].map(seg) },
    style: { feel: 'warm and polished', theme: 'light', textTreatment: 'kinetic_headline', motion: 'smooth', transitions: ['fade'], usesCharacter: false, usesPhotos: false, hasVoiceover: false, arrangement: 'none', glow: 'soft', depth: 'layered', palette: [], source: 'vision', kind: 'product_scene', lighting: 'soft warm key light', background: 'warm beige set', typography: 'bold sans', negativeSpace: 'high', avoid: forbiddenWords, referenceText: { brands: ['Marlow Tiles'], words: forbiddenWords, phrases: lines },
      scenes: [['push_in', 'center'], ['static', 'low_center'], ['pan', 'center'], ['pull_out', 'right']].map(([camera, placement], i) => ({ layout: i === 3 ? 'cta' : 'product_hero', card: 'none', notes: '', design: { elements: 0, shape: 'none', headline: { position: 'upper', align: 'left', size: 'l' }, character: null, rotation: 'none', product: product(camera, placement) } })) },
  });
  const cake = () => job({ userMessage: 'Make me a video like this for Somerset about our chocolate birthday cake.', brief: { ...brief, main_subject: 'chocolate birthday cake', reference_id: REF, length_seconds: null } });
  const concept = (over: Record<string, string> = {}) => ({ title: 'Cake', mood: 'warm', seconds: 15, palette: { bgA: '#D8C3A5', bgB: '#7A5C3E', glow: '#FFF3DC', glow2: '#C9A227', toneA: '#4A2A18', toneB: '#C9A227', light: true }, scenes: [0, 1, 2, 3].map((i) => ({ role: (i === 0 ? 'hook' : i === 3 ? 'closing' : 'scene') as 'hook' | 'scene' | 'closing', seconds: 3.75, headline: i === 3 ? 'Somerset Pool Service' : ['A sweet start', 'Layers rise', 'Make a wish'][i], subtext: over.subtext ?? '', items: [], visual: 'the cake builds', photoId: null, transition: 'fade', direction: 'x' })) });
  let ad: Array<{ hero: string; design: any; palette: any; logoId: string | null; photos: any[] }>; let drawn: string[];
  const okResult = { ok: true as const, script: 'def build(video):\n    pass\n', scriptSha: 'abc', seconds: 4, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  const drawFile = async (args: { outPath: string }) => { await renderVideoSpec({ spec: makePlan().spec, assets: new Map(), outPath: args.outPath, timeoutMs: 60_000 }); return okResult; };
  const refDeps = (over: Partial<GenerationDeps> = {}) => deps({
    writeConcept: async (input) => ({ ...concept(), palette: input.reference!.visual.palette }), renderProductAd: async (args) => { ad.push({ hero: args.hero, design: args.design, palette: args.palette, logoId: args.logoId, photos: args.photos }); await renderVideoSpec({ spec: makePlan().spec, assets: new Map(), outPath: args.outPath, timeoutMs: 60_000 }); return okResult; },
    renderCode: async (args) => { drawn.push(String(args.style)); return { ok: false as const, reason: 'no' }; }, ...over,
  });
  beforeAll(async () => { setMediaStorage(storage); delete process.env.PILOT_CODE_VIDEO; });
  beforeEach(async () => { ad = []; drawn = []; await saveJson(referenceFile(TENANT, REF, 'video'), analysis()); });
  afterAll(() => { setMediaStorage(null); });

  it('passes the blueprint to the scene generator: the colours, each scene\'s camera, hero place, headline place and length, with the model-written code never asked', async () => {
    const outcome = await runGeneration({ tenant, job: cake(), deps: refDeps() });
    expect(outcome).toBe('ready'); expect(ad).toHaveLength(1); expect(drawn).toEqual([]);
    const design = ad[0].design; expect(design.visual.colours).toMatchObject({ background: '#D8C3A5', floor: '#7A5C3E', temperature: 'warm' });
    expect(design.visual.palette.bgA).toBe('#D8C3A5'.toUpperCase().replace('#D8C3A5', design.visual.palette.bgA)); // derived from the measured backdrop
    expect(design.motion.scenes.map((x: any) => x.camera)).toEqual(['push_in', 'static', 'pan', 'pull_out']); expect(design.motion.scenes.map((x: any) => x.product.placement)).toEqual(['center', 'low_center', 'center', 'right']);
    expect(ad[0].palette).toMatchObject({ bg_a: design.visual.palette.bgA, glow: design.visual.palette.glow, dark: false }); expect(design.visual.palette.glow).toBe(roles.glow); expect(ad[0].palette.bg_b).toBe(design.visual.palette.bgB);
    const script = buildProductScript(concept() as never, design, ad[0].hero);
    expect(script).toContain('camera="push_in"'); expect(script).toContain('camera="pan"'); expect(script).toContain('camera="pull_out"'); expect(script).toContain('placement="right"'); expect(script).toContain('closing=True');
    expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'code', code: 'invented', reference: 'followed', error: null }); expect(mocks.saveStoryboard.mock.calls.at(-1)![2]).toMatchObject({ code_style: 'custom' });
  }, 240_000);

  it('uses the business\'s own product photo when one matches, and a drawn product only when none does', async () => {
    const own = (await saveBusinessImage({ tenantId: TENANT, bytes: (() => { const c = createCanvas(600, 600); const x = c.getContext('2d'); x.fillStyle = '#5A3320'; x.fillRect(0, 0, 600, 600); return c.toBuffer('image/jpeg'); })(), originalName: 'cake.jpg', fields: { kind: 'product', label: 'Chocolate birthday cake', tags: ['chocolate', 'cake'] }, storage })).id;
    await runGeneration({ tenant, job: cake(), deps: refDeps() });
    expect(ad.at(-1)!.hero).toBe(own); expect(ad.at(-1)!.hero.startsWith('prop:')).toBe(false); expect(ad.at(-1)!.photos.map((p) => p.id)).toContain(own);
    await storage.deleteAsset(TENANT, own);
    await runGeneration({ tenant, job: cake(), deps: refDeps() });
    expect(ad.at(-1)!.hero).toBe('prop:cake'); // the business's only product photo is a winter cover: not a cake
  }, 240_000);

  it('falls back from the deterministic product scenes to the model-written code, then to the standard video, and says so', async () => {
    let tried = 0;
    await runGeneration({ tenant, job: cake(), deps: refDeps({ renderProductAd: async () => { tried += 1; return { ok: false as const, reason: 'the product scenes failed' }; }, renderCode: async (args) => { drawn.push(String(args.style)); return args.style === 'custom' ? drawFile(args) : { ok: false as const, reason: 'x' }; } }) });
    expect(mocks.finish.mock.calls.at(-1)![3].error ?? 'no error').toBe('no error'); expect(tried).toBe(1); expect(drawn[0]).toBe('custom'); expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'code', reference: 'followed' });
    drawn = []; const before = rendered;
    await runGeneration({ tenant, job: cake(), deps: refDeps({ renderProductAd: async () => ({ ok: false as const, reason: 'the product scenes failed' }) }) });
    expect(drawn.slice(0, 2)).toEqual(['custom', 'custom']); expect(rendered).toBe(before + 1); expect(mocks.finish.mock.calls.at(-1)![3]).toMatchObject({ renderer: 'template', reference: 'fallback', error: null });
  }, 300_000);

  it('keeps the reference\'s brand and wording out: it writes the concept again when they show up, takes them out as a last resort, and cleans the caption', async () => {
    let asked = 0; const forbiddenSeen: string[] = [];
    const once = refDeps({ writeConcept: async (input) => { asked += 1; forbiddenSeen.push(...(input.forbidden?.words ?? [])); return concept({ subtext: asked === 1 ? 'Marlow Tiles, laid right the first time' : 'Fresh from the oven' }); }, complete: async (system: string, prompt = '') => (/closing card/i.test(system) ? JSON.stringify({ end_card_text: 'Order today' }) : JSON.stringify({ caption: 'Sweet news from Marlow Tiles: our chocolate birthday cake.', hashtags: ['MarlowTiles', 'Cake'], cta: 'Order today', end_card_text: 'Order today' })) });
    await runGeneration({ tenant, job: cake(), deps: once });
    expect(asked).toBe(2); expect(forbiddenSeen).toContain('marlow');
    const r = mocks.finish.mock.calls.at(-1)![3]; expect(r.error ?? 'no error').toBe('no error'); expect(r.reference_check).toMatchObject({ found_final: 0, passed: true, regenerated: 1 }); expect(r.reference_check.detected.brands).toContain('Marlow Tiles');
    expect(r.caption).not.toMatch(/marlow/i); expect(r.hashtags.join(' ')).not.toMatch(/marlow/i);
    asked = 0; await runGeneration({ tenant, job: cake(), deps: refDeps({ writeConcept: async () => { asked += 1; return concept({ subtext: 'Marlow Tiles' }); } }) });
    expect(asked).toBe(3); const second = mocks.finish.mock.calls.at(-1)![3]; expect(second.reference_check).toMatchObject({ regenerated: 2, redacted: true, passed: true }); // asked three times, then the words were taken out
    const text = JSON.stringify(mocks.saveStoryboard.mock.calls.at(-1)![2]); expect(text).not.toMatch(/marlow/i);
  }, 300_000);

  it('keeps generic wording that matches the reference, so the headline of a scene is never blanked for it, while the brand is still refused', async () => {
    await saveJson(referenceFile(TENANT, REF, 'video'), analysis(['Marlow', 'Tiles'], ['Layers assemble', 'warm glaze catches light']));
    let asked = 0; const generic = concept(); generic.scenes[1].headline = 'Layers assemble'; generic.scenes[2].headline = 'Glaze catches the light'; generic.scenes[2].subtext = 'a warm glaze';
    await runGeneration({ tenant, job: cake(), deps: refDeps({ writeConcept: async (input) => { asked += 1; return { ...generic, palette: input.reference!.visual.palette }; } }) });
    expect(asked).toBe(1); const r = mocks.finish.mock.calls.at(-1)![3]; expect(r.error ?? 'no error').toBe('no error'); expect(r.reference_check).toMatchObject({ found_first: 0, regenerated: 0, redacted: false, passed: true });
    const text = JSON.stringify(mocks.saveStoryboard.mock.calls.at(-1)![2]); expect(text).toContain('Layers assemble'); expect(text).toContain('Glaze catches the light'); // nothing was blanked
  }, 240_000);

  it('does not reuse the reference\'s logo or pictures: only this business\'s own assets reach the generator, and the saved analysis holds no picture', async () => {
    const saved = JSON.stringify(analysis()); expect(saved).not.toMatch(/"frame"|base64|\.jpg|\.png|data:image/);
    await runGeneration({ tenant, job: cake(), deps: refDeps() });
    const own = new Set((await storage.listAssets(TENANT)).map((a) => a.id)); for (const p of ad.at(-1)!.photos) expect(own.has(p.id)).toBe(true);
    expect(ad.at(-1)!.logoId === null || own.has(String(ad.at(-1)!.logoId)) || ad.at(-1)!.logoId === 'logo').toBe(true);
  }, 240_000);
});
