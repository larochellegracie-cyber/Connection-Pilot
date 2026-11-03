import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getMediaStorage, isSafeId } from '@/server/marketing/standard-video/storage.js';

/**
 * GET /api/marketing/media/images/:id.jpg: one of the signed-in business's own post pictures.
 * The business comes from the session, never from the address, so another business's picture is simply not found.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = String(req.params.file ?? '').replace(/\.jpg$/i, '');
    if (!isSafeId(id)) return void res.status(404).json({ error: 'That picture was not found.' });
    const file = await getMediaStorage().openImage(tenant.id, id);
    if (!file) return void res.status(404).json({ error: 'That picture was not found.' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(file.size));
    res.status(200).end(await file.read());
  } catch { if (!res.headersSent) res.status(500).json({ error: 'Unable to load that picture.' }); }
}
