import { randomUUID } from 'node:crypto';
import { getSecret } from '#airo/secrets';

const FIRECRAWL_API = 'https://api.firecrawl.dev/v2';
const MAX_PAGES = 14;
const REQUEST_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 75_000;
const RELEVANT_PATH = /(about|contact|location|hours|menu|product|service|price|pricing|faq|question|order|delivery|pickup|catering|shop|cake|cupcake|team|staff|our-story|who-we-are|what-we-do|offer|package|plan|rate|book|appointment|schedule|reserve)/i;

export type MarketingRetrievalStage = 'url_validation' | 'firecrawl_retrieval' | 'content_extraction' | 'public_search';
export type MarketingRetrievalSource = 'website' | 'public_search';

export class MarketingRetrievalError extends Error {
  constructor(
    public readonly stage: MarketingRetrievalStage,
    public readonly publicMessage: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MarketingRetrievalError';
  }
}

/** Raised when website learning cannot run because no Firecrawl API key has been added. */
export class FirecrawlNotConfiguredError extends MarketingRetrievalError {
  constructor() {
    super('firecrawl_retrieval', 'Website learning isn’t set up yet. A Firecrawl API key needs to be added to this app’s settings. In the meantime you can upload your business information instead.', 503, 'FIRECRAWL_API_KEY is missing.');
    this.name = 'FirecrawlNotConfiguredError';
  }
}

function firecrawlKey(): string | null {
  const key = getSecret('FIRECRAWL_API_KEY') ?? getSecret('FIRECRAWL_API-KEY');
  return typeof key === 'string' && key.trim() ? key : null;
}

/** True when the Firecrawl key needed for website learning has been provided. */
export function isFirecrawlConfigured(): boolean { return firecrawlKey() !== null; }

export type MarketingWebsiteRecord = {
  url: string;
  title: string;
  text: string;
};

export type MarketingWebsiteRetrieval = {
  website: string;
  records: MarketingWebsiteRecord[];
  sourceText: string;
  source: MarketingRetrievalSource;
  warnings: string[];
};

type FirecrawlDocument = {
  markdown?: unknown;
  metadata?: { sourceURL?: unknown; url?: unknown; title?: unknown };
  url?: unknown;
  title?: unknown;
  description?: unknown;
};

type FirecrawlCrawlStatus = {
  success?: boolean;
  status?: unknown;
  error?: unknown;
  data?: unknown;
  completed?: unknown;
  total?: unknown;
};

function requestId(): string {
  return randomUUID();
}

function log(level: 'info' | 'warn' | 'error', payload: Record<string, unknown>): void {
  const output = JSON.stringify({ event: 'marketing-website-learning', ...payload });
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.info(output);
}

function normaliseUrl(value: string): URL {
  let raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MarketingRetrievalError('url_validation', 'Please enter a valid public website address, such as https://yourbusiness.com.', 400, 'URL parsing failed.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new MarketingRetrievalError('url_validation', 'Please enter a public website address that starts with https:// or http://.', 400, `Unsupported protocol: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  const isPrivateIpv4 = /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host);
  if (!host.includes('.') || host === 'localhost' || host === '::1' || isPrivateIpv4) {
    throw new MarketingRetrievalError('url_validation', 'Please enter a public website address, not a local or private network address.', 400, `Rejected non-public host: ${host}`);
  }

  url.hash = '';
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key));
  return url;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toRecords(data: unknown): MarketingWebsiteRecord[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const records: MarketingWebsiteRecord[] = [];

  for (const item of data as FirecrawlDocument[]) {
    const markdown = asString(item.markdown);
    const url = asString(item.metadata?.sourceURL) || asString(item.metadata?.url) || asString(item.url);
    const title = asString(item.metadata?.title) || asString(item.title) || url;
    if (!url || markdown.length < 50 || seen.has(url)) continue;
    seen.add(url);
    records.push({ url, title: title.slice(0, 180), text: markdown.slice(0, 20_000) });
  }

  return records
    .sort((a, b) => Number(RELEVANT_PATH.test(b.url)) - Number(RELEVANT_PATH.test(a.url)))
    .slice(0, MAX_PAGES);
}

function buildSourceText(records: MarketingWebsiteRecord[], source: MarketingRetrievalSource): string {
  const sourceLabel = source === 'website' ? 'Direct website retrieval' : 'Publicly indexed search results';
  return [`=== Retrieval source: ${sourceLabel} ===`, ...records.map((record) => `=== Page: ${record.title} ===\nURL: ${record.url}\n${record.text}`)]
    .join('\n\n')
    .slice(0, 100_000);
}

async function firecrawlFetch(path: string, init: RequestInit): Promise<Response> {
  const apiKey = firecrawlKey();
  if (!apiKey) throw new FirecrawlNotConfiguredError();

  try {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${apiKey}`);
    headers.set('Content-Type', 'application/json');
    return await fetch(`${FIRECRAWL_API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers,
    });
  } catch (error) {
    throw new MarketingRetrievalError('firecrawl_retrieval', 'We could not reach the website-learning service. Please try again or upload your business information.', 502, error instanceof Error ? error.message : String(error));
  }
}

async function startCrawl(url: URL, traceId: string): Promise<string> {
  const response = await firecrawlFetch('/crawl', {
    method: 'POST',
    body: JSON.stringify({
      url: url.toString(),
      limit: MAX_PAGES,
      scrapeOptions: { formats: ['markdown'] },
    }),
  });
  const payload = await response.json().catch(() => ({})) as { id?: unknown; error?: unknown };

  if (!response.ok || typeof payload.id !== 'string') {
    const detail = asString(payload.error) || `HTTP ${response.status}`;
    const blocked = response.status === 401 || response.status === 403 || response.status === 422;
    throw new MarketingRetrievalError(
      'firecrawl_retrieval',
      blocked
        ? 'That website appears to block automated access. I’ll check public business information next.'
        : 'I could not retrieve that website right now. I’ll check public business information next.',
      response.status >= 400 && response.status < 500 ? 422 : 502,
      `Firecrawl crawl start failed: ${detail}`,
    );
  }

  log('info', { traceId, stage: 'firecrawl_crawl_started', url: url.toString(), crawlId: payload.id });
  return payload.id;
}

async function pollCrawl(crawlId: string, traceId: string): Promise<MarketingWebsiteRecord[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const response = await firecrawlFetch(`/crawl/${encodeURIComponent(crawlId)}`, { method: 'GET' });
    const payload = await response.json().catch(() => ({})) as FirecrawlCrawlStatus;
    const status = asString(payload.status).toLowerCase();

    if (!response.ok || status === 'failed' || status === 'cancelled') {
      throw new MarketingRetrievalError('firecrawl_retrieval', 'The website-learning service could not retrieve that site. I’ll check public business information next.', 422, `Firecrawl crawl ${crawlId} returned ${status || `HTTP ${response.status}`}: ${asString(payload.error)}`);
    }

    if (status === 'completed') {
      const records = toRecords(payload.data);
      if (!records.length) {
        throw new MarketingRetrievalError('content_extraction', 'The website was reached but did not provide readable business information. I’ll check public business information next.', 422, `Firecrawl crawl ${crawlId} completed without readable markdown.`);
      }
      log('info', { traceId, stage: 'firecrawl_crawl_complete', crawlId, pages: records.length });
      return records;
    }
  }

  throw new MarketingRetrievalError('firecrawl_retrieval', 'Website learning took too long. I’ll check public business information next.', 504, `Firecrawl crawl ${crawlId} timed out after ${POLL_TIMEOUT_MS}ms.`);
}

async function searchPublicInformation(url: URL, traceId: string): Promise<MarketingWebsiteRecord[]> {
  const query = `site:${url.hostname.replace(/^www\./i, '')} ${url.hostname.replace(/^www\./i, '')}`;
  const response = await firecrawlFetch('/search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      limit: 5,
      scrapeOptions: { formats: ['markdown'] },
    }),
  });
  const payload = await response.json().catch(() => ({})) as { data?: unknown; web?: unknown; results?: unknown; error?: unknown };
  const rawResults = payload.data ?? payload.web ?? payload.results;
  const records = toRecords(rawResults);

  if (!response.ok || !records.length) {
    throw new MarketingRetrievalError('public_search', 'I could not find enough publicly available information for that business. Please upload your business information instead.', 422, `Firecrawl public search failed: ${asString(payload.error) || `HTTP ${response.status}`}; records=${records.length}`);
  }

  log('info', { traceId, stage: 'public_search_complete', query, pages: records.length });
  return records;
}

export async function retrieveMarketingWebsite(value: string): Promise<MarketingWebsiteRetrieval> {
  const traceId = requestId();
  const url = normaliseUrl(value);
  log('info', { traceId, stage: 'url_validated', url: url.toString() });

  try {
    const crawlId = await startCrawl(url, traceId);
    const records = await pollCrawl(crawlId, traceId);
    return {
      website: url.toString(),
      records,
      sourceText: buildSourceText(records, 'website'),
      source: 'website',
      warnings: [],
    };
  } catch (directError) {
    // Without a key there is nothing to fall back to, so say so plainly instead of trying a second failing call.
    if (directError instanceof FirecrawlNotConfiguredError) throw directError;
    const reason = directError instanceof MarketingRetrievalError ? directError : new MarketingRetrievalError('firecrawl_retrieval', 'I could not retrieve that website. I’ll check public business information next.', 502, directError instanceof Error ? directError.message : String(directError));
    log('warn', { traceId, stage: reason.stage, outcome: 'direct_retrieval_failed', url: url.toString(), detail: reason.message });

    try {
      const records = await searchPublicInformation(url, traceId);
      return {
        website: url.toString(),
        records,
        sourceText: buildSourceText(records, 'public_search'),
        source: 'public_search',
        warnings: ['The business profile was created from publicly indexed information because direct website retrieval was unavailable.'],
      };
    } catch (searchError) {
      const finalError = searchError instanceof MarketingRetrievalError ? searchError : new MarketingRetrievalError('public_search', 'I could not find public business information for that site. Please upload your business information instead.', 422, searchError instanceof Error ? searchError.message : String(searchError));
      log('error', { traceId, stage: finalError.stage, outcome: 'public_search_failed', url: url.toString(), detail: finalError.message });
      throw finalError;
    }
  }
}
