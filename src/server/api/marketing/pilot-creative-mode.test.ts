import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  generatePiece: vi.fn(), createJob: vi.fn(), confirmJob: vi.fn(), latestJob: vi.fn(), saveSelection: vi.fn(), createContent: vi.fn(), choosePostImage: vi.fn(), createPostImage: vi.fn(), createStandardVideo: vi.fn(), runwayStart: vi.fn(),
  complete: vi.fn(), loadContext: vi.fn(), loadInput: vi.fn(), available: vi.fn(), startGeneration: vi.fn(), ideas: null as null | { ideas: any[]; savedAt: string },
}));
vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: 'biz-1', businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' })), textValue: (v: unknown) => (typeof v === 'string' ? v : '') }));
vi.mock('@/server/marketing/generate.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/marketing/generate.js')>()), generatePiece: (...a: unknown[]) => mocks.generatePiece(...a), generateIdeas: vi.fn() }));
vi.mock('@/server/marketing/image.js', () => ({ choosePostImage: (...a: unknown[]) => mocks.choosePostImage(...a), createPostImage: (...a: unknown[]) => mocks.createPostImage(...a), pictureFailure: () => 'x', imageIdOf: () => null }));
vi.mock('@/server/marketing/runway.js', () => ({ runwayProvider: { id: 'runway', label: 'Runway', isConfigured: () => true, start: (...a: unknown[]) => mocks.runwayStart(...a), retrieve: vi.fn(), describeError: () => '' } }));
vi.mock('@/server/marketing/store.js', () => ({ createContent: (...a: unknown[]) => mocks.createContent(...a), getContent: vi.fn(), saveContent: vi.fn(), listContent: async () => [] }));
vi.mock('@/server/marketing/marketing-jobs.js', () => ({ createMarketingJob: (...a: unknown[]) => mocks.createJob(...a), latestActiveJob: (...a: unknown[]) => mocks.latestJob(...a), confirmMarketingJob: (...a: unknown[]) => mocks.confirmJob(...a), saveJobSelection: (...a: unknown[]) => mocks.saveSelection(...a) }));
vi.mock('@/server/marketing/video-generation.js', async () => {
  const { engineFor } = await import('@/server/marketing/video-engine.js');
  return { engineAvailable: (engine: string) => mocks.available(engine), startVideoGeneration: (...a: unknown[]) => mocks.startGeneration(...a), engineOf: (job: any) => (job?.storyboard ? (job.storyboard.engine ?? 'runway') : null), engineForJob: async (_t: string, job: any) => engineFor({ message: job.userMessage, style: job.brief.style }) };
});
vi.mock('@/server/marketing/standard-video/orchestrate.js', () => {
  class NeedsBusinessInformation extends Error {}
  class PlannerError extends Error { constructor(public publicMessage: string) { super(publicMessage); } }
  return { createStandardVideo: (...a: unknown[]) => mocks.createStandardVideo(...a), replanStandardVideo: vi.fn(), NeedsBusinessInformation, PlannerError };
});
vi.mock('@/server/marketing/service.js', () => ({
  aiConfigured: () => true, aiComplete: (...a: unknown[]) => mocks.complete(...a), NEEDS_BUSINESS_INFORMATION: 'x', generationFailure: () => ({ status: 502, body: { error: 'x' } }),
  cachedIdeas: async () => mocks.ideas, saveIdeas: vi.fn(), loadMarketingInput: (...a: unknown[]) => mocks.loadInput(...a),
}));
vi.mock('@/server/marketing/creative-context.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/server/marketing/creative-context.js')>()), loadCreativeContext: (...a: unknown[]) => mocks.loadContext(...a) }));

import pilotHandler from './pilot/POST';

const context = { business: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', services: ['Pool closing', 'Pool opening'], promotions: '', brandVoice: { tone: 'Friendly' }, websiteNotes: ['a page'] }, brand: { name: 'Somerset Pool Service' }, media: { all: [], photos: [{ label: 'Pouring salt into a pool' }], logos: [], videos: [] }, gaps: ['No logo has been added.'] };
const brief = (over: Record<string, unknown> = {}) => ({ platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: [], length_seconds: null, key_instructions: [], iteration_of: null, ...over });
const respond = () => ({ statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; }, set() { return this; } });
const say = async (message: string, ideaId?: string) => { const res = respond(); await pilotHandler({ body: { message, ...(ideaId ? { ideaId } : {}) }, params: {}, query: {}, headers: {} } as unknown as Request, res as unknown as Response); return res; };
// nothing OLD is made: no writer, no pictures, no Standard Video from the Create tab, and Runway is never called from here
const nothingElseWasMade = () => { for (const spy of [mocks.generatePiece, mocks.createContent, mocks.choosePostImage, mocks.createPostImage, mocks.createStandardVideo, mocks.runwayStart]) expect(spy).not.toHaveBeenCalled(); };

beforeEach(() => {
  for (const spy of [mocks.generatePiece, mocks.createContent, mocks.choosePostImage, mocks.createPostImage, mocks.createStandardVideo, mocks.runwayStart, mocks.complete, mocks.loadContext, mocks.createJob, mocks.latestJob, mocks.confirmJob, mocks.saveSelection, mocks.available, mocks.startGeneration]) spy.mockReset();
  mocks.loadContext.mockResolvedValue(context); mocks.ideas = null; mocks.latestJob.mockResolvedValue(null); mocks.available.mockReturnValue(true); mocks.startGeneration.mockResolvedValue({ started: true }); mocks.saveSelection.mockResolvedValue(undefined);
  mocks.complete.mockResolvedValue(JSON.stringify(brief()));
  mocks.createJob.mockImplementation(async (_id: string, input: object) => ({ id: 'job-1', status: 'brief_ready', selection: null, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a', ...input }));
  mocks.confirmJob.mockImplementation(async (_t: string, id: string) => { const created = mocks.createJob.mock.results.at(-1); return { ...(created ? await created.value : await mocks.latestJob.mock.results.at(-1)?.value), id, status: 'confirmed' }; }); // the saved job, confirmed
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Marketing Creative Mode in the Marketing page chat', () => {
  it.each([
    'Make me a TikTok about pool closing', 'Make me a fast video for Instagram', 'Make me a 5-second video about pool closing', 'Make #3',
  ])('%s: starts the free animated video at once, with no question', async (text) => {
    const res = await say(text);
    expect(res.statusCode).toBe(200); expect(res.body.reply).toMatchObject({ kind: 'job', jobId: 'job-1' });
    expect(res.body.reply.message).toContain('Creating a free animated video…'); expect(res.body.reply.message).not.toMatch(/\*\*|Does this look right|Say yes/);
    expect(mocks.loadContext).toHaveBeenCalledWith('biz-1'); // this business, from the session
    expect(mocks.createJob.mock.calls[0][1]).toMatchObject({ userMessage: text }); // saved with the owner's own words
    expect(mocks.confirmJob).toHaveBeenCalledWith('biz-1', 'job-1'); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(mocks.complete).toHaveBeenCalledTimes(1); // the only AI call: reading the request
    nothingElseWasMade();
  });

  it('asks for a “yes” only for the premium look, showing the cost first, and does not call Runway', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(brief({ style: ['cinematic'] })));
    const res = await say('Make me a cinematic video about pool closing');
    expect(res.body.reply.kind).toBe('message'); expect(res.body.reply.message).toContain('Cost: Using Runway: this will cost about 144 Runway credits'); expect(res.body.reply.message).toContain('say “make it animated” for the free version');
    expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(mocks.confirmJob).not.toHaveBeenCalled(); nothingElseWasMade();
  });

  it('does not ask about the subject when it knows the business: it picks one from the business and starts at once', async () => {
    mocks.complete.mockResolvedValue(JSON.stringify(brief({ main_subject: 'general promotion of Somerset Pool Service', platform: 'general' })));
    const res = await say('Pilot, make me a video for Somerset.');
    expect(res.body.reply).toMatchObject({ kind: 'job', jobId: 'job-1' }); expect(mocks.startGeneration).toHaveBeenCalledTimes(1);
    expect(mocks.createJob.mock.calls[0][1].brief.main_subject).toBe('Pool closing'); // the business's first service
    expect(res.body.reply.message).toContain('You didn’t name a subject, so I chose “Pool closing”'); expect(res.body.reply.message).not.toContain('What should the video be about');
  });

  it('asks ONE question only when there is no subject and nothing to pick from', async () => {
    mocks.loadContext.mockResolvedValue({ ...context, business: { ...context.business, services: [], promotions: '' } });
    mocks.complete.mockResolvedValue(JSON.stringify(brief({ main_subject: 'general promotion of Somerset Pool Service', platform: 'general' })));
    const res = await say('Pilot, make me a video for Somerset.');
    expect(res.body.reply.kind).toBe('message'); expect(res.body.reply.message).toContain('What should the video be about?'); expect(mocks.startGeneration).not.toHaveBeenCalled();
  });

  it('“Make me a post for Somerset this weekend” makes the post at once: words and a visual, no brief, no questions, no video', async () => {
    mocks.loadInput.mockResolvedValue({ input: { brief: { businessName: 'Somerset Pool Service' } }, hasRealData: true });
    mocks.generatePiece.mockResolvedValue({ hook: 'Closing your pool?', caption: 'We handle it.', cta: 'Book today', hashtags: [], platform: 'instagram', kind: 'post', topic: 'x', suggestedVisual: 'v', postingFormat: 'f', evidence: [] });
    mocks.choosePostImage.mockResolvedValue(null);
    mocks.createContent.mockImplementation(async (_id: string, item: object) => ({ id: 'item-1', ...item }));
    const res = await say('Pilot, make me a post for Somerset this weekend.');
    expect(res.body.reply).toMatchObject({ kind: 'created', what: 'post' }); expect(res.body.reply.message).toContain('Here’s your Instagram post');
    expect(mocks.generatePiece).toHaveBeenCalledTimes(1); expect(mocks.choosePostImage).toHaveBeenCalledTimes(1);
    expect(mocks.loadContext).not.toHaveBeenCalled(); expect(mocks.createJob).not.toHaveBeenCalled(); expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(mocks.runwayStart).not.toHaveBeenCalled();
    expect(mocks.generatePiece.mock.calls[0][0].topic).toMatch(/Choose it yourself from what you know about the business/); // no subject named: Pilot picks from what it knows
  });

  it('tapping “Make it” on an idea card starts the free video too', async () => {
    mocks.ideas = { savedAt: 'now', ideas: [{ id: 'idea-1', title: 'Pool closing checklist', why: 'It is the season', format: 'video', platform: 'instagram', hook: 'h', cta: 'c', goal: 'g', evidence: [] }] };
    const res = await say('Make idea: Pool closing checklist', 'idea-1');
    expect(res.body.reply).toMatchObject({ kind: 'job' }); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); nothingElseWasMade();
  });

  it('still plans a week, and still answers greetings, as before', async () => {
    expect((await say('Plan my week')).body.reply.kind).toBe('plan_week');
    expect((await say('hello')).body.reply.kind).toBe('message'); expect(mocks.loadContext).not.toHaveBeenCalled();
  });

  describe('staying in the mode', () => {
    const job = (status: string, extra: Record<string, unknown> = {}) => ({ id: '9ffa3f34-0ba7-49ab-9808-0afdceb36948', status, userMessage: 'Make me a cinematic AI video about pool closing', brief: brief({ style: ['cinematic'] }), selection: null, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a', ...extra });
    it('“yes” to the Runway cost starts it with Runway, and hands the page a job to follow', async () => {
      mocks.latestJob.mockResolvedValue(job('brief_ready'));
      const res = await say('yes');
      expect(res.body.reply).toMatchObject({ kind: 'job', jobId: '9ffa3f34-0ba7-49ab-9808-0afdceb36948' }); expect(res.body.reply.message).toContain('Using Runway: this will cost about 144 Runway credits'); expect(mocks.available).toHaveBeenCalledWith('runway');
      expect(mocks.startGeneration).toHaveBeenCalledTimes(1); nothingElseWasMade();
    });
    it('answering “what is it about?” starts the free video', async () => {
      mocks.latestJob.mockResolvedValue(job('brief_ready', { userMessage: 'Make me a video for Somerset.', brief: brief({ main_subject: 'general promotion of Somerset Pool Service' }) }));
      const res = await say('pool closing');
      expect(res.body.reply.kind).toBe('job'); expect(res.body.reply.message).toContain('Creating a free animated video…'); expect(mocks.createJob.mock.calls[0][1].userMessage).toContain('It should be about: pool closing');
    });
    it('a change to a finished free video is made straight away, for free', async () => {
      mocks.latestJob.mockResolvedValue(job('ready', { userMessage: 'Make me a video about pool closing', brief: brief(), storyboard: { engine: 'animated', scenes: [], total_seconds: 15, caption: '', hashtags: [], cta: '' }, selection: { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'n', selected_at: 'x' }, result: { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4' } }));
      const res = await say('make the caption punchier');
      expect(res.body.reply.kind).toBe('job'); expect(res.body.reply.message).toContain('That’s free: no credits.'); expect(mocks.startGeneration).toHaveBeenCalledTimes(1);
    });
    it('stays a plain message when Runway is not connected, and offers the free version', async () => {
      mocks.latestJob.mockResolvedValue(job('brief_ready')); mocks.available.mockImplementation((engine: string) => engine === 'animated');
      const res = await say('yes');
      expect(res.body.reply.kind).toBe('message'); expect(res.body.reply.message).toContain('Runway isn’t connected on this server right now'); expect(res.body.reply.message).toContain('make it animated'); expect(mocks.startGeneration).not.toHaveBeenCalled();
    });
    it('does nothing special when there is no recent job, and a new request still starts a new job', async () => {
      const yes = await say('yes'); expect(yes.body.reply.kind).toBe('message'); expect(yes.body.reply.message).toContain('What would you like me to make?'); expect(mocks.confirmJob).not.toHaveBeenCalled(); expect(mocks.startGeneration).not.toHaveBeenCalled(); // a bare yes with nothing to confirm starts nothing
      mocks.latestJob.mockResolvedValue(job('brief_ready', { brief: brief() }));
      await say('Make me an Instagram video for our cupcakes');
      expect(mocks.createJob.mock.calls.at(-1)![1].brief.iteration_of).toBeNull();
    });
  });
});
