import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const mocks = vi.hoisted(() => ({ loadContext: vi.fn(), createJob: vi.fn(), confirmJob: vi.fn(), saveSelection: vi.fn(), available: vi.fn(), startGeneration: vi.fn(), getJob: vi.fn() }));
vi.mock('./creative-context.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./creative-context.js')>()), loadCreativeContext: (...a: unknown[]) => mocks.loadContext(...a) }));
vi.mock('./marketing-jobs.js', () => ({ createMarketingJob: (...a: unknown[]) => mocks.createJob(...a), confirmMarketingJob: (...a: unknown[]) => mocks.confirmJob(...a), saveJobSelection: (...a: unknown[]) => mocks.saveSelection(...a), latestActiveJob: vi.fn() }));
vi.mock('./video-generation.js', async () => {
  const { engineFor } = await import('./video-engine');
  const engineOf = (job: { storyboard?: { engine?: string } } | null) => (job?.storyboard ? (job.storyboard.engine ?? 'runway') : null);
  return { engineAvailable: (engine: string) => mocks.available(engine), startVideoGeneration: (...a: unknown[]) => mocks.startGeneration(...a), engineOf, engineForJob: async (_t: string, job: { userMessage: string; brief: { style: string[]; iteration_of: string | null } }) => engineFor({ message: job.userMessage, style: job.brief.style, earlier: job.brief.iteration_of ? engineOf(await mocks.getJob(job.brief.iteration_of)) as 'animated' | 'runway' | null : null }) };
});
import { enterCreativeMode } from './creative-mode';

const tenant = { id: 'biz-1', businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' };
const photo = { id: '53afcf40-e496-4677-ae65-0c0d0cb813c0', kind: 'product', originalName: 'p.png', label: 'Pouring salt into a pool', description: '', tags: [], mime: 'image/png', width: 10, height: 10, bytes: 1, createdAt: '2026-10-22T10:00:00Z', link: '/x' };
const context = { business: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', services: ['Pool closing'], promotions: '', brandVoice: { tone: 'Friendly' }, websiteNotes: ['a page'] }, brand: { name: 'Somerset Pool Service' }, media: { all: [photo], photos: [{ label: 'Pouring salt into a pool' }], logos: [], videos: [] }, gaps: ['No logo has been added.'] };
const brief = (over: Record<string, unknown> = {}) => JSON.stringify({ platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'fast'], length_seconds: 15, key_instructions: [], iteration_of: null, ...over });
const FIRST = 'Make me a 15 second TikTok about pool closing. Dark and fast.';
beforeEach(() => {
  for (const spy of Object.values(mocks)) spy.mockReset();
  mocks.loadContext.mockResolvedValue(context); mocks.available.mockReturnValue(true); mocks.startGeneration.mockResolvedValue({ started: true }); mocks.saveSelection.mockResolvedValue(undefined); mocks.getJob.mockResolvedValue(null);
  mocks.createJob.mockImplementation(async (_id: string, input: object) => ({ id: 'job-1', status: 'brief_ready', selection: null, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a', ...input }));
  mocks.confirmJob.mockImplementation(async (_id: string, id: string) => ({ ...(await mocks.createJob.mock.results.at(-1)!.value), id, status: 'confirmed' }));
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
const go = (message: string, ai: (system: string, prompt: string) => Promise<string> = async () => brief(), format: 'plain' | 'markdown' = 'plain') => enterCreativeMode({ tenant, message, format, complete: ai });

describe('a clear request starts at once, the free way', () => {
  it('reads the brief, saves the job, confirms it itself, picks the owner’s media, and starts: no question asked', async () => {
    const complete = vi.fn(async (_s: string, _p: string) => brief({ main_subject: 'adding salt to your pool' }));
    const result = await go('Make me a 15 second TikTok about adding salt to your pool.', complete);
    expect(complete).toHaveBeenCalledTimes(1); // the only AI call here: reading the request
    expect(mocks.createJob).toHaveBeenCalledTimes(1); expect(mocks.confirmJob).toHaveBeenCalledWith('biz-1', 'job-1');
    expect(mocks.saveSelection.mock.calls[0].slice(0, 2)).toEqual(['biz-1', 'job-1']); expect(mocks.saveSelection.mock.calls[0][2]).toMatchObject({ has_good_match: true, selected_assets: [{ label: 'Pouring salt into a pool' }] });
    expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(mocks.startGeneration.mock.calls[0][0].job).toMatchObject({ id: 'job-1', status: 'confirmed', userMessage: 'Make me a 15 second TikTok about adding salt to your pool.' });
    expect(result.showJob).toBe(true); expect(result.job).toMatchObject({ id: 'job-1', status: 'generating' });
    expect(result.reply).toContain('Marketing Creative Mode is on. Here’s what I understood:'); expect(result.reply).toContain('• About: adding salt to your pool');
    expect(result.reply).toContain('I plan to use this photo of yours:'); expect(result.reply).toContain('Creating a free animated video… I’ll use your photos where they fit, your brand colours, text and motion, and original music. It uses no Runway credits and takes about a minute.');
    expect(result.reply).not.toMatch(/Does this look right|Say yes|Using Runway|\*\*/);
  });
  it('says no photo fits, and still starts, when none matches the subject', async () => {
    const result = await go(FIRST);
    expect(result.showJob).toBe(true); expect(result.reply).toContain('None of your 1 file fit “pool closing” well.'); expect(result.reply).toContain('Creating a free animated video…');
  });
  it('uses the plain-code reading and still starts when the AI cannot be reached', async () => {
    const result = await go(FIRST, async () => { throw new Error('down'); });
    expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(result.brief).toMatchObject({ platform: 'tiktok', content_type: 'video', length_seconds: 15 }); expect(result.showJob).toBe(true);
  });
  it('has defaults for everything but the subject: no length, no platform and no style do not stop it', async () => {
    const result = await go('Make me a video about pool closing', async () => brief({ platform: 'general', length_seconds: null, style: [] }));
    expect(result.showJob).toBe(true); expect(result.reply).toContain('• Platform: no platform named'); expect(result.reply).toContain('• Style: not specified, so I would choose'); expect(mocks.startGeneration).toHaveBeenCalled();
  });
  it('shows bold labels in the Pilot chat and plain text on the Marketing page', async () => {
    expect((await go(FIRST, undefined, 'markdown')).reply).toContain('**Marketing Creative Mode is on.**'); expect((await go(FIRST, undefined, 'plain')).reply).not.toMatch(/\*\*/);
  });
  it('says so honestly, and does not claim to be making anything, if it cannot start', async () => {
    mocks.startGeneration.mockResolvedValue({ started: false });
    const result = await go(FIRST);
    expect(result.showJob).toBe(false); expect(result.reply).not.toContain('Creating a free animated video…');
    mocks.available.mockReturnValue(false);
    const none = await go(FIRST); expect(none.showJob).toBe(false); expect(none.reply).toContain('Making videos isn’t available on this server right now, so I haven’t made it.');
  });
  it('says so, and starts nothing, if the job could not be saved', async () => {
    mocks.createJob.mockRejectedValue(new Error('db down'));
    const result = await go(FIRST);
    expect(result.job).toBeNull(); expect(result.showJob).toBe(false); expect(result.reply).toContain('I couldn’t save this request just now'); expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('does not start when the media cannot be checked', async () => {
    mocks.loadContext.mockResolvedValueOnce(context).mockRejectedValueOnce(new Error('storage down'));
    const result = await go(FIRST);
    expect(result.showJob).toBe(false); expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.reply).toContain('I couldn’t check your photos just now, so I haven’t started.');
  });
});

describe('the premium look (Runway) shows its cost and waits for a yes', () => {
  it.each(['Make me a cinematic video about pool closing', 'Make me an AI video about pool closing', 'Use Runway to make a video about pool closing', 'Make a realistic video about pool closing'])('%s', async (message) => {
    const result = await go(message, async () => brief({ style: message.includes('cinematic') ? ['cinematic'] : ['ai'] }));
    expect(result.showJob).toBe(false); expect(mocks.confirmJob).not.toHaveBeenCalled(); expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.job!.status).toBe('brief_ready');
    expect(result.reply).toContain('Cost: Using Runway: this will cost about 144 Runway credits (12 seconds of AI-generated footage). The caption, the music and the ending card cost nothing extra. Say yes to go ahead, or say “make it animated” for the free version.');
    expect(result.reply).toContain('I haven’t made anything yet. Does this look right?'); expect(result.reply).not.toContain('Creating a free animated video');
  });
  it('is Runway only for those words: the same request without them is free', async () => {
    expect((await go('Make me a video about pool closing', async () => brief({ style: [] }))).showJob).toBe(true);
  });
});

describe('a request with no subject', () => {
  it('uses what Pilot knows about the business instead of asking, and starts at once', async () => {
    const result = await go('Pilot, make me a video for Somerset.', async () => brief({ main_subject: 'general promotion of Somerset Pool Service', platform: 'general', length_seconds: null, style: [] }));
    expect(result.showJob).toBe(true); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(result.brief.main_subject).toBe('Pool closing');
    expect(result.reply).toContain('You didn’t name a subject, so I chose “Pool closing” from what I know about your business.'); expect(result.reply).not.toContain('What should the video be about');
  });
  it('asks one question only when there is nothing about the business to pick from', async () => {
    mocks.loadContext.mockResolvedValue({ ...context, business: { ...context.business, services: [], promotions: '' } });
    const result = await go('Pilot, make me a video for Somerset.', async () => brief({ main_subject: 'general promotion of Somerset Pool Service', platform: 'general', length_seconds: null, style: [] }));
    expect(result.showJob).toBe(false); expect(mocks.confirmJob).not.toHaveBeenCalled(); expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.job!.status).toBe('brief_ready');
    expect(result.reply).toContain('Marketing Creative Mode is on. I need one thing before I start.'); expect(result.reply).toContain('What should the video be about? For example: a service you offer, a seasonal reminder, a special or promotion. Or say “surprise me”.'); expect(result.reply).not.toMatch(/\*\*/);
  });
  it('does not ask when the owner said “surprise me”', async () => {
    const result = await go('Make me something creative for this weekend. Surprise me.', async () => brief({ main_subject: 'general promotion of Somerset Pool Service', style: ['surprise me'] }));
    expect(result.showJob).toBe(true);
  });
  it('suggests general ideas when the business has no services on file', async () => {
    mocks.loadContext.mockResolvedValue({ ...context, business: { ...context.business, services: [] } });
    expect((await go('Make me a video', async () => brief({ main_subject: '' }))).reply).toContain('For example: a service you offer, a seasonal reminder, a special or promotion.');
  });
});
