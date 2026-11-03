import dns from 'node:dns/promises';
import net from 'node:net';
import type { Assets } from './draw.js';
import type { MediaStorage } from './storage.js';
import { assetsNeeded, type VideoSpec } from './spec.js';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const imageTypes = /^image\/(png|jpeg|webp)/i;

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

export async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('Only https links can be used for images.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('That address is not allowed.');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('That address is not allowed.');
}

/** Downloads a business's own logo or product image from a public https link, with size, type and address checks. */
export async function fetchPublicImage(link: string, { timeoutMs = 8000 }: { timeoutMs?: number } = {}): Promise<Buffer> {
  let url = new URL(link);
  for (let hop = 0; hop < 4; hop += 1) {
    await assertPublic(url);
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'image/png,image/jpeg,image/webp' } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = new URL(response.headers.get('location')!, url); continue; }
    if (!response.ok) throw new Error(`The image could not be downloaded (${response.status}).`);
    if (!imageTypes.test(response.headers.get('content-type') ?? '')) throw new Error('That link is not a PNG, JPEG or WebP image.');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new Error('That image is too large (over 3 MB).');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('That image is too large (over 3 MB).');
    return bytes;
  }
  throw new Error('The image link redirected too many times.');
}

async function toImage(bytes: Buffer) {
  // loaded only when a video is made, so the app still starts on a server where the drawing library is unavailable
  const { loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(bytes);
  if (image.width * image.height > MAX_PIXELS) throw new Error('That image is too large to use.');
  return image;
}

/**
 * Loads the pictures a plan uses. "logo" comes from the business's logo link (when it has one); every other id is a file in
 * that business's own storage. Pictures that cannot be loaded are reported, not guessed at.
 */
export async function loadAssets({ ids, tenantId, storage, logoUrl }: { ids: string[]; tenantId: string; storage: MediaStorage; logoUrl?: string | null }): Promise<{ assets: Assets; missing: string[] }> {
  const assets: Assets = new Map(); const missing: string[] = [];
  for (const id of ids) {
    try {
      if (id === 'logo') { if (!logoUrl) throw new Error('no logo'); assets.set(id, await toImage(await fetchPublicImage(logoUrl))); continue; }
      const stored = await storage.openAsset(tenantId, id);
      if (!stored) throw new Error('not found');
      assets.set(id, await toImage(await stored.read()));
    } catch { missing.push(id); }
  }
  return { assets, missing };
}

export const loadAssetsFor = (spec: VideoSpec, options: Omit<Parameters<typeof loadAssets>[0], 'ids'>) => loadAssets({ ...options, ids: assetsNeeded(spec) });
