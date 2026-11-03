import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { generatePlan } from '@/server/marketing/generate.js';
import { aiComplete, generationFailure, loadMarketingInput, NEEDS_BUSINESS_INFORMATION } from '@/server/marketing/service.js';
import { createContent, removeContent } from '@/server/marketing/store.js';
import { requireAi } from '../shared.js';

/**
 * POST /api/marketing/plan { days? }: "Let Pilot plan my content". Pilot proposes a week of content with the reason for
 * each piece. The pieces are saved as PROPOSED for the owner to approve, edit, regenerate or remove. Nothing is published.
 * A new proposal replaces earlier proposals the owner never acted on; anything already approved or edited is untouched.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    if (!requireAi(res)) return;
    const days = Math.min(14, Math.max(3, Number(req.body?.days) || 7));
    const { input, hasRealData } = await loadMarketingInput(tenant, { research: true });
    if (!hasRealData) return void res.status(409).json({ error: NEEDS_BUSINESS_INFORMATION, needsBusinessInformation: true });
    const planned = await generatePlan(input, aiComplete, days);
    for (const old of input.existing.filter((item) => item.status === 'proposed')) await removeContent(tenant.id, old.id);
    const campaign = `plan-${new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }).format(input.now)}`;
    const items = [];
    for (const { date, ...piece } of planned) items.push(await createContent(tenant.id, { ...piece, status: 'proposed', scheduledFor: date, approvedAt: null, publishedAt: null, campaign }));
    res.status(201).json({ items });
  } catch (error) {
    const failure = generationFailure(error);
    res.status(failure.status).json(failure.body);
  }
}
