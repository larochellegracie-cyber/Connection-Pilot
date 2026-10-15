import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { pilotLearningSummary, recentlyLearnedPilotFacts } from '@/server/pilot/learning.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'pilot_assistant');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const [summary, facts] = await Promise.all([pilotLearningSummary(tenant.id), recentlyLearnedPilotFacts(tenant.id)]);
    res.json({ summary, facts });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Pilot learning could not be loaded.' });
  }
}
