import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { saveBrandVoice } from '@/server/marketing/store.js';
import { text } from '../shared.js';

/** PUT /api/marketing/brand-voice { tone, description }: saved on the business's marketing profile so Pilot remembers it. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const tone = text(req.body?.tone, 255);
    if (!tone) return void res.status(400).json({ error: 'Choose or describe a brand voice.' });
    const voice = { tone, description: text(req.body?.description, 1000) };
    await saveBrandVoice(tenant.id, voice);
    res.json({ brandVoice: voice });
  } catch { res.status(500).json({ error: 'Unable to save the brand voice.' }); }
}
