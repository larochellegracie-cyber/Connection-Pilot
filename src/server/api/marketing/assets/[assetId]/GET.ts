import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getMediaStorage, isSafeId } from '@/server/marketing/standard-video/storage.js';

/** GET /api/marketing/assets/:assetId: one of the signed-in business's own pictures. Another business's picture is simply not found. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = String(req.params.assetId ?? '');
    if (!isSafeId(id)) return void res.status(404).json({ error: 'That picture was not found.' });
    const storage = getMediaStorage();
    const [meta, file] = await Promise.all([storage.getAssetMeta(tenant.id, id), storage.openAsset(tenant.id, id)]);
    if (!meta || !file) return void res.status(404).json({ error: 'That picture was not found.' });
    res.setHeader('Content-Type', meta.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).end(await file.read());
  } catch { if (!res.headersSent) res.status(500).json({ error: 'Unable to load that picture.' }); }
}
