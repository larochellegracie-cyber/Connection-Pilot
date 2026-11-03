import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getStandardTask } from '@/server/marketing/standard-video/jobs.js';
import { isSafeId } from '@/server/marketing/standard-video/storage.js';

/** GET /api/marketing/standard-video/:taskId: where a Standard Video is, for the signed-in business only. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const taskId = String(req.params.taskId ?? '');
    if (!isSafeId(taskId)) return void res.status(404).json({ ok: false, message: 'That video was not found.' });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...(await getStandardTask({ tenantId: tenant.id, taskId })) });
  } catch { res.status(500).json({ ok: false, message: 'Could not check the video.' }); }
}
