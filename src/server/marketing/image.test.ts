import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { Request, Response } from 'express';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const tenant = vi.hoisted(() => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
const store = vi.hoisted(() => ({ items: [] as any[], saved: [] as any[] }));
vi.mock('@/server/marketing/store.js', () => ({ listContent: async () => store.items, loadBrandKit: async () => ({ name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null }), saveContent: async (_t: string, item: any) => { store.saved.push(item); } }));
vi.mock('@/server/api/customers/tenant.js', () => ({ getTenant: vi.fn(async () => ({ id: tenant.id, businessName: 'Somerset Pool Service' })) }));

import { visualSpec } from './post-graphic';
import { choosePostImage, motionIdOf, removePostMedia, createPostImage, findSuitablePhoto, imageIdOf, pictureDescription } from './image';
import { saveBusinessImage } from './standard-video/business-assets';
import deletePhoto from '../api/marketing/assets/[assetId]/DELETE';
import { cleanImage } from '@/lib/marketing-content';
import imageFile from '../api/marketing/media/images/[file]/GET';
import { LocalVolumeStorage, setMediaStorage } from './standard-video/storage';

// the standard tests are about the plain branded graphic; generated artwork has its own tests (generated-art.test.ts)
process.env.PILOT_GENERATED_ART = 'off';

const brief = { businessName: 'Somerset Pool Service', businessType: 'Pool & outdoor services', location: 'Windsor-Essex', services: ['Pool opening', 'Pool closing'], brandVoice: { tone: 'Friendly', description: '' } };
const png = (w = 1024, h = 1024) => { const c = createCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, w, h); return { bytes: new Uint8Array(c.toBuffer('image/png')) }; };

let root: string; let storage: LocalVolumeStorage;
beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'img-test-')); storage = new LocalVolumeStorage(root, false); setMediaStorage(storage); });
afterAll(async () => { setMediaStorage(null); await rm(root, { recursive: true, force: true }); });

describe('the description sent to the picture maker', () => {
  const text = pictureDescription({ brief, platform: 'instagram', topic: 'Pool closing', scene: 'A winter cover being smoothed over a backyard pool at dusk.', hook: 'Close it early' });
  it('is built from the business and the topic, and the scene Pilot described', () => {
    expect(text).toContain('Somerset Pool Service'); expect(text).toContain('Windsor-Essex'); expect(text).toContain('Pool closing');
    expect(text).toContain('A winter cover being smoothed over a backyard pool at dusk.'); expect(text).toContain('friendly');
  });
  it('always forbids text, faces, before-and-after pictures and claims', () => {
    expect(text).toMatch(/NO text/); expect(text).toMatch(/no people at all|any people at all/); expect(text).toMatch(/no faces and no workers/); expect(text).toMatch(/before-and-after/); expect(text).toMatch(/results, prices or claims/);
  });
  it('never includes anything internal', () => { expect(text).not.toMatch(/\ba\d\b|photo a1|asset|alias/i); });
});

describe('making and keeping a post picture', () => {
  it('makes a JPEG with the right shape for the platform and keeps it in the business’s own storage', async () => {
    const make = vi.fn(async () => png(1536, 1024));
    const image = await createPostImage({ tenantId: tenant.id, brief, platform: 'facebook', topic: 'Pool closing', scene: 'A pool at dusk', hook: 'h', make });
    expect(make).toHaveBeenCalledWith(expect.stringContaining('A pool at dusk'), '1536x1024');
    expect(image.url).toMatch(/^\/api\/marketing\/media\/images\/[A-Za-z0-9_-]+\.jpg$/);
    const stored = await storage.openImage(tenant.id, imageIdOf(image)!);
    const bytes = await stored!.read();
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]); // really a JPEG
    expect(await storage.openImage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', imageIdOf(image)!)).toBeNull(); // another business cannot reach it
  });

  it('uses a square picture for Instagram and a tall one for TikTok', async () => {
    const make = vi.fn(async (_prompt: string, _size: string) => png());
    await createPostImage({ tenantId: tenant.id, brief, platform: 'instagram', topic: 't', scene: 's', hook: 'h', make });
    await createPostImage({ tenantId: tenant.id, brief, platform: 'tiktok', topic: 't', scene: 's', hook: 'h', make });
    expect(make.mock.calls.map((call) => call[1])).toEqual(['1024x1024', '1024x1536']);
  });

  it('does not keep anything if the picture could not be made', async () => {
    await expect(createPostImage({ tenantId: tenant.id, brief, platform: 'instagram', topic: 't', scene: 's', hook: 'h', make: async () => { throw new Error('nope'); } })).rejects.toThrow('nope');
  });

  it('serves a picture only to the business that owns it', async () => {
    const image = await createPostImage({ tenantId: tenant.id, brief, platform: 'instagram', topic: 't', scene: 's', hook: 'h', make: async () => png() });
    const call = async (file: string) => { const sent = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown, setHeader(k: string, v: string) { this.headers[k] = v; }, status(code: number) { this.statusCode = code; return this; }, json(v: unknown) { this.body = v; return this; }, end(v: unknown) { this.body = v; return this; } }; await imageFile({ params: { file }, query: {}, headers: {} } as unknown as Request, sent as unknown as Response); return sent; };
    const ok = await call(`${imageIdOf(image)}.jpg`);
    expect(ok.statusCode).toBe(200); expect(ok.headers['Content-Type']).toBe('image/jpeg'); expect((ok.body as Buffer).length).toBeGreaterThan(500);
    expect((await call('../../etc/passwd')).statusCode).toBe(404);
    tenant.id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect((await call(`${imageIdOf(image)}.jpg`)).statusCode).toBe(404);
    tenant.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  });
});


describe('the owner’s own photo comes first', () => {
  const jpeg = () => { const c = createCanvas(900, 600); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 900, 600); return c.toBuffer('image/jpeg'); };
  const upload = (label: string, extra: { kind?: string; description?: string; tags?: string[] } = {}, id = tenant.id) => saveBusinessImage({ tenantId: id, bytes: jpeg(), originalName: 'p.jpg', fields: { kind: extra.kind ?? 'product', label, description: extra.description, tags: extra.tags }, storage });
  const fresh = async () => { storage = new LocalVolumeStorage(await mkdtemp(path.join(os.tmpdir(), 'photo-test-')), false); setMediaStorage(storage); };
  const want = (topic: string, hook = '') => ({ tenantId: tenant.id, brief, topic, hook, cta: 'Book your pool closing today.', storage, motion: false });
  const fetchSpy = () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'));

  it('uses a suitable uploaded photo and does not make a picture', async () => {
    await fresh(); const photo = await upload('Pool closing cover going on');
    const image = await choosePostImage(want('Book your pool closing', 'Time to close your pool for the season'));
    expect(image).toEqual({ url: `/api/marketing/assets/${photo.id}`, prompt: 'Pool closing cover going on', source: 'photo' }); // the real photo, as uploaded
    expect(imageIdOf(image)).toBeNull(); // an uploaded photo belongs to the owner and is never treated as a made picture
  });

  it('draws a branded graphic, never an AI picture, when no photo suits', async () => {
    await fresh(); await upload('Pool closing cover going on');
    const spy = fetchSpy();
    const image = await choosePostImage(want('Spring pool opening special', 'Open your pool early'));
    expect(image.source).toBe('graphic'); expect(spy).not.toHaveBeenCalled(); // nothing was sent to any image service
    const file = await storage.openImage(tenant.id, imageIdOf(image)!);
    const bytes = await file!.read(); expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]); // a real JPEG
    const loaded = await (await import('@napi-rs/canvas')).loadImage(bytes); expect([loaded.width, loaded.height]).toEqual([1080, 1080]);
    spy.mockRestore();
  });

  it('gives a different layout each time a new graphic is asked for, and keeps the post’s words in it', async () => {
    await fresh();
    const a = await choosePostImage({ ...want('Pool closing', 'Close early'), variant: 0 }); const b = await choosePostImage({ ...want('Pool closing', 'Close early'), variant: 1 });
    expect(a.prompt).not.toBe(b.prompt);
    expect((await (await storage.openImage(tenant.id, imageIdOf(a)!))!.read()).equals(await (await storage.openImage(tenant.id, imageIdOf(b)!))!.read())).toBe(false);
    expect(cleanImage({ url: a.url, prompt: a.prompt, source: 'graphic' })).toMatchObject({ source: 'graphic' });
  });

  it('can pick another photo for a new look, and falls back to a graphic when there is only the one', async () => {
    await fresh(); const first = await upload('Pool closing cover going on'); const second = await upload('Pool closing cover photo');
    expect((await choosePostImage({ ...want('Pool closing cover', 'Closing'), exclude: first.id })).url).toBe(`/api/marketing/assets/${second.id}`);
    expect((await choosePostImage({ ...want('Pool closing cover', 'Closing'), exclude: second.id })).url).toBe(`/api/marketing/assets/${first.id}`);
    await fresh(); const only = await upload('Pool closing cover going on');
    expect((await choosePostImage({ ...want('Pool closing cover', 'Closing'), exclude: only.id })).source).toBe('graphic');
  });

  it('ignores words every photo of the business would share, such as "pool" for a pool company', async () => {
    await fresh(); await upload('Our pool');
    expect(await findSuitablePhoto({ tenantId: tenant.id, brief, topic: 'Pool opening', hook: 'Pool season', storage })).toBeNull();
  });

  it('ignores the plural of a word every photo shares, such as "pools" for a pool company', async () => {
    await fresh(); await upload('Our pool');
    expect(await findSuitablePhoto({ tenantId: tenant.id, brief, topic: 'Closing pools this weekend', hook: 'Closing your pools', storage })).toBeNull();
  });

  it('also matches on a photo’s description and tags, and picks the best match', async () => {
    await fresh(); await upload('Crew photo', { description: 'Technician testing water chemistry', tags: ['water', 'testing'] }); const best = await upload('Water testing kit', { tags: ['chemistry'] });
    const found = await findSuitablePhoto({ tenantId: tenant.id, brief, topic: 'Water testing and chemistry', hook: '', storage });
    expect(found?.url).toBe(`/api/marketing/assets/${best.id}`);
  });

  it('never uses a logo, and never another business’s photo', async () => {
    await fresh(); await upload('Somerset closing logo', { kind: 'logo' }); await upload('Pool closing cover', {}, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(await findSuitablePhoto({ tenantId: tenant.id, brief, topic: 'Pool closing', hook: 'Closing', storage })).toBeNull();
    expect((await choosePostImage(want('Pool closing'))).source).toBe('graphic');
  });

  it('draws a graphic when the business has no photos at all', async () => {
    await fresh();
    expect((await choosePostImage(want('Pool closing'))).source).toBe('graphic');
  });

  it('is kept on the post only as the business’s own photo link', () => {
    expect(cleanImage({ url: '/api/marketing/assets/abcdef12-3456', prompt: 'x' })).toEqual({ url: '/api/marketing/assets/abcdef12-3456', prompt: 'x', source: 'photo' });
    expect(cleanImage({ url: 'https://evil.example.com/a', prompt: 'x' })).toBeNull(); expect(cleanImage({ url: '/api/marketing/assets/../x', prompt: 'x' })).toBeNull();
  });

  it('removes the picture from a post when its photo is deleted, instead of leaving a broken one', async () => {
    await fresh(); const photo = await upload('Pool closing cover');
    store.items = [{ id: 'p1', image: { url: `/api/marketing/assets/${photo.id}`, source: 'photo', prompt: '' } }, { id: 'p2', image: { url: '/api/marketing/media/images/zzzzzz-1234.jpg', source: 'generated', prompt: '' } }]; store.saved = [];
    const sent = { statusCode: 200, body: undefined as any, status(c: number) { this.statusCode = c; return this; }, json(v: unknown) { this.body = v; return this; } };
    await deletePhoto({ params: { assetId: photo.id }, body: {}, query: {}, headers: {} } as unknown as Request, sent as unknown as Response);
    expect(sent.body).toEqual({ ok: true });
    expect(store.saved.map((item) => [item.id, item.image])).toEqual([['p1', null]]);
  });
});

describe('the branded graphic’s text', () => {
  const kit = { name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null };
  const texts = (spec: ReturnType<typeof visualSpec>) => spec.scenes[0].elements.flatMap((el: any) => (el.type === 'text' ? [el.text] : []));
  it('swaps punctuation the font cannot draw, so no missing-glyph boxes appear', () => {
    expect(texts(visualSpec({ kit, hook: 'Windsor\u2011Essex \u2013 this weekend', cta: 'Call us.', hasLogo: false })).join(' ')).not.toMatch(/[\u2010-\u2015]/);
  });
  it('keeps the whole first sentence of the call to action instead of cutting it off', () => {
    const cta = 'Book a Service on our website or call (519) 982-4901 to schedule your pool closing. We handle pool closings, winter prep and regular maintenance across the area.';
    expect(texts(visualSpec({ kit, hook: 'Close early', cta, hasLogo: false }))).toContain('Book a Service on our website or call (519) 982-4901 to schedule your pool closing.');
  });
  it('contains only text, shapes and the logo: nothing that could pass for a real place, vehicle or crew', () => {
    expect(new Set(visualSpec({ kit, hook: 'x', cta: 'y', hasLogo: false }).scenes.flatMap((scene: any) => scene.elements.map((el: any) => el.type)))).toEqual(new Set(['brand', 'shape', 'text']));
  });
});

describe('the animated visual is made for real, with no image service', () => {
  const fresh = async () => { storage = new LocalVolumeStorage(await mkdtemp(path.join(os.tmpdir(), 'motion-test-')), false); setMediaStorage(storage); };
  const jpeg = () => { const c = createCanvas(900, 600); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 900, 600); return c.toBuffer('image/jpeg'); };
  const isMp4 = (bytes: Buffer) => bytes.subarray(4, 8).toString() === 'ftyp';
  const wantMotion = { tenantId: tenant.id, brief, topic: 'Pool closing', hook: 'Close your pool early', cta: 'Book today.' };

  it('a branded graphic comes with a finished MP4 beside its still', async () => {
    await fresh(); const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const image = await choosePostImage({ ...wantMotion, storage });
    expect(image.source).toBe('graphic'); expect(image.motion).toMatch(/^\/api\/marketing\/media\/videos\/[\w-]+\.mp4$/); expect(spy).not.toHaveBeenCalled();
    const file = await storage.openVideo(tenant.id, motionIdOf(image)!); const parts: Buffer[] = []; for await (const part of file!.stream()) parts.push(Buffer.from(part)); const bytes = Buffer.concat(parts);
    expect(isMp4(bytes)).toBe(true); expect(cleanImage(image)?.motion).toBe(image.motion);
    spy.mockRestore();
  }, 60_000);

  it('a real photo is presented with motion but is never altered or replaced', async () => {
    await fresh();
    const photo = await saveBusinessImage({ tenantId: tenant.id, bytes: jpeg(), originalName: 'p.jpg', fields: { kind: 'product', label: 'Pool closing cover going on', description: '', tags: [] } });
    const before = await (await storage.openAsset(tenant.id, photo.id))!.read();
    const image = await choosePostImage({ ...wantMotion, storage });
    expect(image).toMatchObject({ url: `/api/marketing/assets/${photo.id}`, source: 'photo' }); expect(image.motion).toBeTruthy();
    expect((await (await storage.openAsset(tenant.id, photo.id))!.read()).equals(before)).toBe(true);
    await removePostMedia(tenant.id, image, storage); // removes the animation only
    expect(await storage.openAsset(tenant.id, photo.id)).not.toBeNull(); expect(await storage.openVideo(tenant.id, motionIdOf(image)!)).toBeNull();
  }, 60_000);

  it('removing a post’s media removes its still and its animation', async () => {
    await fresh(); const image = await choosePostImage({ ...wantMotion, storage });
    await removePostMedia(tenant.id, image, storage);
    expect(await storage.openImage(tenant.id, imageIdOf(image)!)).toBeNull(); expect(await storage.openVideo(tenant.id, motionIdOf(image)!)).toBeNull();
  }, 60_000);
});

describe('an explicit AI picture request', () => {
  it('lets people appear only when the owner asked for them, and still forbids text and misleading claims', () => {
    const asked = pictureDescription({ brief, platform: 'instagram', topic: 't', scene: 'A pool technician closing a pool', hook: 'h', explicit: true });
    expect(asked).not.toMatch(/Do not show any people/); expect(asked).toMatch(/NO text/); expect(asked).toMatch(/before-and-after/);
    expect(pictureDescription({ brief, platform: 'instagram', topic: 't', scene: 's', hook: 'h' })).toMatch(/Do not show any people/); // the default rules are unchanged
  });
});
