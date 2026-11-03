import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { importRequestFrom } from '@/server/import/request.js';
import { runImport } from '@/server/import/commit.js';

/** Imports the reviewed records. Only called after the owner confirms. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'customers');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    if (req.body?.confirmed !== true) return void res.status(400).json({ error: 'Nothing is added until you confirm the import.' });
    const request = importRequestFrom(req.body);
    if ('error' in request) return void res.status(400).json({ error: request.error });
    res.status(201).json({ result: await runImport(tenant.id, request) });
  } catch (error) {
    res.status(500).json({ error: 'Pilot could not finish the import.', message: error instanceof Error ? error.message : String(error) });
  }
}
