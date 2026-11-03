import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { loadBrandKit } from '@/server/marketing/store.js';
import { loadAssets } from '@/server/marketing/standard-video/assets.js';
import { ffmpegAvailable } from '@/server/marketing/standard-video/ffmpeg.js';
import { startStandardRender, StandardVideoError } from '@/server/marketing/standard-video/jobs.js';
import { getMediaStorage } from '@/server/marketing/standard-video/storage.js';
import { sampleSpec } from '@/server/marketing/standard-video/templates.js';

/**
 * POST /api/marketing/standard-video/sample: makes a 4-second test video with this business's brand colours and logo, to
 * check that Standard Video works on this server. It uses no paid service and creates no content item.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    if (!ffmpegAvailable()) return void res.status(501).json({ ok: false, message: 'The video encoder (FFmpeg) is not available on this server.' });
    const storage = getMediaStorage();
    const kit = await loadBrandKit(tenant.id);
    const { assets } = await loadAssets({ ids: kit.logoUrl ? ['logo'] : [], tenantId: tenant.id, storage, logoUrl: kit.logoUrl });
    const { taskId } = await startStandardRender({ tenantId: tenant.id, spec: sampleSpec(kit, assets.has('logo')), assets, storage });
    res.status(202).json({ ok: true, taskId, status: 'processing', statusUrl: `/api/marketing/standard-video/${taskId}`, storage: storage.describe().persistent ? 'persistent' : 'temporary', message: 'The test video has started.' });
  } catch (error) {
    res.status(error instanceof StandardVideoError ? 422 : 500).json({ ok: false, message: error instanceof StandardVideoError ? error.publicMessage : 'The test video could not be started.' });
  }
}
