import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getMediaStorage } from '@/server/marketing/standard-video/storage.js';

/** GET /api/marketing/assets: the signed-in business's own pictures, with what each one shows. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const storage = getMediaStorage();
    res.set('Cache-Control', 'no-store');
    res.json({ assets: (await storage.listAssets(tenant.id)).map((meta) => ({ ...meta, url: `/api/marketing/assets/${meta.id}` })), storage: storage.describe().persistent ? 'persistent' : 'temporary' });
  } catch { res.status(500).json({ error: 'Unable to load your pictures.' }); }
}
