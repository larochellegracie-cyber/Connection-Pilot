import type { Request, Response } from 'express';
import { getTenant } from '../customers/tenant.js';
import { getCalendarSettings } from '../calendar/shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const settings = await getCalendarSettings(tenant.id);
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load booking rules.', message: String(error) });
  }
}
