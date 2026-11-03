import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { isUsableVideoLink, ownVideoLink } from '@/lib/marketing-content.js';
import { checkVideo } from '@/server/marketing/providers.js';
import { getContent, saveContent } from '@/server/marketing/store.js';
import { getMediaStorage } from '@/server/marketing/standard-video/storage.js';
import { copyRemoteVideo } from '@/server/marketing/video-copy.js';
import { text } from '../../../shared.js';

/**
 * GET /api/marketing/content/:contentId/video: where the video is. When the provider reports it finished, the link to the
 * real video file is saved on the content and returned. A video is only "ready" when that link exists. If it failed,
 * the content goes back to "not made" so it can be started again.
 * A finished video from a provider arrives as a temporary link, so the real file is copied into this business's own storage first.
 * "Ready" is only reported once that copy exists and has been checked. If the copy fails, the video stays "being made" and the
 * next check tries again, so a video that was already paid for is never lost and never started a second time.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const current = await getContent(tenant.id, text(req.params.contentId, 36));
    if (!current || current.kind !== 'video' || !current.video) return void res.status(404).json({ error: 'That video was not found.' });
    const render = current.video.render;
    res.set('Cache-Control', 'no-store');
    if (render.status === 'ready') return void res.json({ ok: true, status: 'ready', url: render.url, provider: render.provider, item: current });
    if (render.status !== 'processing' || !render.taskId || !render.provider) return void res.json({ ok: true, status: 'not_started', message: 'No video has been started for this content.', item: current });

    const checked = await checkVideo(render.taskId, render.provider, { tenantId: tenant.id, contentId: current.id });
    if (!checked.ok) return void res.status(502).json({ ok: false, status: 'processing', message: checked.message });
    const { state } = checked;
    if (state.status === 'processing') return void res.json({ ok: true, status: 'processing', message: state.message, ...(state.progress !== undefined && { progress: state.progress }), taskId: render.taskId });
    const now = new Date().toISOString();
    if (state.status === 'succeeded' && !isUsableVideoLink(state.url)) state.status = 'failed', state.message = 'The provider said the video was done but did not give a usable link, so no video is available.';
    if (state.status === 'succeeded' && state.url) {
      let url = state.url;
      if (!ownVideoLink.test(url)) {
        try { url = await copyRemoteVideo({ url, tenantId: tenant.id, videoId: render.taskId, storage: getMediaStorage() }); }
        catch (error) {
          console.error('finished video could not be copied:', error instanceof Error ? error.message.slice(0, 160) : 'unknown');
          return void res.json({ ok: true, status: 'processing', message: 'The video is finished. Saving it now.', taskId: render.taskId });
        }
      }
      const item = { ...current, video: { ...current.video, render: { status: 'ready' as const, url, provider: checked.provider } }, updatedAt: now };
      await saveContent(tenant.id, item);
      return void res.json({ ok: true, status: 'ready', url, provider: checked.provider, notice: 'Saved on your Connection Pilot storage.', item });
    }
    const item = { ...current, video: { ...current.video, render: { status: 'not_generated' as const } }, updatedAt: now };
    await saveContent(tenant.id, item);
    res.json({ ok: false, status: 'failed', message: state.message ?? 'The video could not be made.', item });
  } catch { res.status(500).json({ ok: false, message: 'Could not check the video. Please try again.' }); }
}
