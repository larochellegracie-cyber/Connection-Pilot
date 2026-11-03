import { generateText } from 'ai';
import { getChatModel, isChatConfigured } from '@/lib/chatbot/chat-config.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { getProactiveBriefing } from '@/server/pilot/proactive-briefing.js';
import { firecrawlSearch, isFirecrawlConfigured } from './firecrawl-retrieval.js';
import { GenerationError, type Complete, type Idea, type MarketingInput } from './generate.js';
import { imageGenerationStatus, videoGenerationStatus } from './providers.js';
import { buildSignals } from './signals.js';
import { listContent, loadBusinessBrief, loadDemand, readCache, writeCache } from './store.js';
import { researchTrends, type TrendReport } from './trends.js';

export type Tenant = { id: string; businessName: string; businessType: string };

export const aiConfigured = () => isChatConfigured();
/** A request that stalls (no answer at all) is cut off after 2 minutes and tried once more, so one stuck connection cannot hold a whole job. */
const withRetry = async <T,>(call: (signal: AbortSignal) => Promise<T>): Promise<T> => { for (let attempt = 0; ; attempt += 1) { try { return await call(AbortSignal.timeout(120_000)); } catch (error) { if (attempt >= 1) throw error; } } };
/** The same single text call, also reporting how many tokens it used. */
export const aiCompleteWithUsage = async (system: string, prompt: string) => {
  const result = await withRetry((abortSignal) => generateText({ model: getChatModel(), system, prompt, abortSignal }));
  return { text: result.text, usage: { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens } };
};
/** A text call for writing code: lower reasoning effort, because the model is composing from a detailed reference and long deliberation only adds minutes. */
export const aiCompleteCode = async (system: string, prompt: string) => {
  // a request that stalls (no answer at all) is cut off after 2 minutes and tried once more, rather than holding the video up
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await generateText({ model: getChatModel(), system, prompt, providerOptions: { openai: { reasoningEffort: 'low' } }, abortSignal: AbortSignal.timeout(120_000) });
      return { text: result.text, usage: { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens } };
    } catch (error) { if (attempt >= 1) throw error; }
  }
};
/** The same single call with pictures attached (the model looks at them): used to review frames of a video. */
export const aiCompleteWithImages = async (system: string, prompt: string, images: Buffer[]) => {
  const result = await generateText({ model: getChatModel(), system, abortSignal: AbortSignal.timeout(120_000), providerOptions: { openai: { reasoningEffort: 'low' } }, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'file' as const, mediaType: 'image/jpeg', data: image }))] }] });
  return { text: result.text, usage: { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens } };
};
export const aiComplete: Complete = async (system, prompt) => (await withRetry((abortSignal) => generateText({ model: getChatModel(), system, prompt, abortSignal }))).text;

const TREND_TTL = 24 * 60 * 60 * 1000;
const IDEAS_TTL = 12 * 60 * 60 * 1000;

export function setupStatus() {
  return { ai: aiConfigured(), search: isFirecrawlConfigured(), video: videoGenerationStatus(), image: imageGenerationStatus, publishing: { connected: false, message: 'No publishing platform is connected. Pilot never posts anything for you: approve content here, then post it yourself or hand it to your team.' } };
}

/** Trend research is reused for a day, so the web is not searched again for every click. */
export async function trendsFor(tenant: Tenant, input: { industry: string; services: string[]; location: string; timezone: string }, { refresh = false, allowResearch = true, now = new Date() }: { refresh?: boolean; allowResearch?: boolean; now?: Date } = {}): Promise<TrendReport | null> {
  if (!refresh) { const cached = await readCache<TrendReport>(tenant.id, 'trends', TREND_TTL, now); if (cached) return cached.value; }
  if (!allowResearch) return null;
  const report = await researchTrends(input, { search: (query) => firecrawlSearch(query, 5), complete: aiConfigured() ? aiComplete : undefined, now: () => now });
  if (report.status === 'ok') await writeCache(tenant.id, 'trends', report);
  return report;
}

export async function cachedIdeas(tenant: Tenant, now = new Date()): Promise<{ ideas: Idea[]; savedAt: string } | null> {
  const cached = await readCache<Idea[]>(tenant.id, 'ideas', IDEAS_TTL, now);
  return cached ? { ideas: cached.value, savedAt: cached.savedAt } : null;
}
export const saveIdeas = (tenant: Tenant, ideas: Idea[]) => writeCache(tenant.id, 'ideas', ideas);

/** Everything Pilot knows that is relevant to marketing, gathered from the places it is already saved. */
export async function loadMarketingInput(tenant: Tenant, options: { refreshTrends?: boolean; research?: boolean; now?: Date } = {}): Promise<{ input: MarketingInput; trendReport: TrendReport | null; hasRealData: boolean }> {
  const now = options.now ?? new Date();
  const [brief, { timezone }, demand, existing] = await Promise.all([loadBusinessBrief(tenant.id), getCalendarSettings(tenant.id), loadDemand(tenant.id, now), listContent(tenant.id)]);
  const signals = buildSignals({ now, timezone, demand });
  const trendReport = await trendsFor(tenant, { industry: brief.businessType || tenant.businessType, services: brief.services, location: brief.location, timezone }, { refresh: options.refreshTrends, allowResearch: options.research ?? false, now });
  const insights = await getProactiveBriefing(tenant, now).then((briefing) => briefing.insights.filter((insight) => insight.priority !== 'keep_an_eye_on').slice(0, 5).map((insight) => ({ title: insight.title, recommendation: insight.recommendation }))).catch(() => []);
  const hasRealData = brief.hasBusinessInformation || signals.some((signal) => ['top_service', 'slowing_service', 'growing_service'].includes(signal.kind));
  return { input: { brief, signals, trends: trendReport?.trends ?? [], insights, existing, now, timezone }, trendReport, hasRealData };
}

export const NEEDS_BUSINESS_INFORMATION = 'Pilot needs to know a little about your business before it can write for it. Add your services and a short description on the Business profile tab, or connect your website, and then try again.';

export function generationFailure(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof GenerationError) return { status: 422, body: { error: error.publicMessage } };
  return { status: 502, body: { error: 'Pilot could not write that just now. Please try again in a moment.' } };
}
