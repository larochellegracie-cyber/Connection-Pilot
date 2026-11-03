import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getMediaStorage, isSafeId } from '@/server/marketing/standard-video/storage.js';

/**
 * GET /api/marketing/media/videos/:id.mp4: streams one of the signed-in business's own finished Standard Videos.
 * The business comes from the session, never from the address, so another business's video is simply not found.
 * Supports ranges (so players can seek) and ?download=1.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = String(req.params.file ?? '').replace(/\.mp4$/i, '');
    if (!isSafeId(id)) return void res.status(404).json({ error: 'That video was not found.' });
    const file = await getMediaStorage().openVideo(tenant.id, id);
    if (!file) return void res.status(404).json({ error: 'That video was not found.' });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="video-${id.slice(0, 8)}.mp4"`);
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (match && (match[1] || match[2])) {
      let start = match[1] ? Number(match[1]) : file.size - Number(match[2]);
      let end = match[1] && match[2] ? Number(match[2]) : file.size - 1;
      start = Math.max(0, start); end = Math.min(file.size - 1, end);
      if (start > end || start >= file.size) { res.setHeader('Content-Range', `bytes */${file.size}`); return void res.status(416).end(); }
      res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`); res.setHeader('Content-Length', String(end - start + 1));
      file.stream({ start, end }).pipe(res); return;
    }
    res.status(200); res.setHeader('Content-Length', String(file.size));
    file.stream().pipe(res);
  } catch { if (!res.headersSent) res.status(500).json({ error: 'Unable to load that video.' }); }
}
