import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

const mocks = vi.hoisted(() => ({ tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: mocks.tenantId, businessName: 'Somerset Pool', businessType: 'service' })), textValue: (v: unknown) => (typeof v === 'string' ? v : '') }));
vi.mock('@/server/marketing/store.js', () => ({ loadBrandKit: vi.fn(async () => ({ name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null })) }));

import mediaHandler from './videos/[file]/GET';
import sampleHandler from '../standard-video/sample/POST';
import statusHandler from '../standard-video/[taskId]/GET';
import { standardProvider } from '@/server/marketing/standard-video/provider';
import { ffmpegAvailable } from '@/server/marketing/standard-video/ffmpeg';
import { resetJobsForTests } from '@/server/marketing/standard-video/jobs';
import { LocalVolumeStorage, setMediaStorage } from '@/server/marketing/standard-video/storage';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function respond() {
  const out = new PassThrough(); const chunks: Buffer[] = [];
  out.on('data', (chunk) => chunks.push(chunk));
  const res = Object.assign(out, { statusCode: 200, headers: {} as Record<string, string>, body: undefined as any, headersSent: false,
    status(code: number) { res.statusCode = code; return res; }, json(payload: unknown) { res.body = payload; out.end(); return res; }, set() { return res; },
    setHeader(name: string, value: string) { res.headers[name] = String(value); return res; },
    bytes: () => Buffer.concat(chunks) });
  return res;
}
const call = async (handler: (req: Request, res: Response) => unknown, { params = {}, headers = {}, query = {}, body = {} }: { params?: Record<string, string>; headers?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}) => {
  const res = respond(); const finished = new Promise<void>((resolve) => res.on('end', () => resolve()));
  await handler({ params, headers, query, body } as unknown as Request, res as unknown as Response);
  if (!res.writableEnded) { /* streaming handler ends on its own */ }
  await finished; return res;
};
const waitFor = async (condition: () => Promise<boolean>, ms = 90_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await condition()) return; await new Promise((r) => setTimeout(r, 150)); } throw new Error('timed out'); };

let root: string;
beforeEach(async () => { resetJobsForTests(); root = await mkdtemp(path.join(os.tmpdir(), 'sv-api-')); setMediaStorage(new LocalVolumeStorage(root, false)); mocks.tenantId = A; });
afterEach(() => { setMediaStorage(null); resetJobsForTests(); });

describe.skipIf(!ffmpegAvailable())('the first Standard Video, end to end', () => {
  it('makes a test video through the API, stores it, and serves the real MP4 to its business only', async () => {
    const started = await call(sampleHandler);
    expect(started.statusCode).toBe(202);
    expect(started.body).toMatchObject({ ok: true, status: 'processing', storage: 'temporary' });
    const { taskId } = started.body;
    await waitFor(async () => (await call(statusHandler, { params: { taskId } })).body.status === 'succeeded');
    const done = await call(statusHandler, { params: { taskId } });
    expect(done.body).toMatchObject({ ok: true, status: 'succeeded', url: `/api/marketing/media/videos/${taskId}.mp4` });

    const video = await call(mediaHandler, { params: { file: `${taskId}.mp4` } });
    expect(video.statusCode).toBe(200);
    expect(video.headers['Content-Type']).toBe('video/mp4');
    const bytes = video.bytes();
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp'); // a real MP4 file
    expect(Number(video.headers['Content-Length'])).toBe(bytes.length);

    // a player can ask for part of it
    const part = await call(mediaHandler, { params: { file: `${taskId}.mp4` }, headers: { range: 'bytes=0-99' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['Content-Range']).toBe(`bytes 0-99/${bytes.length}`);
    expect(part.bytes()).toHaveLength(100);
    expect((await call(mediaHandler, { params: { file: `${taskId}.mp4` }, headers: { range: 'bytes=999999999-' } })).statusCode).toBe(416);
    expect((await call(mediaHandler, { params: { file: `${taskId}.mp4` }, query: { download: '1' } })).headers['Content-Disposition']).toMatch(/^attachment/);

    // another business gets nothing, even knowing the id
    mocks.tenantId = B;
    expect((await call(mediaHandler, { params: { file: `${taskId}.mp4` } })).statusCode).toBe(404);
    expect((await call(statusHandler, { params: { taskId } })).body).toMatchObject({ status: 'failed' });
  }, 150_000);

  it('the Standard Video provider turns a video plan into a stored MP4 and reports its link', async () => {
    expect(standardProvider.isConfigured()).toBe(true);
    const concept = { durationSeconds: 10, transitions: '', audioDirection: '', render: { status: 'not_generated' as const }, scenes: [{ seconds: 2.5, visual: 'Cake on a stand', onScreenText: 'Our new chocolate cake' }, { seconds: 2.5, visual: 'Slice', onScreenText: 'Rich and fresh' }] };
    const started = await standardProvider.start!(concept, { platform: 'instagram', caption: '', topic: 'Chocolate cake', hook: 'Meet our new chocolate cake', cta: 'Order today' }, { tenantId: A });
    expect(started.estimatedCredits).toBeNull();
    expect(started.note).toMatch(/not AI-generated footage and has no per-video fee/);
    expect(started.note).toMatch(/silent/);
    await waitFor(async () => (await standardProvider.retrieve!(started.taskId, { tenantId: A })).status === 'succeeded');
    expect(await standardProvider.retrieve!(started.taskId, { tenantId: A })).toEqual({ status: 'succeeded', url: `/api/marketing/media/videos/${started.taskId}.mp4` });
    expect(await standardProvider.retrieve!(started.taskId, { tenantId: B })).toMatchObject({ status: 'failed' });
  }, 150_000);
});

describe('video files are only reachable by their business', () => {
  it('treats unsafe or unknown names as not found', async () => {
    for (const file of ['../../etc/passwd', '..%2f..%2fx.mp4', 'nope.mp4', '', 'a'.repeat(100) + '.mp4']) expect((await call(mediaHandler, { params: { file } })).statusCode).toBe(404);
    expect((await call(statusHandler, { params: { taskId: '../x' } })).statusCode).toBe(404);
  });
});
