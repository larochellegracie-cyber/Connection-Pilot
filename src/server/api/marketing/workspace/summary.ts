import type { ContentItem } from '@/lib/marketing-content.js';
import type { BrandVoice, BusinessBrief } from '@/server/marketing/store.js';
import type { Idea } from '@/server/marketing/generate.js';
import type { Signal } from '@/server/marketing/signals.js';
import type { TrendReport } from '@/server/marketing/trends.js';
import type { setupStatus } from '@/server/marketing/service.js';

const localDay = (date: Date | string, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));

/** The numbers at the top of Marketing. Every one is counted from saved content and real signals. */
export function workspaceSummary(input: { items: ContentItem[]; signals: Signal[]; trendReport: TrendReport | null; ideas: { ideas: Idea[]; savedAt: string } | null; brief: BusinessBrief; brandVoice: BrandVoice; hasRealData: boolean; timezone: string; now: Date; setup: ReturnType<typeof setupStatus>; tenant: { businessName: string } }) {
  const { items, timezone, now } = input;
  const today = localDay(now, timezone);
  const month = today.slice(0, 7);
  const ready = (item: ContentItem) => item.status === 'approved' || item.status === 'scheduled';
  const trends = input.trendReport?.trends ?? [];
  return {
    business: { name: input.brief.businessName || input.tenant.businessName, type: input.brief.businessType, hasBusinessInformation: input.brief.hasBusinessInformation, website: input.brief.website },
    brandVoice: input.brandVoice,
    metrics: {
      createdThisMonth: items.filter((item) => localDay(item.createdAt, timezone).startsWith(month)).length,
      postsReady: items.filter((item) => item.kind === 'post' && ready(item)).length,
      // A video only counts as ready when its file really exists.
      videosReady: items.filter((item) => item.kind === 'video' && ready(item) && item.video?.render.status === 'ready').length,
      videoPlansReady: items.filter((item) => item.kind === 'video' && ready(item)).length,
      upcoming: items.filter((item) => item.scheduledFor && item.scheduledFor >= today && (item.status === 'scheduled' || item.status === 'approved')).length,
      opportunities: input.signals.filter((signal) => signal.kind !== 'top_service').length + trends.length,
      trendsWithSources: trends.length,
    },
    today, timezone, items, signals: input.signals,
    trends: input.trendReport,
    ideas: input.ideas,
    hasRealData: input.hasRealData,
    setup: input.setup,
  };
}

export type WorkspaceData = ReturnType<typeof workspaceSummary>;
