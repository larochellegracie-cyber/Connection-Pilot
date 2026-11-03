import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const mocks = vi.hoisted(() => ({ loadContext: vi.fn(), createJob: vi.fn(), confirmJob: vi.fn(), latest: vi.fn(), saveSelection: vi.fn(), available: vi.fn(), startGeneration: vi.fn(), getJob: vi.fn() }));
vi.mock('./creative-context.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./creative-context.js')>()), loadCreativeContext: (...a: unknown[]) => mocks.loadContext(...a) }));
vi.mock('./marketing-jobs.js', () => ({ createMarketingJob: (...a: unknown[]) => mocks.createJob(...a), confirmMarketingJob: (...a: unknown[]) => mocks.confirmJob(...a), latestActiveJob: (...a: unknown[]) => mocks.latest(...a), saveJobSelection: (...a: unknown[]) => mocks.saveSelection(...a) }));
vi.mock('./video-generation.js', async () => {
  const { engineFor } = await import('./video-engine');
  const engineOf = (job: { storyboard?: { engine?: string } } | null) => (job?.storyboard ? (job.storyboard.engine ?? 'runway') : null);
  return { engineAvailable: (engine: string) => mocks.available(engine), startVideoGeneration: (...a: unknown[]) => mocks.startGeneration(...a), engineOf, engineForJob: async (_t: string, job: { userMessage: string; brief: { style: string[]; iteration_of: string | null } }) => engineFor({ message: job.userMessage, style: job.brief.style, earlier: job.brief.iteration_of ? engineOf(await mocks.getJob(job.brief.iteration_of)) as 'animated' | 'runway' | null : null }) };
});
import { handleModeFollowUp } from './creative-followup';

const tenant = { id: 'biz-1', businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' };
const brief = { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['bright', 'calm'], length_seconds: 15, key_instructions: [] as string[], iteration_of: null as string | null };
const generic = { ...brief, main_subject: 'general promotion of Somerset Pool Service' };
const sel = { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'None of your 1 file fit “pool closing” well. “Pouring salt into a pool” doesn’t relate to it.', selected_at: 'x' };
const job = (status: string, extra: Record<string, unknown> = {}) => ({ id: 'job-1', status, userMessage: 'Make me a 15 second TikTok about pool closing', brief, selection: null, storyboard: null, result: null, createdAt: 'a', updatedAt: 'a', ...extra }) as any;
const scene = (role: string, kind: string, seconds: number, clip: string | null) => ({ role, kind, seconds, description: `${role} scene`, prompt: kind === 'clip' ? 'p' : null, reference_asset_id: null, on_screen_text: kind === 'clip' ? '' : 'Book today', clip_video_id: clip });
const board = (engine?: 'animated' | 'runway') => ({ scenes: [scene('hook', 'clip', 4, 'clip-hook-001'), scene('main', 'clip', 4, 'clip-main-001'), scene('support', 'clip', 4, 'clip-supp-001'), scene('ending', 'end_card', 3, null)], total_seconds: 15, direction: { camera: 'c', lighting: 'l', mood: 'm' }, caption: 'cap', hashtags: [], cta: '', grade: 0, ...(engine ? { engine } : {}) });
const readyJob = (engine?: 'animated' | 'runway', extra: Record<string, unknown> = {}) => job('ready', { storyboard: board(engine), selection: sel, result: { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'cap', hashtags: [], cta: '', total_seconds: 15, scene_count: 4, provider: engine === 'animated' ? 'Pilot animation' : 'Runway', estimated_credits: 0, music: 'Soft', engine: engine ?? 'runway', library_item_id: 'lib-0001', error: null, finished_at: 'x' }, ...extra });
const context = { business: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', services: ['Pool closing'], promotions: '', brandVoice: { tone: '' }, websiteNotes: [] }, brand: { name: 'Somerset Pool Service' }, media: { all: [{ id: '53afcf40-e496-4677-ae65-0c0d0cb813c0', kind: 'product', originalName: 'p.png', label: 'Pouring salt into a pool', description: '', tags: [], mime: 'image/png', width: 10, height: 10, bytes: 1, createdAt: '2026-10-22T10:00:00Z', link: '/x' }], photos: [{ label: 'Pouring salt into a pool' }], logos: [], videos: [] }, gaps: [] };
const noAi = vi.fn(async () => { throw new Error('down'); }); // the AI is down: the plain readings are used
const briefReply = (over: Record<string, unknown> = {}) => JSON.stringify({ ...brief, ...over });
beforeEach(() => {
  for (const spy of Object.values(mocks)) spy.mockReset(); noAi.mockClear();
  mocks.loadContext.mockResolvedValue(context); mocks.available.mockReturnValue(true); mocks.startGeneration.mockResolvedValue({ started: true }); mocks.saveSelection.mockResolvedValue(undefined); mocks.getJob.mockResolvedValue(null);
  mocks.createJob.mockImplementation(async (_id: string, input: object) => ({ id: 'job-2', status: 'brief_ready', selection: null, storyboard: null, result: null, createdAt: 'b', updatedAt: 'b', ...input }));
  mocks.confirmJob.mockImplementation(async (_t: string, id: string) => ({ ...(mocks.createJob.mock.results.at(-1) ? await mocks.createJob.mock.results.at(-1)!.value : job('confirmed')), id, status: 'confirmed' }));
  mocks.latest.mockResolvedValue(job('brief_ready'));
  vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
const go = (message: string, ai: (s: string, p: string) => Promise<string> = noAi, format: 'plain' | 'markdown' = 'plain') => handleModeFollowUp({ tenant, message, format, complete: ai });

describe('Runway: a yes starts it, and the reply says which path and what it costs', () => {
  const runwayJob = (status = 'brief_ready', extra = {}) => job(status, { userMessage: 'Make me a cinematic AI video about pool closing', brief: { ...brief, style: ['cinematic'] }, ...extra });
  it.each(['yes', 'looks good', 'go ahead', 'make it'])('“%s” confirms, picks the media, and starts it with Runway, saying what it will cost', async (text) => {
    mocks.latest.mockResolvedValue(runwayJob());
    const result = (await go(text))!;
    expect(result.outcome).toBe('confirmed'); expect(mocks.confirmJob).toHaveBeenCalledWith('biz-1', 'job-1'); expect(mocks.saveSelection).toHaveBeenCalledTimes(1);
    expect(mocks.available).toHaveBeenCalledWith('runway'); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(result.showJob).toBe(true); expect(result.job.status).toBe('generating');
    expect(result.reply).toContain('Marketing Creative Mode: confirmed. This brief is locked in:'); expect(result.reply).toContain('Using Runway: this will cost about 144 Runway credits. I’ll plan about 4 short scenes'); expect(result.reply).not.toMatch(/\*\*|free animated/);
  });
  it('says Runway is not connected, and offers the free version, instead of starting', async () => {
    mocks.latest.mockResolvedValue(runwayJob()); mocks.available.mockImplementation((engine: string) => engine === 'animated');
    const result = (await go('yes'))!;
    expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.showJob).toBe(false); expect(result.reply).toContain('Runway isn’t connected on this server right now, so I haven’t made it. Say “make it animated” and I’ll make the free animated version instead.');
  });
  it('does not start without a selection (the media could not be checked)', async () => {
    mocks.latest.mockResolvedValue(runwayJob()); mocks.loadContext.mockRejectedValue(new Error('storage down'));
    const result = (await go('yes'))!;
    expect(result.showJob).toBe(false); expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.reply).toContain('I couldn’t check your photos just now, so I haven’t picked any yet.');
  });
  it('says so, and does not repeat itself, if the job was already confirmed with its selection', async () => {
    mocks.latest.mockResolvedValue(runwayJob('confirmed', { selection: sel }));
    const result = (await go('yes'))!;
    expect(result.outcome).toBe('already_confirmed'); expect(mocks.confirmJob).not.toHaveBeenCalled(); expect(mocks.saveSelection).not.toHaveBeenCalled(); expect(result.reply).toContain('This brief is already confirmed'); expect(mocks.startGeneration).toHaveBeenCalledTimes(1);
  });
  it('tries again when the owner confirms after a failure', async () => {
    mocks.latest.mockResolvedValue(runwayJob('failed', { selection: sel }));
    expect((await go('yes'))!.showJob).toBe(true); expect(mocks.startGeneration).toHaveBeenCalledTimes(1);
  });
  it('does not start a second video while one is being made, and shows the finished one when it is ready', async () => {
    mocks.latest.mockResolvedValue(job('generating'));
    const busy = (await go('yes'))!; expect(busy.reply).toContain('I’m already making this video'); expect(busy.showJob).toBe(true); expect(mocks.startGeneration).not.toHaveBeenCalled();
    mocks.latest.mockResolvedValue(job('ready'));
    const done = (await go('yes'))!; expect(done.reply).toContain('This video is already made'); expect(done.showJob).toBe(true); expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('“make it animated” on a Runway brief switches to the free way and starts at once', async () => {
    mocks.latest.mockResolvedValue(runwayJob());
    const result = (await go('make it animated'))!;
    expect(mocks.createJob.mock.calls[0][1]).toMatchObject({ userMessage: 'make it animated', brief: { iteration_of: 'job-1' } });
    expect(result.showJob).toBe(true); expect(mocks.available).toHaveBeenCalledWith('animated'); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(result.reply).toContain('Creating a free animated video…'); expect(result.reply).not.toContain('Using Runway');
  });
});

describe('answering “what should the video be about?”', () => {
  beforeEach(() => { mocks.latest.mockResolvedValue(job('brief_ready', { brief: generic, userMessage: 'Make me a video for Somerset.' })); });
  it('treats the next short message as the subject, makes a new brief from both, and starts the free video', async () => {
    const complete = vi.fn(async (_s: string, _p: string) => briefReply());
    const result = (await go('pool closing', complete))!;
    expect(complete.mock.calls[0][1]).toContain('Make me a video for Somerset. It should be about: pool closing');
    expect(mocks.createJob).toHaveBeenCalledWith('biz-1', { userMessage: 'Make me a video for Somerset. It should be about: pool closing', brief: expect.objectContaining({ main_subject: 'pool closing', iteration_of: 'job-1' }) });
    expect(mocks.confirmJob).toHaveBeenCalled(); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(result.showJob).toBe(true); expect(result.reply).toContain('Creating a free animated video…'); expect(result.reply).toContain('• About: pool closing');
  });
  it('asks again if the answer still names nothing', async () => {
    const result = (await go('whatever', async () => briefReply({ main_subject: 'general promotion of Somerset Pool Service' })))!;
    expect(result.outcome).toBe('asked'); expect(result.reply).toContain('What should the video be about?'); expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('asks again if they just say yes', async () => {
    const result = (await go('yes'))!;
    expect(result.outcome).toBe('asked'); expect(result.reply).toContain('What should the video be about?'); expect(mocks.createJob).not.toHaveBeenCalled(); expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('leaves a brand-new request, a question, or a long message alone', async () => {
    for (const text of ['Make me an Instagram post for our cupcakes', 'Who is working tomorrow?', 'I think what I really want is a video about how we close pools and what the process looks like for our customers this fall']) expect(await go(text)).toBeNull();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
  it('accepts “surprise me” as the answer, and starts', async () => {
    const result = (await go('surprise me', async () => briefReply({ main_subject: 'general promotion of Somerset Pool Service', style: ['surprise me'] })))!;
    expect(result.showJob).toBe(true);
  });
});

describe('everything else is left alone', () => {
  it.each(['Make me an Instagram post for our cupcakes', 'Who is working tomorrow?', 'hello'])('“%s” is not a follow-up: null, nothing saved', async (text) => {
    mocks.latest.mockResolvedValue(job('brief_ready'));
    expect(await go(text)).toBeNull(); expect(mocks.createJob).not.toHaveBeenCalled(); expect(mocks.confirmJob).not.toHaveBeenCalled(); expect(mocks.startGeneration).not.toHaveBeenCalled();
  });
  it('does nothing when there is no recent job', async () => {
    mocks.latest.mockResolvedValue(null);
    expect(await go('yes')).toBeNull(); expect(await go('make it darker')).toBeNull(); expect(await go('pool closing')).toBeNull(); expect(mocks.createJob).not.toHaveBeenCalled();
  });
});

describe('changing a video before it is made', () => {
  it('a change to a clear free brief makes a new job pointing at the old one, shows what changed, and starts at once', async () => {
    mocks.latest.mockResolvedValue(job('confirmed'));
    const result = (await go('make it 20 seconds'))!;
    expect(mocks.createJob.mock.calls[0][1]).toMatchObject({ userMessage: 'make it 20 seconds', brief: { length_seconds: 20, iteration_of: 'job-1' } });
    expect(result.reply).toContain('Here’s the updated brief:'); expect(result.reply).toContain('What changed: length: 15s → 20s.'); expect(result.reply).toContain('Creating a free animated video…'); expect(result.showJob).toBe(true);
  });
  it('a change to a Runway brief shows the cost again and waits', async () => {
    mocks.latest.mockResolvedValue(job('brief_ready', { userMessage: 'Make me a cinematic AI video about pool closing', brief: { ...brief, style: ['cinematic'] } }));
    const result = (await go('make it 20 seconds'))!;
    expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.showJob).toBe(false); expect(result.reply).toContain('Cost: Using Runway: this will cost about 204 Runway credits (17 seconds of AI-generated footage).');
  });
});

describe('changing a video that is already made', () => {
  beforeEach(() => { mocks.latest.mockResolvedValue(readyJob('animated')); });
  const started = () => mocks.startGeneration.mock.calls[0][0] as { job: any };

  it('a free animated video is changed for free, straight away: caption, ending, music, or the whole look', async () => {
    const caption = (await go('make the caption punchier'))!;
    expect(caption.showJob).toBe(true); expect(started().job).toMatchObject({ id: 'job-2', status: 'confirmed', selection: sel, brief: { iteration_of: 'job-1' } }); expect(mocks.saveSelection).toHaveBeenCalledWith('biz-1', 'job-2', sel);
    expect(caption.reply).toContain('Absolutely. I’ll write a new caption and keep the video exactly as it is. That’s free: no credits. I’m working on it now, and it will show here as soon as it’s ready.');
    for (const [message, expected] of [['change the ending', 'I’ll redo only the ending'], ['make the music more dramatic', 'I’ll put new music under the same video'], ['make it more fun', 'I’ll make the whole video again (The look changed']] as const) {
      mocks.startGeneration.mockClear(); mocks.latest.mockResolvedValue(readyJob('animated'));
      const result = (await go(message))!; expect(result.showJob).toBe(true); expect(mocks.startGeneration).toHaveBeenCalledTimes(1); expect(result.reply).toContain(expected); expect(result.reply).toMatch(/That’s free: no credits\./); expect(result.reply).not.toMatch(/Runway credits/);
    }
  });
  it('a Runway video changes for free when no new footage is needed (a new caption), and the reply says so in the shared wording', async () => {
    mocks.latest.mockResolvedValue(readyJob('runway'));
    const result = (await go('make the caption punchier'))!;
    expect(result.showJob).toBe(true); expect(result.reply).toContain('That uses no Runway credits.'); expect(mocks.available).toHaveBeenCalledWith('runway');
  });
  it('a Runway change that needs new footage is explained with its cost and waits for a yes', async () => {
    mocks.latest.mockResolvedValue(readyJob('runway'));
    const result = (await go('make the product shot longer'))!;
    expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.showJob).toBe(false); expect(result.job.status).toBe('brief_ready');
    expect(result.reply).toContain('What I would do: I’ll redo only the main shot (6 seconds), and keep the other scenes, the music and the caption. That uses about 72 Runway credits.'); expect(result.reply).toContain('Say yes and I’ll go ahead, or tell me what else to change.');
    const whole = (await go('make it more fun'))!; expect(whole.reply).toMatch(/I’ll make the whole video again \(The look changed.*\)\. That uses about 144 Runway credits\./);
  });
  it('“make it animated” on a Runway video remakes it the free way, at once', async () => {
    mocks.latest.mockResolvedValue(readyJob('runway'));
    const result = (await go('make it animated'))!;
    expect(result.showJob).toBe(true); expect(mocks.available).toHaveBeenCalledWith('animated'); expect(result.reply).toContain('I’ll make the whole video again as a free animated video. That’s free: no credits.');
  });
  it('“make it cinematic” on a free video switches to Runway: the cost is shown and it waits', async () => {
    const result = (await go('make it cinematic'))!;
    expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.showJob).toBe(false); expect(result.reply).toContain('Using Runway: this will cost about 144 Runway credits');
  });
  it('a free video does not turn premium just because its brief still says “cinematic”', async () => {
    mocks.latest.mockResolvedValue(readyJob('animated', { brief: { ...brief, style: ['bright', 'cinematic'] } }));
    const result = (await go('make the caption punchier'))!;
    expect(result.showJob).toBe(true); expect(result.reply).not.toContain('Using Runway'); expect(mocks.available).toHaveBeenCalledWith('animated');
  });
  it('shows the plan instead of starting when the video encoder is not available', async () => {
    mocks.available.mockReturnValue(false);
    const result = (await go('make the caption punchier'))!;
    expect(mocks.startGeneration).not.toHaveBeenCalled(); expect(result.showJob).toBe(false); expect(result.reply).toContain('What I would do: I’ll write a new caption');
  });
  it('a video made before the free path existed (no engine saved) is a Runway video', async () => {
    mocks.latest.mockResolvedValue(readyJob(undefined));
    const result = (await go('make the product shot longer'))!;
    expect(result.showJob).toBe(false); expect(result.reply).toContain('Runway credits');
  });
});
