import { createWriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { ownVideoLink } from '@/lib/marketing-content.js';
import { assertPublic } from './standard-video/assets.js';
import { isSafeId, type MediaStorage } from './standard-video/storage.js';

export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export class VideoCopyError extends Error { constructor(message: string) { super(message); this.name = 'VideoCopyError'; } }

/**
 * A finished video from a provider such as Runway arrives as a temporary web link that expires. This copies the real file into
 * the business's own storage, so the video does not disappear. Only https links to public addresses are followed, the size
 * is capped, and the file must really be an MP4 or QuickTime video before it is kept.
 * Returns the app's own link for the video. Nothing is returned for a file that could not be copied and checked.
 */
export async function copyRemoteVideo({ url, tenantId, videoId, storage, timeoutMs = 120_000 }: { url: string; tenantId: string; videoId: string; storage: MediaStorage; timeoutMs?: number }): Promise<string> {
  const id = isSafeId(videoId) ? videoId : randomUUID();
  const own = `/api/marketing/media/videos/${id}.mp4`;
  if (ownVideoLink.test(url)) return url;
  if (await storage.hasVideo(tenantId, id)) return own; // already copied (for example by an earlier check)

  let target = new URL(url);
  const dir = await storage.makeTempDir(id.slice(0, 40));
  const file = path.join(dir, 'video.mp4');
  try {
    let response: Response | null = null;
    for (let hop = 0; hop < 4 && !response; hop += 1) {
      await assertPublic(target);
      const attempt = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'video/mp4,video/*' } });
      if (attempt.status >= 300 && attempt.status < 400 && attempt.headers.get('location')) { target = new URL(attempt.headers.get('location')!, target); continue; }
      response = attempt;
    }
    if (!response) throw new VideoCopyError('The video link redirected too many times.');
    if (!response.ok || !response.body) throw new VideoCopyError(`The finished video could not be downloaded (${response.status}).`);
    if (Number(response.headers.get('content-length') ?? 0) > MAX_VIDEO_BYTES) throw new VideoCopyError('The finished video is too large to keep.');
    let seen = 0;
    const capped = Readable.fromWeb(response.body as never).on('data', (chunk: Buffer) => { seen += chunk.length; if (seen > MAX_VIDEO_BYTES) capped.destroy(new VideoCopyError('The finished video is too large to keep.')); });
    await pipeline(capped, createWriteStream(file, { mode: 0o600 }));
    // it must really be a video file: MP4 and QuickTime files carry "ftyp" in their first bytes
    const handle = await open(file, 'r'); const head = Buffer.alloc(12); await handle.read(head, 0, 12, 0); await handle.close();
    if (seen < 1024 || head.subarray(4, 8).toString('latin1') !== 'ftyp') throw new VideoCopyError('What came back was not a playable video file.');
    await storage.saveVideo(tenantId, id, file);
    return own;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}
