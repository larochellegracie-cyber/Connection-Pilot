import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { AssetProblem, updateBusinessImage } from '@/server/marketing/standard-video/business-assets.js';
import { isSafeId } from '@/server/marketing/standard-video/storage.js';

/** PATCH /api/marketing/assets/:assetId { kind?, label?, description?, tags? }: change what a picture is described as. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = String(req.params.assetId ?? '');
    if (!isSafeId(id)) return void res.status(404).json({ error: 'That picture was not found.' });
    const meta = await updateBusinessImage({ tenantId: tenant.id, assetId: id, fields: { kind: req.body?.kind, label: req.body?.label, description: req.body?.description, tags: req.body?.tags } });
    if (!meta) return void res.status(404).json({ error: 'That picture was not found.' });
    res.json({ asset: { ...meta, url: `/api/marketing/assets/${meta.id}` } });
  } catch (error) {
    if (error instanceof AssetProblem) return void res.status(422).json({ error: error.publicMessage });
    res.status(500).json({ error: 'Unable to update that picture.' });
  }
}
