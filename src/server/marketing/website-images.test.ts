import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { LocalVolumeStorage } from './standard-video/storage.js';
import { collectCandidates, describeImport, downloadImage, importWebsiteImages, labelFor, looksLikeRealPhoto } from './website-images.js';

const png = (w: number, h: number, shade = 80) => { const c = createCanvas(w, h); const ctx = c.getContext('2d'); ctx.fillStyle = `rgb(${shade},120,160)`; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.fillRect(w / 4, h / 4, w / 2, h / 2); return c.toBuffer('image/png'); };
const reply = (bytes: Buffer, type = 'image/png') => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });

describe('picking pictures that look like real business photos', () => {
  it('skips icons, tracking pixels, sprites, badges, svg/gif and addresses that say they are small', () => {
    for (const url of ['https://x.com/img/icon-phone.png', 'https://x.com/assets/sprite.png', 'https://www.facebook.com/tr?id=1', 'https://x.com/logo.svg', 'https://x.com/spinner.gif', 'https://x.com/payment-visa.png', 'https://x.com/pool-150x150.jpg', 'https://x.com/pool.jpg?w=200', 'data:image/png;base64,AAAA']) expect(looksLikeRealPhoto(url), url).toBe(false);
    for (const url of ['https://x.com/uploads/pool-closing-crew.jpg', 'https://cdn.x.com/4xbs810isbzme78hfr8latv673jm', 'https://x.com/team.webp?w=1200']) expect(looksLikeRealPhoto(url), url).toBe(true);
  });

  it('collects pictures from the page, puts the logo first, keeps the biggest size of the same picture, and uses the alt text', () => {
    const candidates = collectCandidates([{
      branding: { logo: 'https://cdn.x.com/logo-id', images: { ogImage: 'https://x.com/og.jpg' } },
      markdown: '![Pool technician cleaning a filter](https://x.com/wp/crew-300x200.jpg) ![](https://x.com/wp/crew-1200x800.jpg) ![icon](https://x.com/icon-pool.png) ![Our team](/team.jpg)',
      images: ['https://x.com/wp/crew-1200x800.jpg', 'https://x.com/tracker.gif'],
    }], 'https://x.com/');
    expect(candidates[0]).toMatchObject({ role: 'logo', url: 'https://cdn.x.com/logo-id' });
    const crew = candidates.filter((c) => c.url.includes('crew'));
    expect(crew).toHaveLength(1); expect(crew[0].url).toContain('1200x800'); expect(crew[0].alt).toBe('Pool technician cleaning a filter');
    expect(candidates.some((c) => c.url.includes('icon') || c.url.includes('tracker'))).toBe(false);
    expect(candidates.map((c) => c.role)).toEqual(['logo', 'page', 'page', 'og']); // photos before the social card
  });

  it('labels them “From website – …”', () => {
    expect(labelFor({ url: 'https://x.com/a.jpg', alt: 'logo', role: 'logo' })).toBe('From website – logo');
    expect(labelFor({ url: 'https://x.com/a.jpg', alt: 'Pool technician cleaning a filter', role: 'page' })).toBe('From website – pool technician cleaning filter');
    expect(labelFor({ url: 'https://x.com/uploads/pool-closing-crew.jpg', alt: '', role: 'page' })).toBe('From website – pool closing crew');
    expect(labelFor({ url: 'https://cdn.x.com/4xbs810isbzme78hfr8latv673jm.jpg', alt: 'image', role: 'page' })).toBe('From website – photo');
    expect(labelFor({ url: 'https://x.com/a.jpg', alt: 'Somerset Pool Service', role: 'page' }, 'Somerset Pool Service')).toBe('From website – photo');
  });
});

describe('saving them to Photos Pilot can use', () => {
  let dir: string; let storage: LocalVolumeStorage;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wimg-')); storage = new LocalVolumeStorage(dir, false); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const site: Record<string, Buffer> = { 'https://cdn.x.com/logo-id': png(240, 80), 'https://x.com/crew.jpg': png(1200, 800), 'https://x.com/small.jpg': png(300, 200), 'https://x.com/banner.jpg': png(1800, 300), 'https://x.com/team.jpg': png(900, 900, 120) };
  const fetcher = (async (url: string) => (site[url] ? reply(site[url]) : new Response('nope', { status: 404 }))) as never;
  const candidates = [{ url: 'https://cdn.x.com/logo-id', alt: 'logo', role: 'logo' as const }, { url: 'https://x.com/crew.jpg', alt: 'Pool technician', role: 'page' as const }, { url: 'https://x.com/small.jpg', alt: 'tiny', role: 'page' as const }, { url: 'https://x.com/banner.jpg', alt: 'banner strip', role: 'page' as const }, { url: 'https://x.com/team.jpg', alt: 'Our team', role: 'page' as const }, { url: 'https://x.com/missing.jpg', alt: '', role: 'page' as const }];

  it('saves the logo and the good photos, labelled and tagged, and skips small, banner-shaped and missing ones', async () => {
    const result = await importWebsiteImages({ tenantId: 'tenant-1', candidates, storage, fetcher });
    expect(result.saved.map((image) => image.label)).toEqual(['From website – logo', 'From website – pool technician', 'From website – our team']);
    expect(result.skipped).toBe(3);
    const assets = await storage.listAssets('tenant-1');
    expect(assets).toHaveLength(3);
    expect(assets.find((asset) => asset.kind === 'logo')).toBeTruthy();
    expect(assets.every((asset) => asset.tags.includes('website') && asset.description.startsWith('From the website: https://'))).toBe(true);
    expect(describeImport(result)).toContain('2 photos and your logo');
  });

  it('does not save the same picture twice when the website is read again, and keeps the owner’s own uploads', async () => {
    await storage.putAsset('tenant-1', { id: 'own-photo-1', kind: 'product', label: 'Chocolate cake', description: '', tags: [], originalName: 'cake.png', mime: 'image/png', width: 10, height: 10, bytes: 10, createdAt: new Date().toISOString() } as never, png(10, 10));
    await importWebsiteImages({ tenantId: 'tenant-1', candidates, storage, fetcher });
    const again = await importWebsiteImages({ tenantId: 'tenant-1', candidates, storage, fetcher });
    expect(again.saved).toHaveLength(0);
    expect(await storage.listAssets('tenant-1')).toHaveLength(4); // 1 of theirs + logo + 2 photos
  });

  it('never saves more than a handful of photos per read', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://x.com/p${i}.jpg`, alt: `Job ${'abcdefghijkl'[i]}`, role: 'page' as const }));
    const all = Object.fromEntries(many.map((c, i) => [c.url, png(900 + i, 700, 40 + i * 9)]));
    const result = await importWebsiteImages({ tenantId: 'tenant-2', candidates: many, storage, fetcher: (async (url: string) => (all[url] ? reply(all[url]) : new Response('', { status: 404 }))) as never });
    expect(result.saved).toHaveLength(8);
  });

  it('refuses private addresses, non-images and oversized files, even through a redirect', async () => {
    expect(await downloadImage('https://localhost/a.jpg', (async () => reply(png(500, 500))) as never)).toBeNull();
    expect(await downloadImage('https://x.com/a.jpg', (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as never)).toBeNull();
    expect(await downloadImage('https://x.com/a.jpg', (async () => new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) } })) as never)).toBeNull();
    expect(await downloadImage('https://x.com/a.jpg', (async () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.5/secret.png' } })) as never)).toBeNull();
    expect(await downloadImage('https://x.com/a.jpg', (async () => reply(png(500, 500))) as never)).toBeInstanceOf(Buffer);
  });
});

describe('labels keep the words that matter', () => {
  it('keeps "pool" for a pool company, drops filler words and "uploaded image"', () => {
    expect(labelFor({ url: 'https://c.net/x', alt: 'A man cleaning a pool with a brush, surrounded by trees', role: 'page' }, 'Somerset Pool Service')).toBe('From website – man cleaning pool brush surrounded trees');
    expect(labelFor({ url: 'https://c.net/kwlk0gu6ouo4jpzfhnalirgjq2hp', alt: 'Uploaded image', role: 'page' }, 'Somerset Pool Service')).toBe('From website – photo');
  });
});
