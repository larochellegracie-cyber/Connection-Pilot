import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
import { cleanResult, confirmMarketingJob, createMarketingJob, finishJob, getMarketingJob, jobStatuses, latestActiveJob, listMarketingJobs, markJobGenerating, saveJobSelection, saveJobStoryboard } from './marketing-jobs';

const brief = { platform: 'tiktok' as const, content_type: 'video' as const, main_subject: 'new chocolate cake', style: ['dark'], length_seconds: 15, key_instructions: ['use our real photos'], iteration_of: null };
beforeEach(() => { state.queue.length = 0; state.updates.length = 0; state.inserts.length = 0; });

describe('Marketing Jobs', () => {
  it('saves the owner’s words and the brief for one business, with status brief_ready', async () => {
    const job = await createMarketingJob('biz-1', { userMessage: 'Make me a 15 second TikTok about our new chocolate cake', brief });
    expect(job).toMatchObject({ status: 'brief_ready', userMessage: 'Make me a 15 second TikTok about our new chocolate cake', brief });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0] as Record<string, string>;
    expect(row).toMatchObject({ id: job.id, businessProfileId: 'biz-1', status: 'brief_ready', userMessage: 'Make me a 15 second TikTok about our new chocolate cake' });
    expect(JSON.parse(row.briefJson)).toEqual(brief); // exactly the seven fields, as JSON
    expect(Object.keys(JSON.parse(row.briefJson)).sort()).toEqual(['content_type', 'iteration_of', 'key_instructions', 'length_seconds', 'main_subject', 'platform', 'style']);
  });
  it('stores a corrected brief, never a damaged one, and refuses nothing-like-a-brief', async () => {
    await createMarketingJob('biz-1', { userMessage: 'x', brief: { ...brief, platform: 'snapchat' as never, extra: 1 } as never });
    expect(JSON.parse((state.inserts[0] as Record<string, string>).briefJson)).toMatchObject({ platform: 'other' });
    expect(JSON.parse((state.inserts[0] as Record<string, string>).briefJson)).not.toHaveProperty('extra');
    await expect(createMarketingJob('biz-1', { userMessage: 'x', brief: null as never })).rejects.toThrow(/valid brief/);
  });
  it('reads a job back as the brief it saved, and skips a job whose brief is unreadable', async () => {
    const row = (id: string, briefJson: string) => ({ id, status: 'brief_ready', userMessage: 'm', briefJson, createdAt: new Date('2026-10-22T10:00:00Z'), updatedAt: null });
    state.queue.push([row('j1', JSON.stringify(brief))]);
    expect(await getMarketingJob('biz-1', 'j1')).toMatchObject({ id: 'j1', status: 'brief_ready', brief, createdAt: '2026-10-22T10:00:00.000Z' });
    state.queue.push([row('j2', 'not json')]); expect(await getMarketingJob('biz-1', 'j2')).toBeNull();
    state.queue.push([row('j1', JSON.stringify(brief)), row('j3', '{{')]); expect((await listMarketingJobs('biz-1')).map((j) => j.id)).toEqual(['j1']);
    state.queue.push([]); expect(await getMarketingJob('biz-1', 'missing')).toBeNull();
  });

  it('keeps iteration_of when a revised job is saved', async () => {
    const job = await createMarketingJob('biz-1', { userMessage: 'make it 20 seconds', brief: { ...brief, length_seconds: 20, iteration_of: '9ffa3f34-0ba7-49ab-9808-0afdceb36948' } });
    expect(job.brief.iteration_of).toBe('9ffa3f34-0ba7-49ab-9808-0afdceb36948'); expect(job.status).toBe('brief_ready');
    expect(JSON.parse((state.inserts[0] as Record<string, string>).briefJson).iteration_of).toBe('9ffa3f34-0ba7-49ab-9808-0afdceb36948');
  });
  it('confirms a job: status becomes "confirmed", and only the status changes', async () => {
    const row = { id: 'j1', status: 'confirmed', userMessage: 'm', briefJson: JSON.stringify(brief), createdAt: new Date('2026-10-22T10:00:00Z'), updatedAt: new Date('2026-10-22T10:05:00Z') };
    state.queue.push([row]);
    const job = await confirmMarketingJob('biz-1', 'j1');
    expect(state.updates).toEqual([{ status: 'confirmed' }]); expect(job).toMatchObject({ id: 'j1', status: 'confirmed', brief });
  });
  it('finds the newest recent job for a business, or nothing', async () => {
    const row = (status: string) => ({ id: 'j9', status, userMessage: 'm', briefJson: JSON.stringify(brief), createdAt: new Date(), updatedAt: new Date() });
    state.queue.push([row('brief_ready')]); expect(await latestActiveJob('biz-1')).toMatchObject({ id: 'j9', status: 'brief_ready' });
    state.queue.push([row('confirmed')]); expect(await latestActiveJob('biz-1')).toMatchObject({ status: 'confirmed' });
    state.queue.push([]); expect(await latestActiveJob('biz-1')).toBeNull();
  });

  it('saves the asset selection on the job (only that column), and reads it back; a new job has none', async () => {
    expect((await createMarketingJob('biz-1', { userMessage: 'x', brief })).selection).toBeNull();
    state.updates.length = 0;
    const selection = { selected_assets: [{ id: 'asset-0001', label: 'Fall menu', description: '', type: 'photo' as const, reason: 'Its label mentions “menu”.', score: 3 }], has_good_match: true, fallback_needed: false, note: 'One of your files fits “fall menu”.', selected_at: '2026-10-23T12:00:00.000Z' };
    await saveJobSelection('biz-1', 'j1', selection);
    expect(state.updates).toEqual([{ selectionJson: JSON.stringify(selection) }]);
    const row = { id: 'j1', status: 'confirmed', userMessage: 'm', briefJson: JSON.stringify(brief), selectionJson: JSON.stringify(selection), createdAt: new Date(), updatedAt: new Date() };
    state.queue.push([row]); expect((await getMarketingJob('biz-1', 'j1'))!.selection).toEqual(selection);
    state.queue.push([{ ...row, selectionJson: 'not json' }]); expect((await getMarketingJob('biz-1', 'j1'))!.selection).toBeNull(); // unreadable = not made yet
    state.queue.push([{ ...row, selectionJson: null }]); expect((await getMarketingJob('biz-1', 'j1'))!.selection).toBeNull();
  });

  it('has the statuses a video goes through', () => { expect([...jobStatuses]).toEqual(['brief_ready', 'confirmed', 'generating', 'ready', 'failed']); });
  it('moves a job to "generating" (clearing any old result), saves the storyboard, and finishes it ready or failed, each changing only its own columns', async () => {
    state.updates.length = 0;
    await markJobGenerating('biz-1', 'j1');
    const storyboard = { scenes: [{ role: 'hook', kind: 'clip', seconds: 4, description: 'd', prompt: 'p', reference_asset_id: null, on_screen_text: '' }], total_seconds: 4, direction: { camera: 'c', lighting: 'l', mood: 'm' }, caption: 'c', hashtags: [], cta: '' };
    await saveJobStoryboard('biz-1', 'j1', storyboard as never);
    const result = { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'Hello', hashtags: ['#a'], cta: 'Call', total_seconds: 15, scene_count: 4, provider: 'Runway', estimated_credits: 150, music: 'Dark cinematic: a low drone and slow pulse, 84 BPM', engine: 'runway' as const, library_item_id: 'lib-0001', error: null, finished_at: '2026-10-23T12:00:00.000Z' };
    await finishJob('biz-1', 'j1', 'ready', result); await finishJob('biz-1', 'j1', 'failed', { ...result, video_url: null, error: 'It failed.' });
    expect(state.updates).toEqual([{ status: 'generating', resultJson: null }, { storyboardJson: JSON.stringify(storyboard) }, { status: 'ready', resultJson: JSON.stringify(result) }, { status: 'failed', resultJson: JSON.stringify({ ...result, video_url: null, error: 'It failed.' }) }]);
  });
  it('reads back the storyboard and result, and only accepts a secure or own-app link as the video', async () => {
    const result = { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'Hi', hashtags: ['#a'], cta: 'Call', total_seconds: 15, scene_count: 4, provider: 'Runway', estimated_credits: null, music: 'Soft and elegant', library_item_id: null, error: null, finished_at: 'x' };
    const row = { id: 'j1', status: 'ready', userMessage: 'm', briefJson: JSON.stringify(brief), selectionJson: null, storyboardJson: JSON.stringify({ scenes: [{ role: 'hook' }], total_seconds: 4 }), resultJson: JSON.stringify(result), createdAt: new Date(), updatedAt: new Date() };
    state.queue.push([row]); const job = (await getMarketingJob('biz-1', 'j1'))!;
    expect(job.status).toBe('ready'); expect(job.storyboard!.scenes).toHaveLength(1); expect(job.result).toMatchObject({ video_url: result.video_url, caption: 'Hi', hashtags: ['#a'], provider: 'Runway', music: 'Soft and elegant' });
    for (const bad of ['http://evil.example/a.mp4', 'javascript:alert(1)', '/etc/passwd', '/api/marketing/media/videos/../x.mp4', 7]) expect(cleanResult({ ...result, video_url: bad })!.video_url).toBeNull();
    expect(cleanResult({ ...result, video_url: 'https://cdn.example.com/v.mp4' })!.video_url).toBe('https://cdn.example.com/v.mp4');
    expect(cleanResult(null)).toBeNull();
    state.queue.push([{ ...row, storyboardJson: 'nope', resultJson: 'nope' }]); const damaged = (await getMarketingJob('biz-1', 'j1'))!; expect(damaged.storyboard).toBeNull(); expect(damaged.result).toBeNull();
  });

  it('keeps the line breaks of a caption when a result is read back (hook, body and call to action stay on separate lines)', () => {
    const caption = 'Hook line?\n\nBody line one.\nBody line two.\n\n\n\nCall (519) 982-4901.';
    const result = cleanResult({ video_url: null, caption, hashtags: [], cta: '', total_seconds: 6, scene_count: 3, provider: 'Runway', estimated_credits: 0, music: null, library_item_id: null, error: null, finished_at: 'x' })!;
    expect(result.caption).toBe('Hook line?\n\nBody line one.\nBody line two.\n\nCall (519) 982-4901.');
    expect(cleanResult({ caption: 'a   b \n  c\r\nd' })!.caption).toBe('a b\nc\nd'); // spaces are tidied, breaks are kept
  });

  it('records how a video was made: animated (free) or Runway; a result with no engine is Runway', () => {
    const base = { video_url: null, caption: 'c', hashtags: [], cta: '', total_seconds: 6, scene_count: 3, provider: 'x', estimated_credits: 0, music: null, library_item_id: null, error: null, finished_at: 'x' };
    expect(cleanResult({ ...base, engine: 'animated' })!.engine).toBe('animated'); expect(cleanResult({ ...base, engine: 'runway' })!.engine).toBe('runway');
    expect(cleanResult(base)!.engine).toBe('runway'); expect(cleanResult({ ...base, engine: 'weird' })!.engine).toBe('runway'); // videos made before the free path existed were all Runway
  });
});
