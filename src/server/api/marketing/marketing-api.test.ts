import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ContentItem } from '@/lib/marketing-content';

const mocks = vi.hoisted(() => ({ copy: vi.fn(), standardOn: false, sstart: vi.fn(), sretrieve: vi.fn(), runwayOn: false, start: vi.fn(), retrieve: vi.fn(), tenantId: 'biz-1', ai: true, hasData: true, complete: vi.fn(), fetch: vi.fn(), ideasCache: null as null | { ideas: any[]; savedAt: string }, store: new Map<string, { tenant: string; item: any }>(), voices: new Map<string, unknown>(), counter: { n: 0 }, saveIdeas: vi.fn() }));
vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
vi.mock('@/server/marketing/video-copy.js', () => ({ copyRemoteVideo: (...args: unknown[]) => mocks.copy(...args) }));
vi.mock('@/server/marketing/standard-video/provider.js', () => ({ standardProvider: { id: 'standard', label: 'Standard Video', mode: 'standard', isConfigured: () => mocks.standardOn, start: (...args: unknown[]) => mocks.sstart(...args), retrieve: (...args: unknown[]) => mocks.sretrieve(...args), describeError: (error: unknown) => (error instanceof Error ? error.message : 'failed') } }));
vi.mock('@/server/marketing/runway.js', () => ({ runwayProvider: { id: 'runway', label: 'Runway', isConfigured: () => mocks.runwayOn, start: (...args: unknown[]) => mocks.start(...args), retrieve: (...args: unknown[]) => mocks.retrieve(...args), describeError: (error: unknown) => (error instanceof Error ? error.message : 'failed') } }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: mocks.tenantId, businessName: 'Somerset Pool', businessType: 'Pool & outdoor services' })), textValue: (v: unknown) => (typeof v === 'string' ? v : '') }));
vi.mock('@/server/marketing/store.js', () => ({
  listContent: async (tenant: string) => [...mocks.store.values()].filter((row) => row.tenant === tenant).map((row) => row.item),
  getContent: async (tenant: string, id: string) => { const row = mocks.store.get(id); return row && row.tenant === tenant ? row.item : null; },
  createContent: async (tenant: string, item: Record<string, unknown>) => { const full = { ...item, id: `c${++mocks.counter.n}`, createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' }; mocks.store.set(full.id, { tenant, item: full }); return full; },
  saveContent: async (tenant: string, item: { id: string }) => { const row = mocks.store.get(item.id); if (row && row.tenant === tenant) row.item = item; },
  removeContent: async (tenant: string, id: string) => { if (mocks.store.get(id)?.tenant === tenant) mocks.store.delete(id); },
  saveBrandVoice: async (tenant: string, voice: unknown) => { mocks.voices.set(tenant, voice); },
}));
vi.mock('@/server/marketing/service.js', () => ({
  aiConfigured: () => mocks.ai, aiComplete: mocks.complete,
  NEEDS_BUSINESS_INFORMATION: 'Pilot needs to know a little about your business before it can write for it.',
  generationFailure: (error: { publicMessage?: string }) => ({ status: error?.publicMessage ? 422 : 502, body: { error: error?.publicMessage ?? 'Pilot could not write that just now.' } }),
  cachedIdeas: async () => mocks.ideasCache, saveIdeas: mocks.saveIdeas,
  loadMarketingInput: vi.fn(async () => ({ hasRealData: mocks.hasData, trendReport: { status: 'ok', asOf: '2026-10-21', trends: [], sources: [], queries: [], message: '', summarized: true }, input: {
    brief: { businessName: 'Somerset Pool Service', businessType: 'Pool & outdoor services', location: 'Kitchener', website: '', description: 'Pool openings and cleaning.', services: ['Pool opening', 'Pool cleaning'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: 'Friendly', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: mocks.hasData, confirmedProfile: false },
    signals: [{ id: 'top:pool opening', kind: 'top_service', label: 'Pool opening is your most active service', detail: '14 bookings in the last 90 days.', service: 'Pool opening', asOf: '2026-10-21' }], trends: [], insights: [{ title: 'Pool cleaning bookings are slowing', recommendation: 'Promote it.' }],
    existing: [...mocks.store.values()].filter((row) => row.tenant === mocks.tenantId).map((row) => row.item), now: new Date('2026-10-21T16:00:00Z'), timezone: 'America/Toronto' } })),
}));

import ideasHandler from './ideas/POST';
import createHandler from './content/POST';
import patchHandler from './content/[contentId]/PATCH';
import deleteHandler from './content/[contentId]/DELETE';
import regenerateHandler from './content/[contentId]/regenerate/POST';
import renderHandler from './content/[contentId]/render/POST';
import startVideoHandler from './content/[contentId]/video/POST';
import checkVideoHandler from './content/[contentId]/video/GET';
import planHandler from './plan/POST';
import decisionHandler from './plan/decision/POST';
import voiceHandler from './brand-voice/PUT';

const respond = () => ({ statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; }, set() { return this; } });
const call = async (handler: (req: Request, res: Response) => unknown, body: unknown = {}, params: Record<string, string> = {}) => { const res = respond(); await handler({ body, params, query: {}, headers: {} } as unknown as Request, res as unknown as Response); return res; };

const piece = { hook: 'Opening your pool this spring?', caption: 'Pool opening season is almost here in Kitchener. We check the pump, cover and chemistry before the first swim.', cta: 'Book your pool opening with us.', hashtags: ['poolopening', 'kitchener'], suggestedVisual: 'The crew lifting the winter cover', postingFormat: 'Reel' };
const videoPiece = { ...piece, video: { durationSeconds: 15, scenes: [{ seconds: 3, visual: 'Cover pulled back', onScreenText: '5 things to check' }, { seconds: 5, visual: 'Pump test', onScreenText: '1. The pump' }], transitions: 'Quick cuts', audioDirection: 'Upbeat' } };
const reply = (value: unknown) => mocks.complete.mockResolvedValue(JSON.stringify(value));

beforeEach(() => {
  mocks.tenantId = 'biz-1'; mocks.ai = true; mocks.hasData = true; mocks.store.clear(); mocks.voices.clear(); mocks.ideasCache = null;
  mocks.copy.mockReset(); mocks.complete.mockReset(); mocks.saveIdeas.mockReset(); mocks.fetch.mockReset(); mocks.runwayOn = false; mocks.standardOn = false; mocks.start.mockReset(); mocks.retrieve.mockReset(); mocks.sstart.mockReset(); mocks.sretrieve.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const makeDraft = async (kind = 'post', platform = 'instagram') => { reply(kind === 'video' ? videoPiece : piece); const res = await call(createHandler, { kind, platform, topic: 'Spring pool opening', goal: 'Get more bookings' }); return res.body.item as ContentItem; };

describe('ideas from the business’s own information and insights', () => {
  it('uses the business’s real services, activity and Pilot insights, and saves the ideas', async () => {
    reply({ ideas: [{ title: 'Spring Pool Opening Checklist', why: 'Pool opening is your most active service.', format: 'video', platform: 'tiktok', hook: 'Check these 5 things first', cta: 'Book your pool opening', goal: 'Seasonal content', evidenceIds: ['top:pool opening', 'i1'] }] });
    const res = await call(ideasHandler, {});
    expect(res.statusCode).toBe(200);
    const prompt = mocks.complete.mock.calls[0][1] as string;
    expect(prompt).toContain('Somerset Pool Service');
    expect(prompt).toContain('Pool opening; Pool cleaning');
    expect(prompt).toContain('14 bookings in the last 90 days.');
    expect(prompt).toContain('Pool cleaning bookings are slowing');
    expect(res.body.ideas[0]).toMatchObject({ title: 'Spring Pool Opening Checklist', format: 'video', goal: 'Seasonal content' });
    expect(res.body.ideas[0].evidence.map((row: { detail: string }) => row.detail)).toEqual(['14 bookings in the last 90 days.', 'Pool cleaning bookings are slowing. Promote it.']);
    expect(mocks.saveIdeas).toHaveBeenCalledTimes(1);
  });

  it('asks for business information instead of writing generic ideas for an account with nothing', async () => {
    mocks.hasData = false;
    const res = await call(ideasHandler, {});
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ needsBusinessInformation: true });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('says plainly when the AI connection is missing, and writes nothing', async () => {
    mocks.ai = false;
    const res = await call(ideasHandler, {});
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ setupRequired: true });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('reuses recent ideas unless the owner asks to refresh', async () => {
    mocks.ideasCache = { ideas: [{ id: 'idea-1', title: 'Saved idea' }], savedAt: '2026-10-21T10:00:00.000Z' };
    const res = await call(ideasHandler, {});
    expect(res.body).toMatchObject({ cached: true, ideas: [{ title: 'Saved idea' }] });
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});

describe('writing posts, captions and videos', () => {
  it('writes a complete Instagram post as a draft', async () => {
    const item = await makeDraft();
    expect(item).toMatchObject({ kind: 'post', platform: 'instagram', status: 'draft', hook: 'Opening your pool this spring?', cta: 'Book your pool opening with us.', goal: 'Get more bookings', scheduledFor: null, approvedAt: null, publishedAt: null });
    expect(item.caption).toContain('Kitchener');
    expect(item.hashtags).toEqual(['#poolopening', '#kitchener']);
    expect(item.suggestedVisual).toBeTruthy();
    expect(item.video).toBeNull();
  });

  it('writes a video concept with scenes, on-screen text, audio direction and a caption, and no video file', async () => {
    const item = await makeDraft('video', 'tiktok');
    expect(item.kind).toBe('video');
    expect(item.video).toMatchObject({ durationSeconds: 15, transitions: 'Quick cuts', audioDirection: 'Upbeat', render: { status: 'not_generated' } });
    expect(item.video!.scenes[0]).toMatchObject({ onScreenText: '5 things to check' });
    expect(item.caption && item.hook && item.cta).toBeTruthy();
  });

  it('starts from one of Pilot’s ideas and keeps the evidence it was based on', async () => {
    mocks.ideasCache = { savedAt: 'x', ideas: [{ id: 'idea-1', title: 'Spring Pool Opening Checklist', why: 'Your most active service.', cta: 'Book your opening', goal: 'Seasonal content', evidence: [{ label: 'Most active', source: 'insight', detail: '14 bookings' }] }] };
    reply(piece);
    const res = await call(createHandler, { kind: 'post', platform: 'facebook', ideaId: 'idea-1' });
    expect(res.body.item).toMatchObject({ topic: 'Spring Pool Opening Checklist', why: 'Your most active service.', goal: 'Seasonal content', evidence: [{ detail: '14 bookings' }] });
  });

  it('needs a platform and a topic, real business information, and the AI connection', async () => {
    expect((await call(createHandler, { kind: 'post', platform: 'myspace', topic: 'x' })).statusCode).toBe(400);
    expect((await call(createHandler, { kind: 'post', platform: 'instagram' })).statusCode).toBe(400);
    mocks.hasData = false;
    expect((await call(createHandler, { kind: 'post', platform: 'instagram', topic: 'x' })).statusCode).toBe(409);
    mocks.hasData = true; mocks.ai = false;
    expect((await call(createHandler, { kind: 'post', platform: 'instagram', topic: 'x' })).statusCode).toBe(503);
  });

  it('saves nothing when Pilot cannot finish the piece', async () => {
    reply({ hook: 'Only a hook' });
    const res = await call(createHandler, { kind: 'post', platform: 'instagram', topic: 'x' });
    expect(res.statusCode).toBe(422);
    expect(mocks.store.size).toBe(0);
  });
});

describe('editing, approving, scheduling and publishing', () => {
  it('lets the owner edit everything, and fits the platform’s limits', async () => {
    const item = await makeDraft();
    const res = await call(patchHandler, { hook: 'New hook', caption: 'A caption we wrote ourselves.', cta: 'Call us today', hashtags: ['a', 'b'], suggestedVisual: 'Our truck' }, { contentId: item.id });
    expect(res.body.item).toMatchObject({ hook: 'New hook', caption: 'A caption we wrote ourselves.', cta: 'Call us today', hashtags: ['#a', '#b'], suggestedVisual: 'Our truck', status: 'draft' });
  });

  it('removes promises Pilot cannot keep even from the owner’s edits', async () => {
    const item = await makeDraft();
    const res = await call(patchHandler, { caption: 'Great care. This will go viral! Book now.' }, { contentId: item.id });
    expect(res.body.item.caption).toBe('Great care. Book now.');
  });

  it('refuses to save a post with an empty hook, caption or call to action', async () => {
    const item = await makeDraft();
    expect((await call(patchHandler, { caption: '' }, { contentId: item.id })).statusCode).toBe(400);
  });

  it('goes draft → approved → scheduled → published, only on the owner’s say-so, and never contacts a platform', async () => {
    const item = await makeDraft();
    const approve = await call(patchHandler, { action: { type: 'approve' } }, { contentId: item.id });
    expect(approve.body.item).toMatchObject({ status: 'approved' });
    const schedule = await call(patchHandler, { action: { type: 'schedule', date: '2026-10-25' } }, { contentId: item.id });
    expect(schedule.body.item).toMatchObject({ status: 'scheduled', scheduledFor: '2026-10-25' });
    const published = await call(patchHandler, { action: { type: 'mark_published' } }, { contentId: item.id });
    expect(published.body.item).toMatchObject({ status: 'published' });
    expect(published.body.item.publishedAt).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled(); // nothing is ever sent to any platform
  });

  it('will not schedule or publish content that has not been approved', async () => {
    const item = await makeDraft();
    expect((await call(patchHandler, { action: { type: 'schedule', date: '2026-10-25' } }, { contentId: item.id })).statusCode).toBe(409);
    expect((await call(patchHandler, { action: { type: 'mark_published' } }, { contentId: item.id })).statusCode).toBe(409);
    expect((await call(patchHandler, { action: { type: 'publish_now_everywhere' } }, { contentId: item.id })).statusCode).toBe(400);
  });

  it('sends approved content back to draft when its words are edited', async () => {
    const item = await makeDraft();
    await call(patchHandler, { action: { type: 'approve' } }, { contentId: item.id });
    const edited = await call(patchHandler, { caption: 'We changed our minds about the wording.' }, { contentId: item.id });
    expect(edited.body.item).toMatchObject({ status: 'draft', approvedAt: null });
    expect(edited.body.note).toMatch(/draft again/);
  });

  it('moves scheduled content to another day, keeping it approved', async () => {
    const item = await makeDraft();
    await call(patchHandler, { action: { type: 'approve' } }, { contentId: item.id });
    await call(patchHandler, { action: { type: 'schedule', date: '2026-10-25' } }, { contentId: item.id });
    const moved = await call(patchHandler, { action: { type: 'move', date: '2026-10-28' } }, { contentId: item.id });
    expect(moved.body.item).toMatchObject({ status: 'scheduled', scheduledFor: '2026-10-28' });
  });

  it('lets the owner edit the scenes of a video plan, but never fake a finished video', async () => {
    const item = await makeDraft('video', 'tiktok');
    const res = await call(patchHandler, { video: { durationSeconds: 20, scenes: [{ seconds: 5, visual: 'New opening shot', onScreenText: 'Spring is here' }, { seconds: 5, visual: 'Pump check', onScreenText: 'Check the pump' }], transitions: 'Slow fades', audioDirection: 'Calm', render: { status: 'ready', url: 'https://evil.example.com/fake.mp4' } } }, { contentId: item.id });
    expect(res.body.item.video).toMatchObject({ transitions: 'Slow fades', render: { status: 'not_generated' } });
    expect(res.body.item.video.scenes[0].visual).toBe('New opening shot');
  });

  it('deletes content, and only from the owner’s own business', async () => {
    const item = await makeDraft();
    mocks.tenantId = 'biz-2';
    expect((await call(deleteHandler, {}, { contentId: item.id })).statusCode).toBe(404);
    expect((await call(patchHandler, { hook: 'hijack' }, { contentId: item.id })).statusCode).toBe(404);
    expect(mocks.store.size).toBe(1);
    mocks.tenantId = 'biz-1';
    expect((await call(deleteHandler, {}, { contentId: item.id })).body).toEqual({ ok: true });
    expect(mocks.store.size).toBe(0);
  });
});

describe('regenerating', () => {
  it('rewrites the piece from the same brief, keeps its place on the calendar, and returns it to draft', async () => {
    const item = await makeDraft();
    await call(patchHandler, { action: { type: 'approve' } }, { contentId: item.id });
    await call(patchHandler, { action: { type: 'schedule', date: '2026-10-25' } }, { contentId: item.id });
    reply({ ...piece, hook: 'A fresh take on pool openings', caption: 'A completely different caption about opening day.' });
    const res = await call(regenerateHandler, {}, { contentId: item.id });
    expect(res.body.item).toMatchObject({ id: item.id, hook: 'A fresh take on pool openings', status: 'draft', approvedAt: null, scheduledFor: '2026-10-25' });
  });
  it('is refused for another business’s content', async () => {
    const item = await makeDraft();
    mocks.tenantId = 'biz-2';
    reply(piece);
    expect((await call(regenerateHandler, {}, { contentId: item.id })).statusCode).toBe(404);
  });
});

describe('Standard Video is the default, and never calls Runway', () => {
  beforeEach(() => { mocks.standardOn = true; mocks.runwayOn = true; });

  it('a normal "make the video" request starts a Standard Video, for the signed-in business, and Runway is not touched', async () => {
    mocks.sstart.mockResolvedValue({ taskId: 'std-task-0001', estimatedCredits: null, note: 'Made on our own servers.' });
    const item = await makeDraft('video', 'tiktok');
    for (const body of [{}, { mode: 'standard' }, { mode: 'something-else' }]) {
      mocks.store.get(item.id)!.item.video.render = { status: 'not_generated' };
      const res = await call(startVideoHandler, body, { contentId: item.id });
      expect(res.statusCode).toBe(202);
      expect(res.body).toMatchObject({ ok: true, status: 'processing', provider: 'Standard Video', estimatedCredits: null });
    }
    expect(mocks.sstart).toHaveBeenCalledTimes(3);
    expect(mocks.sstart.mock.calls[0][2]).toEqual({ tenantId: 'biz-1', contentId: item.id });
    expect(mocks.start).not.toHaveBeenCalled(); // Runway
    expect(mocks.store.get(item.id)!.item.video).toMatchObject({ mode: 'standard', render: { status: 'processing', taskId: 'std-task-0001', provider: 'Standard Video' } });
  });

  it('the existing "Make the video" address also makes a Standard Video', async () => {
    mocks.sstart.mockResolvedValue({ taskId: 'std-task-0001', estimatedCredits: null });
    const item = await makeDraft('video', 'tiktok');
    expect((await call(renderHandler, {}, { contentId: item.id })).body).toMatchObject({ provider: 'Standard Video' });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('checks on and saves the finished Standard Video, which is kept on our own storage', async () => {
    mocks.sstart.mockResolvedValue({ taskId: 'std-task-0001', estimatedCredits: null });
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, {}, { contentId: item.id });
    mocks.sretrieve.mockResolvedValue({ status: 'processing', message: 'Making the video.', progress: 0.3 });
    expect((await call(checkVideoHandler, {}, { contentId: item.id })).body).toMatchObject({ status: 'processing', progress: 0.3 });
    mocks.sretrieve.mockResolvedValue({ status: 'succeeded', url: '/api/marketing/media/videos/std-task-0001.mp4' });
    const done = await call(checkVideoHandler, {}, { contentId: item.id });
    expect(done.body).toMatchObject({ ok: true, status: 'ready', url: '/api/marketing/media/videos/std-task-0001.mp4', provider: 'Standard Video', notice: 'Saved on your Connection Pilot storage.' });
    expect(mocks.sretrieve.mock.calls[0][1]).toEqual({ tenantId: 'biz-1', contentId: item.id });
    expect(mocks.store.get(item.id)!.item.video.render).toEqual({ status: 'ready', url: '/api/marketing/media/videos/std-task-0001.mp4', provider: 'Standard Video' });
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('a link to someone else’s address or a plain http link is never accepted as a finished video', async () => {
    mocks.sstart.mockResolvedValue({ taskId: 'std-task-0001', estimatedCredits: null });
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, {}, { contentId: item.id });
    mocks.sretrieve.mockResolvedValue({ status: 'succeeded', url: '/api/other/thing.mp4' });
    await call(checkVideoHandler, {}, { contentId: item.id });
    expect(mocks.store.get(item.id)!.item.video.render.status).not.toBe('ready');
  });

  it('reports plainly when Standard Video is not available, and does not fall back to a paid provider', async () => {
    mocks.standardOn = false;
    const item = await makeDraft('video', 'tiktok');
    const res = await call(startVideoHandler, {}, { contentId: item.id });
    expect(res.statusCode).toBe(501);
    expect(res.body).toMatchObject({ ok: false, providerRequired: true });
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

describe('video files need a provider', () => {
  it('does not make a video and says a provider connection is required, and does not fall back to Runway', async () => {
    mocks.runwayOn = true;
    const item = await makeDraft('video', 'tiktok');
    const res = await call(renderHandler, {}, { contentId: item.id });
    expect(res.statusCode).toBe(501);
    expect(res.body).toMatchObject({ ok: false, providerRequired: true });
    expect(res.body.message).toMatch(/needs a video provider connection/);
    expect(mocks.store.get(item.id)!.item.video.render).toEqual({ status: 'not_generated' });
    expect(mocks.start).not.toHaveBeenCalled(); // Runway is never used for a normal video, even when it is connected
  });
  it('only video concepts can be started', async () => {
    mocks.runwayOn = true;
    const item = await makeDraft();
    expect((await call(startVideoHandler, {}, { contentId: item.id })).statusCode).toBe(422);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

describe('AI video (Runway) only runs when asked for by name', () => {
  beforeEach(() => { mocks.runwayOn = true; });

  it('starts the video, saves the task, and says it is not made yet', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50, note: 'This is AI-generated footage, not your real work.' });
    const item = await makeDraft('video', 'tiktok');
    const res = await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ ok: true, status: 'processing', taskId: 'task-abc-123', provider: 'Runway', estimatedCredits: 50, message: 'The video has started. It is not made yet.' });
    expect(res.body.notice).toMatch(/AI-generated footage/);
    expect(mocks.store.get(item.id)!.item.video.render).toEqual({ status: 'processing', taskId: 'task-abc-123', provider: 'Runway' });
    expect(mocks.start.mock.calls[0][0]).toMatchObject({ scenes: expect.any(Array) });
  });

  it('the existing "Make the video" address starts the same background video', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: null });
    const item = await makeDraft('video', 'tiktok');
    expect((await call(renderHandler, { mode: 'ai' }, { contentId: item.id })).statusCode).toBe(202);
    expect(mocks.store.get(item.id)!.item.video.render.status).toBe('processing');
  });

  it('does not start a second video while one is being made', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    const again = await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    expect(again.body).toMatchObject({ alreadyStarted: true, status: 'processing', taskId: 'task-abc-123' });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('reports a failed start as not started, with the provider’s reason, and saves nothing', async () => {
    mocks.start.mockRejectedValue(new Error('Runway did not accept the API key, so nothing was started.'));
    const item = await makeDraft('video', 'tiktok');
    const res = await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ ok: false, message: 'The video was NOT started. Runway did not accept the API key, so nothing was started.' });
    expect(mocks.store.get(item.id)!.item.video.render).toEqual({ status: 'not_generated' });
  });

  it('reports progress while the video is being made, without calling it ready', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    mocks.retrieve.mockResolvedValue({ status: 'processing', message: 'Runway is making the video.', progress: 0.4 });
    const res = await call(checkVideoHandler, {}, { contentId: item.id });
    expect(res.body).toMatchObject({ ok: true, status: 'processing', message: 'Runway is making the video.', progress: 0.4 });
    expect(res.body.url).toBeUndefined();
    expect(mocks.retrieve).toHaveBeenCalledWith('task-abc-123', { tenantId: 'biz-1', contentId: item.id });
    expect(mocks.store.get(item.id)!.item.video.render.status).toBe('processing');
  });

  it('copies the finished video into the business’s own storage, and reports it ready only once that copy exists', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    mocks.copy.mockResolvedValue('/api/marketing/media/videos/task-abc-123.mp4');
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    mocks.retrieve.mockResolvedValue({ status: 'succeeded', url: 'https://dnznrvs05pmza.cloudfront.net/video.mp4?sig=1' });
    const res = await call(checkVideoHandler, {}, { contentId: item.id });
    expect(mocks.copy).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://dnznrvs05pmza.cloudfront.net/video.mp4?sig=1', tenantId: 'biz-1', videoId: 'task-abc-123' }));
    expect(res.body).toMatchObject({ ok: true, status: 'ready', url: '/api/marketing/media/videos/task-abc-123.mp4', provider: 'Runway' });
    expect(JSON.stringify(res.body)).not.toMatch(/cloudfront|expire/); // the temporary link is never kept or shown
    expect(mocks.store.get(item.id)!.item.video.render).toEqual({ status: 'ready', url: '/api/marketing/media/videos/task-abc-123.mp4', provider: 'Runway' });
    // once it is made it is not asked about again, and cannot be started again
    mocks.retrieve.mockClear();
    expect((await call(checkVideoHandler, {}, { contentId: item.id })).body).toMatchObject({ status: 'ready' });
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect((await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id })).body).toMatchObject({ status: 'ready', message: 'This video was already made.' });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('never says a video is ready when the finished file could not be copied, and never pays for a second one', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    mocks.retrieve.mockResolvedValue({ status: 'succeeded', url: 'https://dnznrvs05pmza.cloudfront.net/video.mp4?sig=1' });
    mocks.copy.mockRejectedValueOnce(new Error('The finished video could not be downloaded (503).'));
    const first = await call(checkVideoHandler, {}, { contentId: item.id });
    expect(first.body).toMatchObject({ ok: true, status: 'processing' });
    expect(first.body.url).toBeUndefined();
    expect(mocks.store.get(item.id)!.item.video.render).toMatchObject({ status: 'processing', taskId: 'task-abc-123' }); // still being made: nothing is claimed
    // the next check tries the copy again and succeeds, without starting another generation
    mocks.copy.mockResolvedValue('/api/marketing/media/videos/task-abc-123.mp4');
    expect((await call(checkVideoHandler, {}, { contentId: item.id })).body).toMatchObject({ status: 'ready' });
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it('puts a failed video back to "not made" so it can be started again', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    const item = await makeDraft('video', 'tiktok');
    await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    mocks.retrieve.mockResolvedValue({ status: 'failed', message: 'Runway could not make the video: the prompt was rejected.' });
    const res = await call(checkVideoHandler, {}, { contentId: item.id });
    expect(res.body).toMatchObject({ ok: false, status: 'failed', message: 'Runway could not make the video: the prompt was rejected.' });
    expect(mocks.store.get(item.id)!.item.video.render).toEqual({ status: 'not_generated' });
  });

  it('says so when nothing has been started, and when Runway cannot be reached', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    const item = await makeDraft('video', 'tiktok');
    expect((await call(checkVideoHandler, {}, { contentId: item.id })).body).toMatchObject({ status: 'not_started' });
    await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id });
    mocks.retrieve.mockRejectedValue(new Error('network down'));
    const res = await call(checkVideoHandler, {}, { contentId: item.id });
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ ok: false, message: 'Could not check the video. network down' });
  });

  it('only works on the owner’s own content', async () => {
    mocks.start.mockResolvedValue({ taskId: 'task-abc-123', estimatedCredits: 50 });
    const item = await makeDraft('video', 'tiktok');
    mocks.tenantId = 'biz-2';
    expect((await call(startVideoHandler, { mode: 'ai' }, { contentId: item.id })).statusCode).toBe(404);
    expect((await call(checkVideoHandler, {}, { contentId: item.id })).statusCode).toBe(404);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

describe('"Let Pilot plan my content"', () => {
  const entry = (date: string, extra: Record<string, unknown> = {}) => ({ date, kind: 'post', platform: 'instagram', topic: 'Pool opening', goal: 'Seasonal content', why: 'Pool opening is your most active service.', evidenceIds: ['top:pool opening'], ...piece, ...extra });

  it('proposes a week of content, each with its reason, for the owner to review — nothing is approved or published', async () => {
    reply({ items: [entry('2026-10-22'), entry('2026-10-24', { kind: 'video', platform: 'tiktok', topic: 'Opening checklist', video: videoPiece.video })] });
    const res = await call(planHandler, {});
    expect(res.statusCode).toBe(201);
    expect(res.body.items).toHaveLength(2);
    for (const item of res.body.items) expect(item).toMatchObject({ status: 'proposed', approvedAt: null, publishedAt: null });
    expect(res.body.items[0]).toMatchObject({ scheduledFor: '2026-10-22', why: 'Pool opening is your most active service.', campaign: 'plan-2026-10-21' });
    expect(res.body.items[0].evidence[0].detail).toBe('14 bookings in the last 90 days.');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('replaces earlier proposals but never touches content the owner already approved', async () => {
    reply({ items: [entry('2026-10-22')] });
    await call(planHandler, {});
    const approved = await makeDraft();
    await call(patchHandler, { action: { type: 'approve' } }, { contentId: approved.id });
    reply({ items: [entry('2026-10-23')] });
    await call(planHandler, {});
    const statuses = [...mocks.store.values()].map((row) => row.item.status).sort();
    expect(statuses).toEqual(['approved', 'proposed']);
  });

  it('lets the owner approve all or remove, and only affects proposed items', async () => {
    reply({ items: [entry('2026-10-22'), entry('2026-10-24')] });
    const plan = await call(planHandler, {});
    const [first, second] = plan.body.items.map((item: ContentItem) => item.id);
    const draft = await makeDraft();
    const approve = await call(decisionHandler, { ids: [first, draft.id], decision: 'approve' });
    expect(approve.body).toMatchObject({ changed: [first], skipped: [draft.id] });
    expect(mocks.store.get(first)!.item.status).toBe('scheduled'); // it already has a day, so approving puts it on the calendar
    expect(mocks.store.get(draft.id)!.item.status).toBe('draft');
    const remove = await call(decisionHandler, { ids: [second, first], decision: 'remove' });
    expect(remove.body).toMatchObject({ changed: [second], skipped: [first] });
    expect(mocks.store.has(first)).toBe(true);
    expect(mocks.store.has(second)).toBe(false);
    expect((await call(decisionHandler, { ids: [], decision: 'approve' })).statusCode).toBe(400);
    expect((await call(decisionHandler, { ids: [first], decision: 'nuke' })).statusCode).toBe(400);
  });

  it('asks for business information first when there is none', async () => {
    mocks.hasData = false;
    expect((await call(planHandler, {})).statusCode).toBe(409);
  });
});

describe('brand voice', () => {
  it('saves a chosen or custom brand voice for this business', async () => {
    const res = await call(voiceHandler, { tone: 'Funny, but never pushy', description: 'Dad jokes about chlorine' });
    expect(res.body.brandVoice).toEqual({ tone: 'Funny, but never pushy', description: 'Dad jokes about chlorine' });
    expect(mocks.voices.get('biz-1')).toEqual({ tone: 'Funny, but never pushy', description: 'Dad jokes about chlorine' });
    expect((await call(voiceHandler, { tone: '' })).statusCode).toBe(400);
    expect(mocks.voices.has('biz-2')).toBe(false);
  });
});

export type { ContentItem };
