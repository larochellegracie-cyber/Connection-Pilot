import { describe, expect, it, vi } from 'vitest';
import { researchTrends, trendQueries } from './trends';

const NOW = new Date('2026-03-10T16:00:00Z');
const params = { industry: 'Pool & outdoor services', services: ['Pool opening', 'Pool cleaning'], location: 'Kitchener, Ontario', timezone: 'America/Toronto' };
const result = (n: number, extra: Record<string, unknown> = {}) => ({ title: `Source ${n}`, url: `https://site${n}.example.com/post`, snippet: `Snippet ${n}`, publishedAt: '2026-02-20', ...extra });
const ai = (trends: unknown[]) => vi.fn(async () => JSON.stringify({ trends }));

describe('trend research', () => {
  it('searches for this business’s industry, place and season', () => {
    expect(trendQueries(params, NOW)).toEqual([
      'Pool & outdoor services social media content trends March 2026',
      'Pool opening Kitchener, Ontario spring 2026 customers demand',
      'short form video ideas for Pool & outdoor services businesses 2026',
    ]);
  });

  it('reports no trends and says why when web search is not connected', async () => {
    const error = Object.assign(new Error('not configured'), { name: 'FirecrawlNotConfiguredError' });
    const report = await researchTrends(params, { search: async () => { throw error; }, now: () => NOW });
    expect(report).toMatchObject({ status: 'not_configured', trends: [], sources: [] });
    expect(report.message).toMatch(/will not call anything a current trend/);
  });

  it('reports a failed search honestly', async () => {
    const report = await researchTrends(params, { search: async () => { throw new Error('timeout'); }, now: () => NOW });
    expect(report.status).toBe('failed');
    expect(report.trends).toEqual([]);
  });

  it('reports nothing when only old or empty results come back', async () => {
    const report = await researchTrends(params, { search: async () => [result(1, { publishedAt: '2023-01-01' })], now: () => NOW });
    expect(report.status).toBe('no_results');
    expect(report.sources).toEqual([]);
  });

  it('lists sources without inventing trends when the AI is not available', async () => {
    const report = await researchTrends(params, { search: async () => [result(1), result(2)], now: () => NOW });
    expect(report).toMatchObject({ status: 'ok', summarized: false, trends: [] });
    expect(report.sources.map((source) => source.id)).toEqual(['s1', 's2']);
  });

  it('keeps only trends that cite real sources, and dates them', async () => {
    const complete = ai([
      { statement: 'Before-and-after cleaning videos are a popular format for service businesses.', sourceIds: ['s1', 's2', 's3'] },
      { statement: 'Everyone is posting about pool openings.', sourceIds: ['s99'] },
      { statement: 'No sources cited.', sourceIds: [] },
    ]);
    const report = await researchTrends(params, { search: async () => [result(1), result(2), result(3)], complete, now: () => NOW });
    expect(report.trends).toHaveLength(1);
    expect(report.trends[0]).toMatchObject({ confidence: 'high', asOf: '2026-03-10' });
    expect(report.trends[0].sources.map((source) => source.url)).toEqual(['https://site1.example.com/post', 'https://site2.example.com/post', 'https://site3.example.com/post']);
    expect(report.message).toBe('Based on 3 sources found on 2026-03-10.');
  });

  it('scales confidence with how many different sites agree, and caps undated evidence', async () => {
    const one = await researchTrends(params, { search: async () => [result(1), result(2)], complete: ai([{ statement: 'Short videos work well.', sourceIds: ['s1'] }]), now: () => NOW });
    expect(one.trends[0].confidence).toBe('low');
    const two = await researchTrends(params, { search: async () => [result(1), result(2)], complete: ai([{ statement: 'Short videos work well.', sourceIds: ['s1', 's2'] }]), now: () => NOW });
    expect(two.trends[0].confidence).toBe('medium');
    const undated = await researchTrends(params, { search: async () => [result(1, { publishedAt: null }), result(2, { publishedAt: null }), result(3, { publishedAt: null })], complete: ai([{ statement: 'Short videos work well.', sourceIds: ['s1', 's2', 's3'] }]), now: () => NOW });
    expect(undated.trends[0].confidence).toBe('low');
  });

  it('drops statements with numbers that are not in the sources, and any "viral" claims', async () => {
    const report = await researchTrends(params, { search: async () => [result(1, { snippet: 'Reels get 20% more reach for local services.' })], complete: ai([
      { statement: 'Reels get 20% more reach for local services.', sourceIds: ['s1'] },
      { statement: 'Reels get 85% more reach.', sourceIds: ['s1'] },
      { statement: 'This format goes viral every time.', sourceIds: ['s1'] },
    ]), now: () => NOW });
    expect(report.trends.map((trend) => trend.statement)).toEqual(['Reels get 20% more reach for local services.']);
  });

  it('says so when the sources do not support any trend', async () => {
    const report = await researchTrends(params, { search: async () => [result(1)], complete: ai([]), now: () => NOW });
    expect(report.trends).toEqual([]);
    expect(report.message).toMatch(/none supported a clear trend/);
  });

  it('survives a model that answers with junk', async () => {
    const report = await researchTrends(params, { search: async () => [result(1)], complete: async () => 'sorry, I cannot', now: () => NOW });
    expect(report).toMatchObject({ status: 'ok', trends: [], summarized: true });
  });
});
