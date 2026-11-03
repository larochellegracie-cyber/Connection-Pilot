import { seasonContext } from './signals.js';
import type { WebSearchResult } from './firecrawl-retrieval.js';

/**
 * Current trend research. A trend is only reported when it rests on real, dated search results that Pilot
 * fetched just now, and every trend lists its sources. With no search connection, nothing is claimed.
 */
export type TrendSource = { id: string; title: string; url: string; snippet: string; publishedAt: string | null; query: string };
export type Trend = { id: string; statement: string; sources: Array<{ title: string; url: string; publishedAt: string | null }>; confidence: 'high' | 'medium' | 'low'; asOf: string };
export type TrendReport = {
  status: 'ok' | 'not_configured' | 'no_results' | 'failed';
  message: string;
  /** The day the research was done. Trends are only current as of this date. */
  asOf: string;
  queries: string[];
  trends: Trend[];
  sources: TrendSource[];
  /** Whether Pilot wrote trend statements from the sources (needs the AI key) or only listed the sources. */
  summarized: boolean;
};

type Deps = {
  search: (query: string) => Promise<WebSearchResult[]>;
  /** Writes JSON from the sources. Optional: without it only the sources are listed. */
  complete?: (system: string, prompt: string) => Promise<string>;
  now?: () => Date;
};
type Params = { industry: string; services: string[]; location: string; timezone: string };

const MAX_AGE_DAYS = 400;
const monthName = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', month: 'long' }).format(date);
const domain = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export function trendQueries({ industry, services, location, timezone }: Params, now: Date): string[] {
  const year = now.getUTCFullYear();
  const season = seasonContext(now, timezone);
  const focus = (services[0] || industry).trim();
  const place = location.trim();
  return [
    `${industry} social media content trends ${monthName(now)} ${year}`,
    `${focus} ${place} ${season.daysToNext <= 30 ? season.next : season.current} ${year} customers demand`.replace(/\s+/g, ' ').trim(),
    `short form video ideas for ${industry} businesses ${year}`,
  ].filter((query, index, all) => query.trim() && all.indexOf(query) === index);
}

const SYSTEM = `You summarize web search results into marketing trends for a small business. Use ONLY the numbered sources you are given.
Rules: every trend must be directly supported by one or more sources and must cite them by id. Do not add facts, numbers, percentages, brand names or locations that are not in the sources. Do not say "viral" or predict results. If the sources do not support a trend about content, seasonal demand or what customers are asking about, return fewer trends or none.
Respond with JSON only: {"trends":[{"statement":"one short sentence","sourceIds":["s1","s2"]}]}. At most 4 trends.`;

export function parseJson(text: string): Record<string, unknown> {
  try { const match = text.match(/\{[\s\S]*\}/); if (match) return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* fall through */ }
  return {};
}

const numbersIn = (value: string) => value.match(/\d[\d,.]*/g) ?? [];

export async function researchTrends(params: Params, deps: Deps): Promise<TrendReport> {
  const now = (deps.now ?? (() => new Date()))();
  const asOf = now.toISOString().slice(0, 10);
  const queries = trendQueries(params, now);
  const base = { asOf, queries, trends: [] as Trend[], sources: [] as TrendSource[], summarized: false };

  const settled = await Promise.allSettled(queries.map(async (query) => ({ query, results: await deps.search(query) })));
  const failures = settled.filter((row): row is PromiseRejectedResult => row.status === 'rejected');
  if (failures.length === settled.length) {
    const reason = failures[0].reason as { name?: string; publicMessage?: string; message?: string };
    if (reason?.name === 'FirecrawlNotConfiguredError') return { ...base, status: 'not_configured', message: 'Trend research needs the web search connection (Firecrawl), which is not set up yet. Until it is, Pilot will not call anything a current trend.' };
    return { ...base, status: 'failed', message: `Trend research could not run: ${reason?.publicMessage ?? reason?.message ?? 'the search service did not answer.'}` };
  }

  const seen = new Set<string>();
  const sources: TrendSource[] = [];
  for (const row of settled) {
    if (row.status !== 'fulfilled') continue;
    for (const result of row.value.results) {
      if (seen.has(result.url)) continue;
      const age = result.publishedAt ? (now.getTime() - new Date(result.publishedAt).getTime()) / 86_400_000 : null;
      if (age !== null && age > MAX_AGE_DAYS) continue; // old information is not presented as current
      seen.add(result.url);
      sources.push({ id: `s${sources.length + 1}`, title: result.title || domain(result.url), url: result.url, snippet: result.snippet, publishedAt: result.publishedAt, query: row.value.query });
    }
  }
  const limited = sources.slice(0, 10);
  if (!limited.length) return { ...base, status: 'no_results', message: 'The search did not return recent results for this business, so there are no trends to report.' };
  if (!deps.complete) return { ...base, sources: limited, status: 'ok', message: 'Recent sources were found, but writing trend summaries needs the AI connection, so only the sources are listed.' };

  let trends: Trend[] = [];
  try {
    const prompt = `Business industry: ${params.industry}\nLocation: ${params.location || 'not given'}\nToday: ${asOf}\n\nSources:\n${limited.map((source) => `${source.id}. ${source.title}${source.publishedAt ? ` (${source.publishedAt})` : ''}\n${source.snippet}`).join('\n\n')}`;
    const raw = parseJson(await deps.complete(SYSTEM, prompt));
    const byId = new Map(limited.map((source) => [source.id, source]));
    for (const entry of Array.isArray(raw.trends) ? raw.trends.slice(0, 6) : []) {
      const statement = typeof entry?.statement === 'string' ? entry.statement.trim().slice(0, 240) : '';
      const cited = (Array.isArray(entry?.sourceIds) ? entry.sourceIds : []).map((id: unknown) => byId.get(String(id))).filter((source: TrendSource | undefined): source is TrendSource => Boolean(source));
      if (!statement || !cited.length) continue;
      if (/\bviral\b|\bguarantee/i.test(statement)) continue;
      const evidenceText = cited.map((source: TrendSource) => `${source.title} ${source.snippet}`).join(' ');
      if (numbersIn(statement).some((number) => !evidenceText.includes(number))) continue; // a figure that is not in the sources is dropped
      const distinct = new Set(cited.map((source: TrendSource) => domain(source.url))).size;
      const dated = cited.some((source: TrendSource) => source.publishedAt);
      const confidence: Trend['confidence'] = !dated ? 'low' : distinct >= 3 ? 'high' : distinct === 2 ? 'medium' : 'low';
      trends.push({ id: `t${trends.length + 1}`, statement, sources: cited.map((source: TrendSource) => ({ title: source.title, url: source.url, publishedAt: source.publishedAt })), confidence, asOf });
      if (trends.length === 4) break;
    }
  } catch { trends = []; }
  return { ...base, sources: limited, trends, summarized: true, status: 'ok', message: trends.length ? `Based on ${limited.length} sources found on ${asOf}.` : 'Sources were found, but none supported a clear trend for this business, so none is reported.' };
}
