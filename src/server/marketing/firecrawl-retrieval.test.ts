import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FirecrawlNotConfiguredError, isFirecrawlConfigured, retrieveMarketingWebsite } from './firecrawl-retrieval';

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
const page = (url: string, title: string, markdown: string) => ({ markdown, metadata: { sourceURL: url, title } });

describe('Firecrawl website learning', () => {
  beforeEach(() => {
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env['FIRECRAWL_API-KEY'];
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.FIRECRAWL_API_KEY; });

  it('says plainly that website learning is not set up when there is no key, and makes no request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(isFirecrawlConfigured()).toBe(false);

    const failure = await retrieveMarketingWebsite('https://somersetpool.example').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FirecrawlNotConfiguredError);
    const error = failure as FirecrawlNotConfiguredError;
    expect(error.status).toBe(503);
    expect(error.publicMessage).toMatch(/isn’t set up yet.*Firecrawl API key.*upload your business information/s);
    expect(error.publicMessage).not.toMatch(/temporarily unavailable/);
    expect(fetchMock).not.toHaveBeenCalled(); // no pointless second "fallback" call either
  });

  it('also accepts the key under the hyphenated name some platforms use', () => {
    process.env['FIRECRAWL_API-KEY'] = 'fc-test';
    expect(isFirecrawlConfigured()).toBe(true);
    delete process.env['FIRECRAWL_API-KEY'];
  });

  it('crawls the site with the key, waits for the result, and returns the pages', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    const calls: { url: string; method: string; auth: string | null; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: String(init.method), auth: new Headers(init.headers).get('Authorization'), body: init.body as string | undefined });
      if (url.endsWith('/crawl') && init.method === 'POST') return json({ success: true, id: 'crawl-1' });
      if (url.endsWith('/crawl/crawl-1')) return json({ status: 'completed', data: [page('https://somersetpool.example/', 'Somerset Pool', 'We clean and maintain residential pools all season long. Call 555-0100 to book a visit.'), page('https://somersetpool.example/about', 'About', 'Family owned and operated since 2009, serving the whole county with weekly pool service.')] });
      return json({}, 404);
    }));

    const pending = retrieveMarketingWebsite('somersetpool.example');
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;

    expect(result.source).toBe('website');
    expect(result.records.map((record) => record.title)).toEqual(['About', 'Somerset Pool']); // pages with business-relevant paths (about, contact, menu…) come first
    expect(result.sourceText).toContain('Family owned and operated since 2009');
    expect(calls[0]).toMatchObject({ method: 'POST', auth: 'Bearer fc-test-key' });
    expect(calls[0].url).toBe('https://api.firecrawl.dev/v2/crawl');
    expect(JSON.parse(calls[0].body as string)).toMatchObject({ url: 'https://somersetpool.example/', scrapeOptions: { formats: ['markdown'] } });
  });

  it('falls back to public search when the site blocks crawling, and says so', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/crawl')) return json({ error: 'blocked by robots' }, 403);
      if (url.endsWith('/search')) return json({ data: [page('https://directory.example/somerset', 'Somerset Pool - Directory', 'Somerset Pool offers pool cleaning, opening and closing, open 8-5 Monday to Friday.')] });
      return json({}, 404);
    }));

    const result = await retrieveMarketingWebsite('https://somersetpool.example');
    expect(result.source).toBe('public_search');
    expect(result.warnings[0]).toMatch(/publicly indexed information/);
  });

  it('reports a clear message when nothing can be found anywhere', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/crawl') ? json({ error: 'nope' }, 500) : json({ data: [] }))));
    const failure = await retrieveMarketingWebsite('https://somersetpool.example').catch((error: unknown) => error) as { publicMessage: string; status: number };
    expect(failure.status).toBe(422);
    expect(failure.publicMessage).toMatch(/upload your business information/);
  });
});
