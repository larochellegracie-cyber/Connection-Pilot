import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { importRequestFrom } from '@/server/import/request.js';
import { buildPlan, loadContext } from '@/server/import/plan.js';

/** Shows exactly what would be created. Reads the database but never writes to it. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'customers');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const request = importRequestFrom(req.body);
    if ('error' in request) return void res.status(400).json({ error: request.error });
    const { plan } = buildPlan(tenant.id, request, await loadContext(tenant.id));
    res.json({ plan });
  } catch (error) {
    res.status(500).json({ error: 'Pilot could not prepare the import preview.', message: error instanceof Error ? error.message : String(error) });
  }
}
