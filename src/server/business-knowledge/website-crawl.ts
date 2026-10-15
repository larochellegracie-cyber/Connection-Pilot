/**
 * Business website crawler.
 *
 * Fetches the homepage plus up to MAX_PAGES relevant sub-pages.
 * Designed to handle common website builders (GoDaddy, Wix, Squarespace,
 * WordPress, Shopify, etc.) and gracefully degrade when pages are inaccessible.
 */

const MAX_PAGES = 14;
const MAX_PAGE_CHARS = 20000;
const FETCH_TIMEOUT_MS = 12000;

// Paths that are likely to contain useful business information
const RELEVANT_PATH = /(about|contact|location|hours|menu|product|service|price|pricing|faq|question|policy|term|order|delivery|pickup|shipping|catering|shop|cake|cupcake|flavou?r|gift|team|staff|our-story|who-we-are|what-we-do|work|portfolio|gallery|offer|package|plan|rate|book|appointment|schedule|reserve)/i;

// External ordering/booking platforms worth including
const EXTERNAL_ORDER_HOST = /(order-online|square\.site|squareup\.com|toasttab\.com|doordash\.com|ubereats\.com|skipthe\w*\.com|shopify\.com|wixsite\.com)/i;

// Paths to skip — assets, auth, admin, tracking
const SKIP_PATH = /\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4|mp3|woff|woff2|ttf|eot|ico|css|js|json|xml|txt)$/i;
const SKIP_SEGMENT = /^(wp-admin|wp-login|wp-json|admin|login|logout|register|cart|checkout|account|my-account|dashboard|cdn-cgi|_next|__nextjs|\.well-known|sitemap|feed|rss|tag|category|author|page\/\d|p=\d)/i;

export type CrawledWebsitePage = { url: string; text: string; title: string };

export type CrawlResult = {
  website: string;
  pages: string[];
  records: CrawledWebsitePage[];
  sourceText: string;
  warnings: string[];
};

// ─── URL helpers ──────────────────────────────────────────────────────────────

function normaliseUrl(value: string): URL | null {
  let raw = value.trim();
  // Add https:// if no protocol given
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // Block private/loopback addresses
    if (host === 'localhost' || /^(127\.|0\.|10\.|192\.168\.|169\.254\.|::1$)/.test(host)) return null;
    // Must have a real TLD
    if (!host.includes('.')) return null;
    return url;
  } catch { return null; }
}

function canonicalise(url: URL): URL {
  const clean = new URL(url.toString());
  clean.hash = '';
  // Preserve query strings for some platforms (Shopify collections, etc.) but strip tracking params
  const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref', 'source'];
  trackingParams.forEach((p) => clean.searchParams.delete(p));
  return clean;
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.hostname.replace(/^www\./i, '') === b.hostname.replace(/^www\./i, '');
}

function shouldSkip(url: URL): boolean {
  if (SKIP_PATH.test(url.pathname)) return true;
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.some((seg) => SKIP_SEGMENT.test(seg));
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtml(match[1]).trim().slice(0, 120) : '';
}

function toText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Preserve block-level element boundaries as spaces
      .replace(/<\/(p|div|li|h[1-6]|section|article|header|footer|nav|main|aside|td|th|dt|dd)>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  ).slice(0, MAX_PAGE_CHARS);
}

function extractLinks(html: string, baseUrl: URL): URL[] {
  const seen = new Map<string, URL>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#?][^"']*?)["']/gi)) {
    try {
      const url = canonicalise(new URL(match[1], baseUrl));
      if (shouldSkip(url)) continue;
      const isSameSite = sameOrigin(url, baseUrl);
      const isUsefulExternal = !isSameSite && EXTERNAL_ORDER_HOST.test(url.hostname);
      if (!isSameSite && !isUsefulExternal) continue;
      const key = url.toString();
      if (!seen.has(key)) seen.set(key, url);
    } catch { /* skip malformed */ }
  }
  return [...seen.values()]
    .filter((url) => url.toString() !== baseUrl.toString())
    .filter((url) => !sameOrigin(url, baseUrl) || RELEVANT_PATH.test(url.pathname))
    .sort((a, b) => {
      // Prioritise highly relevant paths
      const aScore = RELEVANT_PATH.test(a.pathname) ? 1 : 0;
      const bScore = RELEVANT_PATH.test(b.pathname) ? 1 : 0;
      return bScore - aScore;
    });
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ConnectionPilot-BusinessAnalyzer/1.0; +https://connectionpilot.net)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Cache-Control': 'no-cache',
};

async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: URL } | null> {
  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: BROWSER_HEADERS,
      redirect: 'follow',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null;
    const html = (await response.text()).slice(0, 200000);
    const finalUrl = new URL(response.url || url.toString());
    return { html, finalUrl };
  } catch { return null; }
}

async function fetchPage(url: URL): Promise<CrawledWebsitePage | null> {
  const result = await fetchHtml(url);
  if (!result) return null;
  const text = toText(result.html);
  if (!text || text.length < 50) return null;
  return { url: result.finalUrl.toString(), title: extractTitle(result.html), text };
}

// ─── Try www / non-www fallback ───────────────────────────────────────────────

async function fetchWithWwwFallback(url: URL): Promise<{ page: CrawledWebsitePage; html: string; finalUrl: URL } | null> {
  // Try as-is first
  let result = await fetchHtml(url);
  if (!result) {
    // Try toggling www
    const alt = new URL(url.toString());
    if (alt.hostname.startsWith('www.')) {
      alt.hostname = alt.hostname.slice(4);
    } else {
      alt.hostname = `www.${alt.hostname}`;
    }
    result = await fetchHtml(alt);
  }
  if (!result) return null;
  const text = toText(result.html);
  if (!text || text.length < 50) return null;
  return { page: { url: result.finalUrl.toString(), title: extractTitle(result.html), text }, html: result.html, finalUrl: result.finalUrl };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function crawlBusinessWebsite(value: string): Promise<CrawlResult> {
  const startUrl = normaliseUrl(value);
  if (!startUrl) throw new Error('That doesn\'t look like a valid website URL. Please enter a full URL like https://yourbusiness.com.');

  const homeResult = await fetchWithWwwFallback(startUrl);
  if (!homeResult) {
    // Provide a specific, actionable error
    throw new Error(
      `Pilot couldn't access ${startUrl.hostname}. The website may be password-protected, blocking automated access, or temporarily unavailable. ` +
      `Try again in a moment, or use the "Upload Your Business Information" option below.`
    );
  }

  const { page: homePage, html: homeHtml, finalUrl } = homeResult;
  const warnings: string[] = [];

  // Discover candidate pages from the homepage HTML
  const candidates = extractLinks(homeHtml, finalUrl)
    .filter((url) => sameOrigin(url, finalUrl) || EXTERNAL_ORDER_HOST.test(url.hostname))
    .slice(0, MAX_PAGES - 1);

  // Fetch all candidate pages in parallel (with a concurrency cap)
  const CONCURRENCY = 4;
  const extraPages: CrawledWebsitePage[] = [];
  const visited = new Set<string>([homePage.url]);

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((url) => fetchPage(url)));
    for (let j = 0; j < results.length; j++) {
      const page = results[j];
      const candidateUrl = batch[j].toString();
      if (page && !visited.has(page.url)) {
        visited.add(page.url);
        extraPages.push(page);
      } else if (!page) {
        warnings.push(`Could not access: ${candidateUrl}`);
      }
    }
  }

  const records = [homePage, ...extraPages];
  const sourceText = records
    .map((page) => `=== Page: ${page.title || page.url} ===\nURL: ${page.url}\n${page.text}`)
    .join('\n\n')
    .slice(0, 100000);

  return {
    website: finalUrl.toString(),
    pages: records.map((page) => page.url),
    records,
    sourceText,
    warnings,
  };
}
