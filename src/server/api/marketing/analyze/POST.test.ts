import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const state = vi.hoisted(() => ({ queue: [] as unknown[][], updates: [] as unknown[], inserts: [] as unknown[] }));
vi.mock('@/server/db/client.js', async () => ({ db: (await import('@/test/db-mock')).buildDb(state) }));
vi.mock('@/lib/auth/auth.js', () => ({ getAuth: () => ({ api: { getSession: async () => ({ user: { id: 'user-1' } }) } }) }));

import handler from './POST';

const respond = () => ({ statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } });
const analyze = () => ({ body: { websiteUrl: 'https://somersetpool.example' }, headers: {}, header: () => undefined }) as unknown as Request;

describe('POST /api/marketing/analyze setup checks', () => {
  beforeEach(() => {
    state.queue.length = 0;
    state.queue.push([{ id: 'biz-1' }], []); // business profile, no marketing profile yet
    delete process.env.FIRECRAWL_API_KEY; delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.FIRECRAWL_API_KEY; delete process.env.OPENAI_API_KEY; });

  it('shows a setup message, not a broken-looking error, when the Firecrawl key is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = respond();
    await handler(analyze(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ setupRequired: true });
    expect((res.body as { error: string }).error).toMatch(/Firecrawl API key/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for the OpenAI key before crawling anything, so a crawl is not wasted', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    vi.stubGlobal('fetch', vi.fn());
    const res = respond();
    await handler(analyze(), res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect((res.body as { error: string }).error).toMatch(/OpenAI API key/);
    expect(res.body).toMatchObject({ setupRequired: true, stage: 'openai_analysis' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
