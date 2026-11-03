import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const kit = { name: 'Somerset Pool Service', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null };
vi.mock('./store.js', () => ({ loadBrandKit: async () => kit, createContent: vi.fn(), getContent: vi.fn(), saveContent: vi.fn(), listContent: async () => [] }));

import { artColours, ensureGeneratedArt, generatedArtEnabled, renderArt, themeFor } from './generated-art';
import { choosePostImage } from './image';
import { rankAssets, saveBusinessImage } from './standard-video/business-assets';
import { LocalVolumeStorage, type MediaStorage } from './standard-video/storage';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let dir = ''; let storage: MediaStorage;
beforeEach(async () => { process.env.PILOT_GENERATED_ART = 'on'; dir = await mkdtemp(path.join(os.tmpdir(), 'art-test-')); storage = new LocalVolumeStorage(dir, false); });
afterEach(async () => { delete process.env.PILOT_GENERATED_ART; await rm(dir, { recursive: true, force: true }); });

const photo = (colour = '#2E75B6') => { const c = createCanvas(900, 600); const x = c.getContext('2d'); x.fillStyle = colour; x.fillRect(0, 0, 900, 600); return c.toBuffer('image/jpeg'); };

describe('what the artwork looks like', () => {
  it('follows the subject: water for pools, snow for closing, sun for opening, sparkle for cleaning, flowing colour for anything else', () => {
    expect(themeFor('pool closing')).toMatchObject({ base: 'water', snow: true, sun: false });
    expect(themeFor('pool opening for summer')).toMatchObject({ base: 'water', sun: true, snow: false });
    expect(themeFor('pool cleaning')).toMatchObject({ base: 'water', sparkle: true });
    expect(themeFor('fresh chocolate cupcakes')).toMatchObject({ base: 'flow' });
    expect(themeFor('closing the season')).toMatchObject({ snow: true });
  });

  it('draws a real, repeatable JPEG at the size asked, in the brand’s colours', async () => {
    const colours = artColours(kit); const theme = themeFor('pool closing');
    const a = await renderArt({ theme, colours, width: 270, height: 480, seed: 3 }); const b = await renderArt({ theme, colours, width: 270, height: 480, seed: 3 }); const c = await renderArt({ theme, colours, width: 270, height: 480, seed: 4 });
    const image = await loadImage(a); expect([image.width, image.height]).toEqual([270, 480]); expect(a[0]).toBe(0xff); expect(a[1]).toBe(0xd8); // a JPEG
    expect(Buffer.compare(a, b)).toBe(0); expect(Buffer.compare(a, c)).not.toBe(0); // the same seed draws the same art; another seed another
    expect(colours.mid).toBe('#233D48'); expect(colours.accent).toBe('#E1611A'); // Somerset's deep slate is the base and its orange the accent: no blend of the bright colours
  });
});

describe('saving it to Photos', () => {
  it('saves one labelled “Made by Pilot”, tagged, with the subject’s own words so the usual photo matching finds it', async () => {
    const made = await ensureGeneratedArt({ tenantId: TENANT, subject: 'pool closing', kit, storage });
    expect(made).toMatchObject({ reused: false }); expect(made!.asset.label).toMatch(/^Made by Pilot – pool closing/); expect(made!.asset.tags).toEqual(expect.arrayContaining(['generated', 'artwork'])); expect(made!.asset.kind).toBe('photo');
    const ranked = rankAssets(await storage.listAssets(TENANT), 'Make me a video about pool closing');
    expect(ranked[0].id).toBe(made!.asset.id); expect(ranked[0].score).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('reuses the same artwork for the same subject, and makes another for a different look', async () => {
    const first = await ensureGeneratedArt({ tenantId: TENANT, subject: 'pool closing', kit, storage });
    const again = await ensureGeneratedArt({ tenantId: TENANT, subject: 'closing my pool for the winter', kit, storage });
    expect(again).toMatchObject({ reused: true }); expect(again!.asset.id).toBe(first!.asset.id);
    const other = await ensureGeneratedArt({ tenantId: TENANT, subject: 'pool opening for summer', kit, storage }); expect(other!.reused).toBe(false); expect((await storage.listAssets(TENANT)).length).toBe(2);
  }, 30_000);

  it('does nothing when it is switched off or there is no subject, and never touches the owner’s own photos', async () => {
    await saveBusinessImage({ tenantId: TENANT, bytes: photo(), originalName: 'cover.jpg', storage, fields: { kind: 'product', label: 'Winter cover going on' } });
    process.env.PILOT_GENERATED_ART = 'off'; expect(generatedArtEnabled()).toBe(false); expect(await ensureGeneratedArt({ tenantId: TENANT, subject: 'pool closing', kit, storage })).toBeNull();
    process.env.PILOT_GENERATED_ART = 'on'; expect(await ensureGeneratedArt({ tenantId: TENANT, subject: '  ', kit, storage })).toBeNull();
    expect((await storage.listAssets(TENANT)).map((asset) => asset.label)).toEqual(['Winter cover going on']);
  });
});

describe('posts', () => {
  const brief = { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning' };
  it('use the owner’s own photo when one fits, and generate nothing', async () => {
    await saveBusinessImage({ tenantId: TENANT, bytes: photo(), originalName: 'cover.jpg', storage, fields: { kind: 'product', label: 'Winter cover going on' } });
    const image = await choosePostImage({ tenantId: TENANT, brief, topic: 'winter cover', hook: 'Is your pool ready for winter?', cta: 'Book today', motion: false, storage });
    expect(image.source).toBe('photo'); expect((await storage.listAssets(TENANT)).filter((asset) => asset.tags.includes('generated'))).toHaveLength(0);
  }, 30_000);

  it('use generated artwork when no photo fits, saved in Photos, with the post’s words over it', async () => {
    await saveBusinessImage({ tenantId: TENANT, bytes: photo(), originalName: 'salt.jpg', storage, fields: { kind: 'product', label: 'Pouring salt into a pool' } });
    const image = await choosePostImage({ tenantId: TENANT, brief, topic: 'pool closing', hook: 'Is your pool ready for winter?', cta: 'Book your closing today', motion: false, storage });
    const art = (await storage.listAssets(TENANT)).find((asset) => asset.tags.includes('generated'));
    expect(art).toBeTruthy(); expect(image.url).toBe(`/api/marketing/assets/${art!.id}`); expect(image.prompt).toMatch(/Made by Pilot/);
  }, 30_000);

  it('reuse that artwork for the next post on the same subject, still shown as artwork (not as the owner’s photo) and without making another', async () => {
    const first = await choosePostImage({ tenantId: TENANT, brief, topic: 'pool closing', hook: 'Is your pool ready for winter?', cta: 'Book today', motion: false, storage });
    const second = await choosePostImage({ tenantId: TENANT, brief, topic: 'closing your pool', hook: 'Pool closing season is here', cta: 'Book today', motion: false, storage });
    expect(second.url).toBe(first.url); expect(second.source).toBe('generated'); expect((await storage.listAssets(TENANT)).filter((asset) => asset.tags.includes('generated'))).toHaveLength(1);
  }, 30_000);

  it('fall back to the plain branded graphic when generation is off', async () => {
    process.env.PILOT_GENERATED_ART = 'off';
    const image = await choosePostImage({ tenantId: TENANT, brief, topic: 'pool closing', hook: 'Is your pool ready for winter?', cta: 'Book today', motion: false, storage });
    expect(image.source).toBe('graphic'); expect(await storage.listAssets(TENANT)).toHaveLength(0);
  }, 30_000);
});
