import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { videoModes, type VideoMode } from '@/lib/marketing-content.js';
import { startVideo } from '@/server/marketing/providers.js';
import { getContent, saveContent } from '@/server/marketing/store.js';
import { text } from '../../../shared.js';

/**
 * POST /api/marketing/content/:contentId/video { mode?: 'standard' | 'ai' }
 * Starts making the video. "standard" (the default) draws it on this server with FFmpeg: no per-video fee. "ai" uses
 * Runway, and only runs when it is asked for by name. It returns straight away with a task id; the video is not made yet.
 * Check on it with GET on the same address.
 * Calling it again while a video is already being made does not start a second one.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const current = await getContent(tenant.id, text(req.params.contentId, 36));
    if (!current) return void res.status(404).json({ error: 'That content was not found.' });
    if (current.kind === 'video' && current.video?.render.status === 'processing') return void res.status(202).json({ ok: true, alreadyStarted: true, status: 'processing', taskId: current.video.render.taskId, message: 'This video is already being made. Check on it in a minute.', item: current });
    if (current.kind === 'video' && current.video?.render.status === 'ready') return void res.json({ ok: true, status: 'ready', url: current.video.render.url, message: 'This video was already made.', item: current });

    const mode: VideoMode = (videoModes as readonly string[]).includes(req.body?.mode) ? req.body.mode : 'standard';
    const started = await startVideo(current, { tenantId: tenant.id, contentId: current.id }, undefined, mode);
    if (!started.ok) console.error('video not started:', started.message.slice(0, 200));
    if (!started.ok) return void res.status(started.providerRequired ? 501 : 422).json({ ok: false, providerRequired: started.providerRequired, message: started.message });
    if (mode === 'ai') console.info(`AI video started: task ${started.taskId.slice(0, 8)}, estimated credits ${started.estimatedCredits ?? 'unknown'}, ${current.video?.durationSeconds}s`);
    const item = { ...current, video: { ...current.video!, mode, render: { status: 'processing' as const, taskId: started.taskId, provider: started.provider } }, updatedAt: new Date().toISOString() };
    await saveContent(tenant.id, item);
    res.status(202).json({ ok: true, status: 'processing', taskId: started.taskId, provider: started.provider, estimatedCredits: started.estimatedCredits, notice: started.note, message: 'The video has started. It is not made yet.', item });
  } catch { res.status(500).json({ ok: false, message: 'The video was NOT started, because something went wrong. Please try again.' }); }
}
