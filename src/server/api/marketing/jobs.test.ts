import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const mocks = vi.hoisted(() => ({ getJob: vi.fn(), finish: vi.fn(), progress: vi.fn(), generating: vi.fn(), tenant: { id: 'biz-1' } as { id: string } | null }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => { if (!mocks.tenant) { res.status(401).json({ error: 'Please sign in.' }); return null; } return mocks.tenant; }) }));
vi.mock('@/server/marketing/marketing-jobs.js', () => ({ getMarketingJob: (...a: unknown[]) => mocks.getJob(...a), finishJob: (...a: unknown[]) => mocks.finish(...a) }));
vi.mock('@/server/marketing/video-generation.js', () => ({ getGenerationProgress: (...a: unknown[]) => mocks.progress(...a), isGenerating: (...a: unknown[]) => mocks.generating(...a) }));
import handler from './jobs/[jobId]/GET';

const respond = () => ({ statusCode: 200, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const get = async (jobId: string) => { const res = respond(); await handler({ params: { jobId } } as unknown as Request, res as unknown as Response); return res; };
const job = (status: string, extra = {}) => ({ id: 'job-1', status, brief: { main_subject: 'pool closing' }, storyboard: { caption: 'Cap', hashtags: ['#a'], cta: 'Call', total_seconds: 15, scenes: [1, 2, 3, 4] }, result: null, ...extra });
beforeEach(() => { for (const spy of [mocks.getJob, mocks.finish, mocks.progress, mocks.generating]) spy.mockReset(); mocks.tenant = { id: 'biz-1' }; mocks.finish.mockResolvedValue(undefined); });

describe('GET /api/marketing/jobs/:jobId', () => {
  it('looks the job up for the signed-in business only, and requires sign-in', async () => {
    mocks.getJob.mockResolvedValue(job('confirmed')); await get('job-1');
    expect(mocks.getJob).toHaveBeenCalledWith('biz-1', 'job-1');
    mocks.getJob.mockClear(); mocks.tenant = null; const res = await get('job-1');
    expect(res.statusCode).toBe(401); expect(mocks.getJob).not.toHaveBeenCalled();
  });
  it('says not found for a job that is not this business’s', async () => {
    mocks.getJob.mockResolvedValue(null);
    const res = await get('someone-elses-job'); expect(res.statusCode).toBe(404); expect(res.body.error).toMatch(/not found/);
  });
  it('reports progress while the video is being made', async () => {
    mocks.getJob.mockResolvedValue(job('generating')); mocks.generating.mockReturnValue(true); mocks.progress.mockReturnValue({ phase: 'making', done: 2, total: 4, scenes: [] });
    const res = await get('job-1');
    expect(res.body).toMatchObject({ id: 'job-1', status: 'generating', subject: 'pool closing', progress: { phase: 'making', done: 2, total: 4 }, result: null });
  });
  it('returns the finished video and caption when it is ready', async () => {
    const result = { video_url: '/api/marketing/media/videos/abcdef12-3456-7890-abcd-ef1234567890.mp4', caption: 'Hello', hashtags: ['#a'], cta: 'Call', error: null };
    mocks.getJob.mockResolvedValue(job('ready', { result }));
    const res = await get('job-1'); expect(res.body).toMatchObject({ status: 'ready', progress: null, result }); expect(mocks.finish).not.toHaveBeenCalled();
  });
  it('says so, once, if the server restarted while the video was being made', async () => {
    mocks.getJob.mockResolvedValue(job('generating')); mocks.generating.mockReturnValue(false);
    const res = await get('job-1');
    expect(res.body.status).toBe('failed'); expect(res.body.result.error).toMatch(/server restarted/); expect(res.body.result.video_url).toBeNull();
    expect(mocks.finish).toHaveBeenCalledWith('biz-1', 'job-1', 'failed', expect.objectContaining({ error: expect.stringMatching(/server restarted/), caption: 'Cap' }));
  });
});
