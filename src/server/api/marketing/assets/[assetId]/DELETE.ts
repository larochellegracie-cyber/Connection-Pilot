import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { listContent, saveContent } from '@/server/marketing/store.js';
import { getMediaStorage, isSafeId } from '@/server/marketing/standard-video/storage.js';

/** DELETE /api/marketing/assets/:assetId: removes one of the business's own pictures. Videos already made are not affected, and posts that used it simply lose the picture. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = String(req.params.assetId ?? '');
    const storage = getMediaStorage();
    if (!isSafeId(id) || !(await storage.getAssetMeta(tenant.id, id))) return void res.status(404).json({ error: 'That picture was not found.' });
    await storage.deleteAsset(tenant.id, id);
    // a post that was showing this photo no longer has a picture, rather than a broken one
    for (const item of await listContent(tenant.id)) if (item.image?.url === `/api/marketing/assets/${id}`) await saveContent(tenant.id, { ...item, image: null, updatedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Unable to delete that picture.' }); }
}
