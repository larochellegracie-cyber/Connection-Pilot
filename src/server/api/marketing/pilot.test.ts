import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  ai: true, hasData: true, complete: vi.fn(), ideas: null as null | { ideas: any[]; savedAt: string }, saveIdeas: vi.fn(),
  createImage: vi.fn(), aiImage: vi.fn(), store: new Map<string, any>(), n: { value: 0 }, standardVideo: vi.fn(), replan: vi.fn(), runwayStart: vi.fn(), fetch: vi.fn(),
}));
vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
// these tests cover the making code, which Marketing Creative Mode pauses by default (see pilot-creative-mode.test.ts)
vi.mock('@/server/marketing/creative-mode-config.js', () => ({ creativeModePausesGeneration: false }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool Service', businessType: 'Pool & outdoor services' })), textValue: (v: unknown) => (typeof v === 'string' ? v : '') }));
vi.mock('@/server/marketing/image.js', () => ({ choosePostImage: (...args: unknown[]) => mocks.createImage(...args), createPostImage: (...args: unknown[]) => mocks.aiImage(...args), imageIdOf: () => null, pictureFailure: () => 'x' }));
vi.mock('@/server/marketing/runway.js', () => ({ runwayProvider: { id: 'runway', label: 'Runway', isConfigured: () => true, start: (...args: unknown[]) => mocks.runwayStart(...args), retrieve: vi.fn(), describeError: () => '' } }));
vi.mock('@/server/marketing/store.js', () => ({
  createContent: async (tenant: string, item: Record<string, unknown>) => { const full = { ...item, id: `c${++mocks.n.value}`, createdAt: 'now', updatedAt: 'now' }; mocks.store.set(full.id, { tenant, item: full }); return full; },
  getContent: async (_t: string, id: string) => mocks.store.get(id)?.item ?? null, saveContent: async (_t: string, item: { id: string }) => { mocks.store.set(item.id, { tenant: 'biz-1', item }); },
  listContent: async () => [],
}));
vi.mock('@/server/marketing/standard-video/orchestrate.js', () => {
  class NeedsBusinessInformation extends Error {}
  class PlannerError extends Error { constructor(public publicMessage: string) { super(publicMessage); } }
  return { createStandardVideo: (...args: unknown[]) => mocks.standardVideo(...args), replanStandardVideo: (...args: unknown[]) => mocks.replan(...args), NeedsBusinessInformation, PlannerError };
});
vi.mock('@/server/marketing/service.js', () => ({
  aiConfigured: () => mocks.ai, aiComplete: mocks.complete, NEEDS_BUSINESS_INFORMATION: 'x',
  generationFailure: () => ({ status: 502, body: { error: 'Pilot could not write that just now.' } }),
  cachedIdeas: async () => mocks.ideas, saveIdeas: mocks.saveIdeas,
  loadMarketingInput: vi.fn(async () => ({ hasRealData: mocks.hasData, trendReport: null, input: {
    brief: { businessName: 'Somerset Pool Service', businessType: 'Pool & outdoor services', location: 'Kitchener', website: '', description: 'Pool openings and closings.', services: ['Pool opening', 'Pool closing'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: 'Friendly', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true },
    signals: [{ id: 'top:pool closing', kind: 'top_service', label: 'Pool closing is busy', detail: '9 bookings.', service: 'Pool closing', asOf: '2026-10-21' }], trends: [], insights: [], existing: [], now: new Date('2026-10-21T16:00:00Z'), timezone: 'America/Toronto' } })),
}));

import pilotHandler from './pilot/POST';
import startVideoHandler from './content/[contentId]/video/POST';
import { NeedsBusinessInformation } from '@/server/marketing/standard-video/orchestrate.js';

const respond = () => ({ statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; }, set() { return this; } });
const say = async (message: unknown, ideaId?: string) => { const res = respond(); await pilotHandler({ body: { message, ...(ideaId ? { ideaId } : {}) }, params: {}, query: {}, headers: {} } as unknown as Request, res as unknown as Response); return res; };
const piece = { imagePrompt: 'A winter cover being smoothed over a backyard pool at dusk, calm and tidy.', hook: 'Close your pool early this year', caption: 'Closing early keeps leaves and debris out of the water all fall.', cta: 'Book your pool closing today.', hashtags: ['poolclosing'], suggestedVisual: 'The crew covering a pool', postingFormat: 'Post' };
const videoPiece = { ...piece, video: { durationSeconds: 15, scenes: [{ seconds: 3, visual: 'Cover on', onScreenText: 'Close it early' }, { seconds: 5, visual: 'Crew at work', onScreenText: 'We handle it' }], transitions: 'Quick cuts', audioDirection: 'Upbeat' } };
const idea = (n: number, format = 'post') => ({ id: `idea-${n}`, title: `Idea ${n}`, why: `Reason ${n}`, format, platform: 'facebook', hook: 'Hook', cta: 'Book now', goal: 'Seasonal content', evidence: [] });
const standardItem = { id: 'sv1', kind: 'video', platform: 'instagram', status: 'draft', hook: 'Close your pool', video: { render: { status: 'processing' } } };

beforeEach(() => {
  mocks.ai = true; mocks.hasData = true; mocks.ideas = null; mocks.store.clear(); mocks.n.value = 0;
  for (const mock of [mocks.createImage, mocks.aiImage, mocks.complete, mocks.saveIdeas, mocks.standardVideo, mocks.replan, mocks.runwayStart, mocks.fetch]) mock.mockReset();
  mocks.createImage.mockResolvedValue({ url: '/api/marketing/media/images/abcdef12-3456.jpg', prompt: 'A winter cover being smoothed over a backyard pool at dusk, calm and tidy.' });
  mocks.aiImage.mockResolvedValue({ url: '/api/marketing/media/images/ffeedd11-2233.jpg', prompt: 'A pool technician closing a pool', source: 'generated' });
  mocks.standardVideo.mockResolvedValue({ item: standardItem, render: { started: true, taskId: 't1' } });
  vi.stubGlobal('fetch', mocks.fetch); vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a post comes with a picture', () => {
  it('picks the visual from the business and the post’s own words, and returns it with the words', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('Pilot, make me a post for Somerset this weekend.');
    expect(mocks.createImage).toHaveBeenCalledTimes(1);
    expect(mocks.createImage).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'biz-1', hook: 'Close your pool early this year', cta: 'Book your pool closing today.', brief: expect.objectContaining({ businessName: 'Somerset Pool Service' }) }));
    expect(res.body.reply.item).toMatchObject({ kind: 'post', hook: 'Close your pool early this year', image: { url: '/api/marketing/media/images/abcdef12-3456.jpg' } });
    expect(res.body.reply.item.imagePrompt).toBeUndefined(); // the scene is kept as the picture's own note, not as a loose field
    expect(res.body.reply.message).toBe('Here’s your Instagram post.');
  });

  it('keeps the post and says so honestly when the picture could not be made', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    mocks.createImage.mockRejectedValue(new Error('429 rate limit sk-secret'));
    const res = await say('Make me a post for Somerset');
    expect(res.statusCode).toBe(200);
    expect(res.body.reply.item.image).toBeNull();
    expect(res.body.reply.message).toMatch(/couldn’t make the picture/);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|rate limit|OpenAI/);
  });

  it('never hands a scene description to a picture maker: the visual is the owner’s photo or a branded graphic', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    await say('Make me a post for Somerset');
    expect(mocks.createImage.mock.calls[0][0]).not.toHaveProperty('scene');
  });

  it('never calls the AI image maker for an ordinary post', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    await say('Pilot, make me a post for Somerset this weekend.');
    expect(mocks.createImage).toHaveBeenCalledTimes(1); expect(mocks.aiImage).not.toHaveBeenCalled();
  });

  it('uses the AI image maker only when the owner explicitly asks for an AI-generated picture', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('Pilot, make me an AI-generated picture of a pool technician closing a pool.');
    expect(mocks.aiImage).toHaveBeenCalledTimes(1); expect(mocks.createImage).not.toHaveBeenCalled();
    expect(mocks.aiImage).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'biz-1', explicit: true, scene: 'a pool technician closing a pool' }));
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'post', item: { kind: 'post', image: { source: 'generated' } } });
    expect(res.body.reply.message).toMatch(/AI-generated picture you asked for/);
  });

  it('keeps the post and says so when the explicitly requested AI picture fails', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    mocks.aiImage.mockRejectedValue(new Error('403 sk-secret billing'));
    const res = await say('Make me an AI picture of a pool at dusk');
    expect(res.statusCode).toBe(200); expect(res.body.reply.item.image).toBeNull(); expect(res.body.reply.message).toMatch(/couldn’t make the AI picture/);
    expect(JSON.stringify(res.body)).not.toMatch(/sk-|billing/);
  });

  it('does not make a picture for a video or a video plan', async () => {
    await say('Make me a video for Somerset');
    mocks.complete.mockResolvedValue(JSON.stringify(videoPiece));
    await say('Make me a cinematic video of a pool at sunset');
    expect(mocks.createImage).not.toHaveBeenCalled();
  });
});

describe('talking to Pilot', () => {
  it('writes a post for a plain request, using the business it already knows', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('I want a post about why people should close their pool early.');
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'post', item: { kind: 'post', platform: 'instagram', status: 'draft', hook: 'Close your pool early this year' } });
    const prompt = mocks.complete.mock.calls[0][1] as string;
    expect(prompt).toContain('Somerset Pool Service'); expect(prompt).toContain('why people should close their pool early');
    expect(mocks.standardVideo).not.toHaveBeenCalled();
  });

  it('makes a reasonable post from a vague request, with no form', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('Pilot, make me a post for Somerset.');
    expect(res.body.reply.kind).toBe('created');
    expect(mocks.complete.mock.calls[0][1]).toContain('Choose it yourself from what you know about the business');
    expect(res.body.reply.item.topic).toBe('Close your pool early this year'); // the library shows a real title, not the instruction
  });

  it('uses the platform the owner names', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    expect((await say('Make a Facebook post for this weekend')).body.reply.item.platform).toBe('facebook');
  });

  it('makes a video as a Standard Video, and starts the file', async () => {
    const res = await say('Make me a 20-second Instagram ad for our pool closing service.');
    expect(mocks.standardVideo).toHaveBeenCalledWith(expect.objectContaining({ id: 'biz-1' }), expect.objectContaining({ request: 'Make me a 20-second Instagram ad for our pool closing service.', startRender: true }));
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'video', render: { started: true, taskId: 't1' } });
    expect(mocks.runwayStart).not.toHaveBeenCalled();
  });

  it('a vague video request still becomes a Standard Video', async () => {
    await say('Make me a video for Somerset');
    expect(mocks.standardVideo).toHaveBeenCalledTimes(1);
    expect(mocks.runwayStart).not.toHaveBeenCalled();
  });

  it('suggests several ideas from the business and saves them, without making anything', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify({ ideas: [{ title: 'Close your pool early', why: 'Pool closing is busy.', format: 'post', platform: 'instagram', hook: 'h', cta: 'c', goal: 'Seasonal content', evidenceIds: ['top:pool closing'] }, { title: 'What closing includes', why: 'Owners ask.', format: 'video', platform: 'tiktok', hook: 'h', cta: 'c', goal: 'Educate' }] }));
    const res = await say('Give me some ideas for what I should post this week.');
    expect(res.body.reply.kind).toBe('ideas'); expect(res.body.reply.ideas.map((i: any) => i.title)).toEqual(['Close your pool early', 'What closing includes']);
    expect(mocks.saveIdeas).toHaveBeenCalledTimes(1); expect(mocks.store.size).toBe(0);
  });

  it('“make idea #3” makes the third saved idea with that idea’s platform and reason', async () => {
    mocks.ideas = { ideas: [idea(1), idea(2), idea(3)], savedAt: 'now' };
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('Make idea #3.');
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'post', item: { platform: 'facebook', topic: 'Idea 3', why: 'Reason 3' } });
    expect(mocks.complete.mock.calls[0][1]).toContain('Idea 3');
  });

  it('“make #2” makes a video idea as a Standard Video', async () => {
    mocks.ideas = { ideas: [idea(1), idea(2, 'video')], savedAt: 'now' };
    await say('Make #2');
    expect(mocks.standardVideo).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ request: expect.stringContaining('Idea 2'), startRender: true }));
  });

  it('says so plainly when there is no such idea yet', async () => {
    expect((await say('Make idea #3')).body.reply.message).toMatch(/Ask me for ideas/);
    mocks.ideas = { ideas: [idea(1)], savedAt: 'now' };
    expect((await say('Make idea #5')).body.reply.message).toMatch(/only have 1 ideas/);
  });

  it('uses the timing the owner gave, and asks one short question when it is not a request', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('Pilot, make me a post for Somerset this weekend.');
    expect(mocks.complete.mock.calls[0][1]).toContain('this weekend');
    expect(res.body.reply.item.status).toBe('draft'); expect(res.body.reply.item.scheduledFor).toBeNull(); // never scheduled for the owner
    mocks.complete.mockClear();
    const hello = await say('hello');
    expect(hello.body.reply).toMatchObject({ kind: 'message' }); expect(hello.body.reply.message).toMatch(/What would you like me to make\?/);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('plans a week when asked', async () => { expect((await say('Plan my week')).body.reply.kind).toBe('plan_week'); });
});

describe('tapping an idea card', () => {
  it('makes exactly that idea, with its own platform and reason', async () => {
    mocks.ideas = { ideas: [idea(1), idea(2), idea(3)], savedAt: 'now' };
    mocks.complete.mockResolvedValue(JSON.stringify(piece));
    const res = await say('Make idea: Idea 2', 'idea-2');
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'post', item: { platform: 'facebook', topic: 'Idea 2', why: 'Reason 2' } });
  });

  it('makes a video idea as a Standard Video and never reaches Runway', async () => {
    mocks.ideas = { ideas: [idea(1, 'video')], savedAt: 'now' };
    await say('Make idea: Idea 1', 'idea-1');
    expect(mocks.standardVideo).toHaveBeenCalledTimes(1); expect(mocks.runwayStart).not.toHaveBeenCalled();
  });

  it('says so when the idea has expired', async () => {
    expect((await say('Make idea: x', 'idea-9')).body.reply.message).toMatch(/expired/);
  });
});

describe('AI video is never started by accident', () => {
  it('prepares the plan for realistic footage and waits for a yes. Runway is not called', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(videoPiece));
    const res = await say('Make me a cinematic video of a pool at sunset');
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'ai_video', awaitingConfirmation: true, item: { kind: 'video', video: { mode: 'ai', render: { status: 'not_generated' } } } });
    expect(mocks.runwayStart).not.toHaveBeenCalled(); expect(mocks.standardVideo).not.toHaveBeenCalled();
  });

  it('plans an AI video as the short clip it will really be, so the plan never promises more than the video delivers', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(videoPiece));
    const short = (await say('Pilot, make me a 5-second realistic AI video about pool closing.')).body.reply;
    expect(short.item.video.durationSeconds).toBe(5);
    expect(short.item.video.scenes.reduce((sum: number, scene: { seconds: number }) => sum + scene.seconds, 0)).toBeCloseTo(5, 0);
    expect(short.message).toContain('5-second'); expect(short.message).not.toMatch(/up to 10 seconds/);
    const long = (await say('Make me a 20-second cinematic video of a pool at sunset')).body.reply;
    expect(long.item.video.durationSeconds).toBe(10);
    expect(long.message).toMatch(/up to 10 seconds, so this one is 10/);
    expect((await say('Make me a realistic AI video about pool closing')).body.reply.item.video.durationSeconds).toBe(5); // a light default
    expect(mocks.runwayStart).not.toHaveBeenCalled();
  });

  it('only starts it when the owner says yes, through the existing video route', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(videoPiece));
    const made = (await say('I want realistic AI-generated footage of a backyard pool')).body.reply.item;
    mocks.runwayStart.mockResolvedValue({ ok: true, taskId: 'r1', provider: 'Runway', estimatedCredits: 5, note: '' });
    const res = respond();
    await startVideoHandler({ body: { mode: 'ai' }, params: { contentId: made.id }, query: {}, headers: {} } as unknown as Request, res as unknown as Response);
    expect(mocks.runwayStart).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(202);
  });

  it('ordinary video words never reach Runway', async () => {
    for (const text of ['Make me a video for pool opening', 'Make a TikTok reel about our crew', 'Make idea #1 as a video']) { mocks.ideas = { ideas: [idea(1)], savedAt: 'now' }; await say(text); }
    expect(mocks.runwayStart).not.toHaveBeenCalled(); expect(mocks.standardVideo).toHaveBeenCalledTimes(3);
  });
});

describe('plain-language errors', () => {
  it('asks for business information without technical words', async () => {
    mocks.hasData = false; mocks.complete.mockResolvedValue('{}');
    const res = await say('Make me a post for Somerset');
    expect(res.statusCode).toBe(409); expect(res.body.needsBusinessInformation).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/OpenAI|API key|Firecrawl|Runway|provider/i);
    mocks.standardVideo.mockRejectedValue(new NeedsBusinessInformation());
    expect((await say('Make me a video for Somerset')).statusCode).toBe(409);
  });

  it('never mentions keys or providers when it is not set up or something breaks', async () => {
    mocks.ai = false;
    const off = await say('Make me a post');
    expect(off.statusCode).toBe(503); expect(off.body.error).toBe('Pilot isn’t ready to create things yet. Please contact support.');
    mocks.ai = true; mocks.complete.mockRejectedValue(new Error('401 Incorrect API key provided: sk-secret'));
    const broken = await say('Make me a post');
    expect(broken.statusCode).toBe(502); expect(JSON.stringify(broken.body)).not.toMatch(/sk-|API key|OpenAI/i);
  });

  it('asks for something when the message is empty', async () => { expect((await say('  ')).statusCode).toBe(400); });
});
