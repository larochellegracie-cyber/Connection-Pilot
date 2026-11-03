import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { workspaceSummary } from './summary.js';
import { cachedIdeas, setupStatus, trendsFor } from '@/server/marketing/service.js';
import { getBrandVoice, listContent, loadBusinessBrief, loadDemand } from '@/server/marketing/store.js';
import { buildSignals } from '@/server/marketing/signals.js';

/** GET /api/marketing/workspace: what the Marketing page shows. Reads saved data only; it never starts research or writing. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const now = new Date();
    const [items, brief, brandVoice, { timezone }, demand] = await Promise.all([listContent(tenant.id), loadBusinessBrief(tenant.id), getBrandVoice(tenant.id), getCalendarSettings(tenant.id), loadDemand(tenant.id, now)]);
    const signals = buildSignals({ now, timezone, demand });
    const [trendReport, ideas] = await Promise.all([trendsFor(tenant, { industry: brief.businessType, services: brief.services, location: brief.location, timezone }, { allowResearch: false, now }), cachedIdeas(tenant, now)]);
    const hasRealData = brief.hasBusinessInformation || signals.some((signal) => ['top_service', 'slowing_service', 'growing_service'].includes(signal.kind));
    res.set('Cache-Control', 'no-store');
    res.json(workspaceSummary({ items, signals, trendReport, ideas, brief, brandVoice, hasRealData, timezone, now, setup: setupStatus(), tenant }));
  } catch (error) {
    console.error('marketing.workspace.failed', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    res.status(500).json({ error: 'Unable to load your marketing workspace.' });
  }
}
