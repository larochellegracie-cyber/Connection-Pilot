import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getContent, removeContent } from '@/server/marketing/store.js';
import { removePostMedia } from '@/server/marketing/image.js';
import { text } from '../../shared.js';

/** DELETE /api/marketing/content/:contentId: removes one piece of content from this business's library. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = text(req.params.contentId, 36);
    const current = await getContent(tenant.id, id);
    if (!current) return void res.status(404).json({ error: 'That content was not found.' });
    await removeContent(tenant.id, id);
    await removePostMedia(tenant.id, current.image); // its picture and animation go with it (the owner's own photos never do)
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Unable to delete that content.' }); }
}
