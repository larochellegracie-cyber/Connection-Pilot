import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { generateIdeas } from '@/server/marketing/generate.js';
import { aiComplete, cachedIdeas, generationFailure, loadMarketingInput, NEEDS_BUSINESS_INFORMATION, saveIdeas } from '@/server/marketing/service.js';
import { requireAi } from '../shared.js';

/**
 * POST /api/marketing/ideas { refresh?: boolean }
 * Ideas come from the business's own information, its real activity and Pilot's insights, plus current trend research
 * when web search is connected. Recent ideas are reused unless the owner asks to refresh.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    if (!requireAi(res)) return;
    const refresh = req.body?.refresh === true;
    const { input, trendReport, hasRealData } = await loadMarketingInput(tenant, { refreshTrends: refresh, research: true });
    if (!hasRealData) return void res.status(409).json({ error: NEEDS_BUSINESS_INFORMATION, needsBusinessInformation: true });
    if (!refresh) { const cached = await cachedIdeas(tenant); if (cached) return void res.json({ ideas: cached.ideas, savedAt: cached.savedAt, trends: trendReport, signals: input.signals, cached: true }); }
    const ideas = await generateIdeas(input, aiComplete);
    await saveIdeas(tenant, ideas);
    res.json({ ideas, savedAt: new Date().toISOString(), trends: trendReport, signals: input.signals, cached: false });
  } catch (error) {
    const failure = generationFailure(error);
    res.status(failure.status).json(failure.body);
  }
}
