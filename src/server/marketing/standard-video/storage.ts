import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Where Standard Video files live. The rest of the video system only talks to this interface, so moving to object
 * storage (S3 and similar) later means writing another implementation of it, nothing else.
 *
 *   <root>/tenants/<businessId>/videos/<videoId>.mp4   finished videos
 *   <root>/tenants/<businessId>/assets/<assetId>       the business's own photos and logos
 *   <root>/tmp/<jobId>/                                 working files, removed as soon as a job ends
 *
 * Every path is built from the business id of the signed-in session, never from anything in a web address, and every id
 * is checked, so one business can never reach another's files.
 */
export type AssetKind = 'product' | 'logo' | 'photo' | 'other';
export const assetKinds: readonly AssetKind[] = ['product', 'logo', 'photo', 'other'];
/** What an uploaded picture is, so Pilot can pick the right one for a video. */
export type AssetMeta = { id: string; kind: AssetKind; label: string; description: string; tags: string[]; originalName: string; mime: 'image/jpeg' | 'image/png'; width: number; height: number; bytes: number; createdAt: string };

export type VideoFile = { size: number; stream: (range?: { start: number; end: number }) => NodeJS.ReadableStream };

export interface MediaStorage {
  describe(): { kind: string; persistent: boolean; location: string };
  /** A private folder for one render's working files. */
  makeTempDir(jobId: string): Promise<string>;
  /** Moves a finished video out of the working folder into the business's own storage. */
  saveVideo(tenantId: string, videoId: string, fromPath: string): Promise<void>;
  openVideo(tenantId: string, videoId: string): Promise<VideoFile | null>;
  hasVideo(tenantId: string, videoId: string): Promise<boolean>;
  deleteVideo(tenantId: string, videoId: string): Promise<void>;
  /** Pictures Pilot made for a post (JPEG). */
  putImage(tenantId: string, imageId: string, bytes: Buffer): Promise<void>;
  openImage(tenantId: string, imageId: string): Promise<{ size: number; read: () => Promise<Buffer> } | null>;
  deleteImage(tenantId: string, imageId: string): Promise<void>;
  openAsset(tenantId: string, assetId: string): Promise<{ size: number; read: () => Promise<Buffer> } | null>;
  putAsset(tenantId: string, meta: AssetMeta, bytes: Buffer): Promise<void>;
  listAssets(tenantId: string): Promise<AssetMeta[]>;
  getAssetMeta(tenantId: string, assetId: string): Promise<AssetMeta | null>;
  updateAssetMeta(tenantId: string, meta: AssetMeta): Promise<void>;
  deleteAsset(tenantId: string, assetId: string): Promise<void>;
  assetPath(tenantId: string, assetId: string): string;
  /** Total bytes this business uses. */
  usage(tenantId: string): Promise<number>;
  /** Removes working folders older than `maxAgeMs`. Returns how many were removed. */
  sweepTemp(maxAgeMs: number): Promise<number>;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/;
export const isSafeId = (value: unknown): value is string => typeof value === 'string' && idPattern.test(value);

export class LocalVolumeStorage implements MediaStorage {
  constructor(private readonly root: string, private readonly persistent: boolean) {}

  describe() { return { kind: 'local-volume', persistent: this.persistent, location: this.root }; }

  private inside(...parts: string[]): string {
    const resolved = path.resolve(this.root, ...parts);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error('That path is not allowed.');
    return resolved;
  }
  private videoPath(tenantId: string, videoId: string) {
    if (!isSafeId(tenantId) || !isSafeId(videoId)) throw new Error('That video id is not valid.');
    return this.inside('tenants', tenantId, 'videos', `${videoId}.mp4`);
  }
  private imagePath(tenantId: string, imageId: string) {
    if (!isSafeId(tenantId) || !isSafeId(imageId)) throw new Error('That image id is not valid.');
    return this.inside('tenants', tenantId, 'images', `${imageId}.jpg`);
  }
  async putImage(tenantId: string, imageId: string, bytes: Buffer) {
    const file = this.imagePath(tenantId, imageId);
    await mkdir(path.dirname(file), { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${file}.partial`, bytes, { mode: 0o600 });
    await rename(`${file}.partial`, file); // appears whole or not at all
  }
  async openImage(tenantId: string, imageId: string) {
    let file: string;
    try { file = this.imagePath(tenantId, imageId); } catch { return null; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const { readFile } = await import('node:fs/promises');
    return { size: info.size, read: () => readFile(file) };
  }
  async deleteImage(tenantId: string, imageId: string) { await rm(this.imagePath(tenantId, imageId), { force: true }); }
  assetPath(tenantId: string, assetId: string) {
    if (!isSafeId(tenantId) || !isSafeId(assetId)) throw new Error('That asset id is not valid.');
    return this.inside('tenants', tenantId, 'assets', assetId);
  }

  async makeTempDir(jobId: string) {
    if (!isSafeId(jobId)) throw new Error('That job id is not valid.');
    const base = this.inside('tmp');
    await mkdir(base, { recursive: true });
    return mkdtemp(path.join(base, `${jobId}-`));
  }

  async saveVideo(tenantId: string, videoId: string, fromPath: string) {
    const target = this.videoPath(tenantId, videoId);
    await mkdir(path.dirname(target), { recursive: true });
    await rename(fromPath, target); // same volume, so the move is instant and the file appears whole or not at all
  }

  async openVideo(tenantId: string, videoId: string): Promise<VideoFile | null> {
    let file: string;
    try { file = this.videoPath(tenantId, videoId); } catch { return null; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return { size: info.size, stream: (range) => createReadStream(file, range) };
  }
  async hasVideo(tenantId: string, videoId: string) { return (await this.openVideo(tenantId, videoId)) !== null; }
  async deleteVideo(tenantId: string, videoId: string) { await rm(this.videoPath(tenantId, videoId), { force: true }); }

  async openAsset(tenantId: string, assetId: string) {
    let file: string;
    try { file = this.assetPath(tenantId, assetId); } catch { return null; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const { readFile } = await import('node:fs/promises');
    return { size: info.size, read: () => readFile(file) };
  }

  async putAsset(tenantId: string, meta: AssetMeta, bytes: Buffer) {
    const file = this.assetPath(tenantId, meta.id);
    await mkdir(path.dirname(file), { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    // written under a temporary name and then renamed, so a picture never appears half-written
    await writeFile(`${file}.partial`, bytes, { mode: 0o600 });
    await writeFile(`${file}.meta.json.partial`, JSON.stringify(meta), { mode: 0o600 });
    await rename(`${file}.partial`, file);
    await rename(`${file}.meta.json.partial`, `${file}.meta.json`);
  }
  async getAssetMeta(tenantId: string, assetId: string): Promise<AssetMeta | null> {
    let file: string;
    try { file = this.assetPath(tenantId, assetId); } catch { return null; }
    const { readFile } = await import('node:fs/promises');
    try { const parsed = JSON.parse(await readFile(`${file}.meta.json`, 'utf8')) as AssetMeta; return parsed?.id === assetId ? parsed : null; } catch { return null; }
  }
  async listAssets(tenantId: string): Promise<AssetMeta[]> {
    if (!isSafeId(tenantId)) return [];
    const dir = this.inside('tenants', tenantId, 'assets');
    const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.meta.json'));
    const found = await Promise.all(names.map((name) => this.getAssetMeta(tenantId, name.slice(0, -'.meta.json'.length))));
    return found.filter((meta): meta is AssetMeta => meta !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateAssetMeta(tenantId: string, meta: AssetMeta) {
    const file = this.assetPath(tenantId, meta.id);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${file}.meta.json.partial`, JSON.stringify(meta), { mode: 0o600 });
    await rename(`${file}.meta.json.partial`, `${file}.meta.json`);
  }
  async deleteAsset(tenantId: string, assetId: string) {
    const file = this.assetPath(tenantId, assetId);
    await rm(file, { force: true }); await rm(`${file}.meta.json`, { force: true });
  }

  async usage(tenantId: string) {
    if (!isSafeId(tenantId)) return 0;
    const sizeOf = async (dir: string): Promise<number> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      let total = 0;
      for (const entry of entries) { const full = path.join(dir, entry.name); total += entry.isDirectory() ? await sizeOf(full) : (await stat(full).catch(() => null))?.size ?? 0; }
      return total;
    };
    return sizeOf(this.inside('tenants', tenantId));
  }

  async sweepTemp(maxAgeMs: number) {
    const base = this.inside('tmp');
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      const full = path.join(base, entry.name);
      const info = await stat(full).catch(() => null);
      if (info && Date.now() - info.mtimeMs > maxAgeMs) { await rm(full, { recursive: true, force: true }); removed += 1; }
    }
    return removed;
  }
}

let current: MediaStorage | null = null;

/**
 * MARKETING_MEDIA_DIR should be the folder a Railway volume is mounted at (for example /data/marketing). Without it the
 * app uses a temporary folder: videos still work, but they disappear whenever the server restarts or redeploys.
 */
export function getMediaStorage(): MediaStorage {
  if (current) return current;
  const configured = process.env.MARKETING_MEDIA_DIR?.trim();
  current = configured ? new LocalVolumeStorage(configured, true) : new LocalVolumeStorage(path.join(os.tmpdir(), 'connection-pilot-media'), false);
  return current;
}
export function setMediaStorage(storage: MediaStorage | null) { current = storage; }
