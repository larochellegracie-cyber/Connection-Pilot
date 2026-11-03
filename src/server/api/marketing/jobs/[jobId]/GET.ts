import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { finishJob, getMarketingJob } from '@/server/marketing/marketing-jobs.js';
import { getGenerationProgress, isGenerating } from '@/server/marketing/video-generation.js';
import { text } from '../../shared.js';

/**
 * GET /api/marketing/jobs/:jobId: where one Marketing Job stands, for the signed-in business only (another business's job is simply
 * not found). While the video is being made it reports progress by scene; when it is done it returns the video's link and the caption.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    let job = await getMarketingJob(tenant.id, text(req.params.jobId, 36));
    if (!job) return void res.status(404).json({ error: 'That video request was not found.' });
    // "generating" with nobody working on it means the server restarted partway: say so instead of waiting forever
    if (job.status === 'generating' && !isGenerating(job.id)) {
      const result = { video_url: null, caption: job.storyboard?.caption ?? '', hashtags: job.storyboard?.hashtags ?? [], cta: job.storyboard?.cta ?? '', total_seconds: job.storyboard?.total_seconds ?? 0, scene_count: job.storyboard?.scenes.length ?? 0, provider: job.storyboard?.engine === 'animated' ? 'Pilot animation' : 'Runway', estimated_credits: null, music: null, engine: job.storyboard?.engine ?? 'runway', library_item_id: null, error: 'The server restarted while your video was being made. Say “yes” and I’ll make it again.', finished_at: new Date().toISOString() };
      await finishJob(tenant.id, job.id, 'failed', result);
      job = { ...job, status: 'failed', result };
    }
    res.json({ id: job.id, status: job.status, subject: job.brief.main_subject, progress: job.status === 'generating' ? getGenerationProgress(job.id) : null, result: job.result });
  } catch { res.status(500).json({ error: 'Unable to check on that video right now.' }); }
}
