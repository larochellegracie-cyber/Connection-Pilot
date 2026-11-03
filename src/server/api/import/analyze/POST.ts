import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { suggestSheet } from '@/server/import/classify.js';
import { parseTabularFile } from '@/server/import/parse.js';

/** Reads one uploaded spreadsheet and suggests what each sheet contains. Nothing is saved. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'customers');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.slice(0, 255) : '';
    const base64 = typeof req.body?.base64 === 'string' ? req.body.base64 : '';
    if (!fileName || !base64) return void res.status(400).json({ error: 'Choose a file to import.' });
    const sheets = parseTabularFile(fileName, base64);
    res.json({ sheets, suggestions: sheets.map((sheet) => suggestSheet(sheet)) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Pilot could not read that file.' });
  }
}
