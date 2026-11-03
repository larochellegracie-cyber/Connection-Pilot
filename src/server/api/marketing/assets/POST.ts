import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { AssetProblem, saveBusinessImage } from '@/server/marketing/standard-video/business-assets.js';
import { getMediaStorage } from '@/server/marketing/standard-video/storage.js';

/**
 * POST /api/marketing/assets { fileName, base64, kind?, label?, description?, tags? }
 * Saves one picture for the signed-in business. The picture is checked by its real contents (PNG, JPEG or WebP, up to 6 MB),
 * turned upright, reduced to a sensible size and re-saved, which removes hidden data. A product photo needs a label.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const base64 = typeof req.body?.base64 === 'string' ? req.body.base64.replace(/^data:[^,]*,/, '') : '';
    if (!base64) return void res.status(400).json({ error: 'Choose an image to upload.' });
    if (base64.length > 9 * 1024 * 1024) return void res.status(413).json({ error: 'That image is larger than 6 MB. Choose a smaller one.' });
    const meta = await saveBusinessImage({ tenantId: tenant.id, bytes: Buffer.from(base64, 'base64'), originalName: req.body?.fileName, fields: { kind: req.body?.kind, label: req.body?.label, description: req.body?.description, tags: req.body?.tags }, storage: getMediaStorage() });
    res.status(201).json({ asset: { ...meta, url: `/api/marketing/assets/${meta.id}` } });
  } catch (error) {
    if (error instanceof AssetProblem) return void res.status(422).json({ error: error.publicMessage });
    res.status(500).json({ error: 'The image could not be saved. Please try again.' });
  }
}
