import { createHash } from 'node:crypto';
import { normaliseUrl } from './firecrawl-retrieval.js';
import { saveBusinessImage } from './standard-video/business-assets.js';
import { sniffImage } from './standard-video/images.js';
import { getMediaStorage, type MediaStorage } from './standard-video/storage.js';

/**
 * Pictures from the owner's website. When Pilot reads a website with Firecrawl it also notes the pictures on the page; this picks the few
 * that look like real business pictures (the logo and photos of the work, the products or the team), downloads them, and saves them to
 * "Photos Pilot can use" next to the owner's own uploads. Each one is labelled "From website – <what it shows>" and tagged "website" so
 * the owner can see where it came from and delete any they don't want.
 *
 * Kept deliberately small: icons, tracking pixels, sprites, social and payment badges, banners and anything small are skipped, a few
 * well-sized pictures are kept (at most MAX_PHOTOS per read and MAX_WEBSITE_PHOTOS in the library), the largest version of a picture wins,
 * and a picture already saved (same address or same contents) is never saved twice.
 */
export const MAX_PHOTOS = 8;
export const MAX_WEBSITE_PHOTOS = 14;
const MAX_DOWNLOADS = 16;
const MAX_BYTES = 6 * 1024 * 1024;
const MIN_SIDE = 400;
const MIN_PIXELS = 250_000;
const DASH = '–';

export type ImageCandidate = { url: string; alt: string; role: 'logo' | 'og' | 'page' };
export type ImportedImage = { id: string; label: string; kind: 'logo' | 'photo'; url: string };
export type ImageImport = { saved: ImportedImage[]; skipped: number };

// ---- finding and filtering candidates -----------------------------------------------------------------------------------------

const NOT_A_PHOTO = /(?:sprite|icons?\b|favicon|pixel|tracking|spacer|blank|placeholder|loader|spinner|badge|seal|payment|visa|mastercard|paypal|amex|arrow|chevron|\bstars?\b|rating|facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest|social|emoji|flags?\b|avatar|gravatar|captcha|analytics|doubleclick|googletagmanager|1x1|\bgif\b|\bsvg\b|\bico\b|divider|bullet|shadow|overlay|pattern|texture|background-?(?:pattern|tile))/i;
const TRACKING_HOST = /(?:google-analytics|doubleclick|googletagmanager|facebook\.com\/tr|scorecardresearch|hotjar|clarity\.ms|px\.ads|pixel\.)/i;
const RASTER_EXT = /\.(?:jpe?g|png|webp)(?:$|[?#])/i;
const OTHER_EXT = /\.(?:svg|gif|ico|avif|bmp|tiff?|mp4|pdf|css|js)(?:$|[?#])/i;

/** Smallest side the address itself admits to (…-300x200.jpg, ?w=320), or null when it says nothing. */
function sizeHint(url: string): number | null {
  const m = /[-_/](\d{2,4})x(\d{2,4})(?:\.|\/|$|[?#])/.exec(url); if (m) return Math.min(Number(m[1]), Number(m[2]));
  const w = /[?&](?:w|width)=(\d{2,4})\b/i.exec(url); return w ? Number(w[1]) : null;
}

/** The address with size suffixes and query strings removed, so the same picture at two sizes counts once. */
const baseOf = (url: string) => url.replace(/[?#].*$/, '').replace(/[-_](\d{2,4})x(\d{2,4})(?=\.[a-z]+$)/i, '').toLowerCase();

export function looksLikeRealPhoto(url: string, alt = ''): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (TRACKING_HOST.test(url) || OTHER_EXT.test(url) || NOT_A_PHOTO.test(url.replace(/^https?:\/\/[^/]+/, '')) || NOT_A_PHOTO.test(alt)) return false;
  const hint = sizeHint(url); if (hint !== null && hint < MIN_SIDE) return false;
  return RASTER_EXT.test(url) || !/\.[a-z0-9]{2,5}(?:$|[?#])/i.test(url.replace(/^https?:\/\/[^/]+/, '')); // a known picture type, or a CDN address with no extension (checked by content later)
}

type Scrape = { markdown?: unknown; images?: unknown; branding?: unknown; metadata?: { ogImage?: unknown } };

/** Every picture a scraped page mentions, with the alt text the page gave it, logo first, most informative first. */
export function collectCandidates(scrapes: Scrape[], base: string): ImageCandidate[] {
  const found = new Map<string, ImageCandidate>();
  const add = (raw: unknown, alt: string, role: ImageCandidate['role']) => {
    if (typeof raw !== 'string' || !raw.trim() || /^data:/i.test(raw.trim())) return;
    let url: string; try { url = new URL(raw.trim().replace(/&amp;/g, '&'), base).toString(); } catch { return; }
    if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
    const key = baseOf(url); const current = found.get(key);
    if (!current) found.set(key, { url, alt, role });
    else { if (!current.alt && alt) current.alt = alt; if ((sizeHint(url) ?? 0) > (sizeHint(current.url) ?? 0) || (sizeHint(current.url) !== null && sizeHint(url) === null)) current.url = url; if (role === 'logo') current.role = 'logo'; }
  };
  for (const scrape of scrapes) {
    const b = (scrape.branding && typeof scrape.branding === 'object' ? scrape.branding : {}) as { logo?: unknown; images?: { logo?: unknown; ogImage?: unknown } };
    add(b.logo, 'logo', 'logo'); add(b.images?.logo, 'logo', 'logo');
    for (const match of (typeof scrape.markdown === 'string' ? scrape.markdown : '').matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(match[2], match[1].trim(), 'page');
    for (const item of Array.isArray(scrape.images) ? scrape.images : []) add(item, '', 'page');
    add(scrape.metadata?.ogImage, '', 'og'); add(b.images?.ogImage, '', 'og');
  }
  const order = { logo: 0, page: 1, og: 2 };
  const hasExtension = (url: string) => /\.[a-z0-9]{2,5}(?:$|[?#])/i.test(url.replace(/^https?:\/\/[^/]+/, ''));
  return [...found.values()].filter((c) => (c.role === 'logo' ? RASTER_EXT.test(c.url) || !hasExtension(c.url) : looksLikeRealPhoto(c.url, c.alt)))
    .sort((a, b) => order[a.role] - order[b.role] || Number(!!b.alt) - Number(!!a.alt) || (sizeHint(b.url) ?? 0) - (sizeHint(a.url) ?? 0));
}

// ---- labels -----------------------------------------------------------------------------------------------------------------------

const GENERIC = /^(?:image|img|photo|picture|pic|banner|slide|slider|hero|header|logo|background|thumbnail|untitled|uploaded|upload|dsc|screenshot|group|rectangle|layer|copy|final|new|the|and|with|for|from|into|onto|that|this|are|its|his|her|their|over|\d+)$/i;
const words = (text: string) => text.replace(/\.[a-z0-9]{2,4}$/i, '').split(/[^A-Za-z]+/).filter((w) => w.length > 2 && !GENERIC.test(w));

/** A file name that reads like words ("pool-closing-crew.jpg"), not an id ("4xbs810isbzme78hfr8latv673jm.jpg"). */
const meaningfulFile = (stem: string) => /[-_ ]/.test(stem) && stem.length <= 70 && !stem.split(/[-_ ]+/).some((token) => token.length >= 6 && /\d/.test(token) && /[a-z]/i.test(token));

/** "From website – pool technician", from the alt text if it says something, else from the file name if that reads like words, else just "photo". */
export function labelFor(candidate: ImageCandidate, businessName = ''): string {
  if (candidate.role === 'logo') return `From website ${DASH} logo`;
  const alt = candidate.alt.trim().toLowerCase() === businessName.trim().toLowerCase() ? '' : candidate.alt; // the business's own name says nothing about the picture
  let what = words(alt).slice(0, 6).join(' ');
  if (!what) {
    let stem = ''; try { stem = decodeURIComponent(new URL(candidate.url).pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]{2,4}$/i, ''); } catch { /* none */ }
    if (meaningfulFile(stem)) what = words(stem).slice(0, 5).join(' ');
  }
  return `From website ${DASH} ${what ? what.toLowerCase() : 'photo'}`.slice(0, 120);
}

// ---- downloading ------------------------------------------------------------------------------------------------------------------

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Downloads one picture: https only, no private addresses (also after redirects), a size limit, and a time limit. Returns null if it does not qualify. */
export async function downloadImage(start: string, fetcher: Fetcher = fetch): Promise<Buffer | null> {
  let url = start;
  for (let hop = 0; hop < 3; hop += 1) {
    try { normaliseUrl(url); } catch { return null; }
    let response: Response;
    try { response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(9000), headers: { Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.5', 'User-Agent': 'ConnectionPilot/1.0 (+website photos)' } }); } catch { return null; }
    if ([301, 302, 303, 307, 308].includes(response.status)) { const next = response.headers.get('location'); if (!next) return null; try { url = new URL(next, url).toString(); } catch { return null; } continue; }
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? ''; if (type && !/^image\//i.test(type) && !/octet-stream/i.test(type)) return null;
    const length = Number(response.headers.get('content-length') ?? 0); if (length > MAX_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length || bytes.length > MAX_BYTES || !sniffImage(bytes)) return null;
    return bytes;
  }
  return null;
}

async function dimensions(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try { const { loadImage } = await import('@napi-rs/canvas'); const image = await loadImage(bytes); return { width: image.width, height: image.height }; } catch { return null; }
}

const fingerprint = (bytes: Buffer) => `web-${createHash('sha1').update(bytes).digest('hex').slice(0, 12)}`;
const sourceNote = (url: string) => `From the website: ${url}`.slice(0, 300);

/** Is this picture good enough to keep? Photos need real size and a normal shape; a logo only needs to be readable. */
export function goodEnough(candidate: ImageCandidate, size: { width: number; height: number }): boolean {
  const small = Math.min(size.width, size.height); const long = Math.max(size.width, size.height);
  if (candidate.role === 'logo') return small >= 48;
  return small >= MIN_SIDE && size.width * size.height >= MIN_PIXELS && long / small <= 3;
}

/** Downloads the best candidates and saves them to the business's photos. Never throws: pictures are a bonus, not the point of reading a website. */
export async function importWebsiteImages({ tenantId, candidates, businessName = '', storage = getMediaStorage(), fetcher = fetch }: { tenantId: string; candidates: ImageCandidate[]; businessName?: string; storage?: MediaStorage; fetcher?: Fetcher }): Promise<ImageImport> {
  const saved: ImportedImage[] = []; let skipped = 0;
  try {
    const existing = await storage.listAssets(tenantId);
    const have = new Set(existing.flatMap((asset) => [...asset.tags, asset.description]));
    let websitePhotos = existing.filter((asset) => asset.tags.includes('website') && asset.kind !== 'logo').length;
    const labels = new Set(existing.map((asset) => asset.label));
    const queue = candidates.filter((candidate) => !have.has(sourceNote(candidate.url))).slice(0, MAX_DOWNLOADS);
    let photos = 0; let logoDone = false;

    for (let i = 0; i < queue.length; i += 4) {
      const batch = queue.slice(i, i + 4);
      const loaded = await Promise.all(batch.map(async (candidate) => { const bytes = await downloadImage(candidate.url, fetcher); return { candidate, bytes, size: bytes ? await dimensions(bytes) : null }; }));
      for (const { candidate, bytes, size } of loaded) {
        const isLogo = candidate.role === 'logo';
        if (!bytes || !size || !goodEnough(candidate, size)) { skipped += 1; continue; }
        if (isLogo ? logoDone || existing.some((asset) => asset.kind === 'logo' && asset.tags.includes('website')) : photos >= MAX_PHOTOS || websitePhotos >= MAX_WEBSITE_PHOTOS) { skipped += 1; continue; }
        const print = fingerprint(bytes); if (have.has(print)) { skipped += 1; continue; }
        let label = labelFor(candidate, businessName); for (let n = 2; labels.has(label); n += 1) label = `${label.replace(/ \d+$/, '')} ${n}`;
        try {
          const meta = await saveBusinessImage({ tenantId, bytes, originalName: label, storage, fields: { kind: isLogo ? 'logo' : 'photo', label, description: sourceNote(candidate.url), tags: ['website', print] } });
          labels.add(label); have.add(print);
          saved.push({ id: meta.id, label: meta.label, kind: isLogo ? 'logo' : 'photo', url: `/api/marketing/assets/${meta.id}` });
          if (isLogo) logoDone = true; else { photos += 1; websitePhotos += 1; }
        } catch { skipped += 1; }
      }
      if (photos >= MAX_PHOTOS && logoDone) break;
    }
  } catch { /* the library could not be read: nothing is saved */ }
  return { saved, skipped };
}

/** One sentence for the owner about what was saved. */
export function describeImport(result: ImageImport): string {
  const logos = result.saved.filter((image) => image.kind === 'logo').length; const photos = result.saved.length - logos;
  if (!result.saved.length) return '';
  const parts = [photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '', logos ? 'your logo' : ''].filter(Boolean).join(' and ');
  return `I saved ${parts} from your website to “Photos Pilot can use”, labelled “From website”. Delete any you don’t want.`;
}
