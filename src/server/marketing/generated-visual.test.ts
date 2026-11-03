import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';

vi.mock('#airo/secrets', () => ({ getSecret: () => 'sk-test' }));
const kit = { name: 'Somerset Pool Service', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null };
vi.mock('./store.js', () => ({ loadBrandKit: async () => kit, createContent: vi.fn(), getContent: vi.fn(), saveContent: vi.fn(), listContent: async () => [] }));

import { choosePostImage } from './image';
import { isPhotographic, colourName, describeScene, placeOf, ensureGeneratedVisual, realisticImagesEnabled, realisticPrompt } from './generated-visual';
import { saveBusinessImage } from './standard-video/business-assets';
import { LocalVolumeStorage, type MediaStorage } from './standard-video/storage';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const business = { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', services: ['Pool closing', 'Pool opening'] };
let dir = ''; let storage: MediaStorage; let prompts: Array<{ prompt: string; size: string }>;
const maker = async (prompt: string, size: string) => { prompts.push({ prompt, size }); const c = createCanvas(512, 768); const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 768); g.addColorStop(0, '#9ad1f2'); g.addColorStop(1, '#1d5f8a'); x.fillStyle = g; x.fillRect(0, 0, 512, 768); return { bytes: new Uint8Array(c.toBuffer('image/jpeg')) }; };
beforeEach(async () => { prompts = []; delete process.env.PILOT_REALISTIC_IMAGES; delete process.env.PILOT_REALISTIC_IMAGES_PER_DAY; process.env.PILOT_GENERATED_ART = 'on'; dir = await mkdtemp(path.join(os.tmpdir(), 'vis-test-')); storage = new LocalVolumeStorage(dir, false); });
afterEach(async () => { delete process.env.PILOT_GENERATED_ART; delete process.env.PILOT_REALISTIC_IMAGES; delete process.env.PILOT_REALISTIC_IMAGES_PER_DAY; await rm(dir, { recursive: true, force: true }); });

describe('the instructions to the image model', () => {
  it('names the brand colours in plain words, asks for real photography, and forbids text, people, claims and CGI', () => {
    expect([colourName('#E1611A'), colourName('#233D48'), colourName('#188BF6'), colourName('#FFFFFF')]).toEqual(['orange', 'deep teal', 'blue', 'white']);
    const prompt = realisticPrompt({ scene: 'A backyard pool under a taut winter cover.', business, kit });
    expect(prompt).toContain('professional commercial photograph'); expect(prompt).not.toContain('Somerset Pool Service'); expect(prompt).toMatch(/no lettering, names or branding on vehicles/); expect(prompt).toContain('A backyard pool under a taut winter cover.');
    expect(prompt).toMatch(/orange.*teal.*blue|orange, deep teal, blue/); expect(prompt).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(prompt).toMatch(/NO text, letters, numbers, logos, signs or watermarks/); expect(prompt).toMatch(/NO people, faces, hands or workers/); expect(prompt).toMatch(/real photograph/); expect(prompt).toMatch(/lower third calm/);
  });

  it('lets the strategy choose a non-photographic style, and keeps the safety rules either way', () => {
    const render = realisticPrompt({ scene: 'A tiered cupcake glowing under floating pumpkins.', business, kit, style: 'glossy 3D render, dramatic Halloween lighting' });
    expect(render).toContain('glossy 3D render'); expect(render).not.toMatch(/real photograph/); expect(render).not.toMatch(/professional commercial photograph/);
    expect(render).toMatch(/NO text, letters/); expect(render).toMatch(/NO people/);
    expect(isPhotographic(undefined)).toBe(true); expect(isPhotographic('cinematic photograph')).toBe(true); expect(isPhotographic('flat illustration')).toBe(false); expect(isPhotographic('cinematic 3D render')).toBe(false);
    expect(realisticPrompt({ scene: 'x', business, kit, style: 'cinematic photograph' })).toMatch(/real photograph/);
  });

  it('uses only the town or region, never a street address, in the instructions or the saved description', async () => {
    expect(placeOf('10605 Halstead Crescent, Windsor, Ontario, N8R 2C3')).toBe('Windsor, Ontario'); expect(placeOf('Windsor-Essex')).toBe('Windsor-Essex'); expect(placeOf(undefined)).toBe('');
    await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business: { ...business, location: '10605 Halstead Crescent, Windsor, Ontario' }, storage, make: maker });
    expect(prompts[0].prompt).toContain('Windsor, Ontario'); expect(prompts[0].prompt).not.toMatch(/10605|Halstead/);
  }, 30_000);

  it('gets a concrete scene from the art-direction step, and falls back to a plain one if that fails or is nonsense', async () => {
    expect(await describeScene({ subject: 'pool closing', business, complete: async () => 'A backyard pool at dusk in early autumn, a taut dark winter cover over the water, fallen leaves on the coping.' })).toMatch(/taut dark winter cover/);
    expect(await describeScene({ subject: 'pool closing', business, complete: async () => { throw new Error('down'); } })).toMatch(/pool closing.*pool cleaning business in Windsor-Essex/);
    expect(await describeScene({ subject: 'pool closing', business, complete: async () => 'ok' })).toMatch(/pool closing/);
  });
});

describe('making and keeping the image', () => {
  it('is off unless the owner switches it on', () => { expect(realisticImagesEnabled()).toBe(false); process.env.PILOT_REALISTIC_IMAGES = 'on'; expect(realisticImagesEnabled()).toBe(true); });

  it('generates a realistic image for a subject, saved in Photos as “AI image – …”, tagged and described honestly', async () => {
    const made = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business, storage, make: maker, complete: async () => 'A backyard pool under a taut winter cover.' });
    expect(made).toMatchObject({ kind: 'ai-image', reused: false }); expect(made!.asset.label).toBe('AI image – pool closing'); expect(made!.asset.tags).toEqual(expect.arrayContaining(['generated', 'ai-image']));
    expect(made!.asset.description).toMatch(/AI-generated/); expect(made!.asset.description).toMatch(/not a photo of your business/);
    expect(prompts).toHaveLength(1); expect(prompts[0].size).toBe('1024x1536'); expect(prompts[0].prompt).toContain('taut winter cover');
  }, 30_000);

  it('pays for the same subject once: the second request reuses the saved image', async () => {
    const first = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business, storage, make: maker });
    const again = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'Pool Closing', kit, business, storage, make: maker });
    expect(again).toMatchObject({ reused: true, kind: 'ai-image' }); expect(again!.asset.id).toBe(first!.asset.id); expect(prompts).toHaveLength(1);
  }, 30_000);

  it('does not reuse a closing image for an opening subject, even though both are about pools', async () => {
    await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business, storage, make: maker });
    const other = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool opening', kit, business, storage, make: maker });
    expect(other!.reused).toBe(false); expect(prompts).toHaveLength(2);
  }, 30_000);

  it('falls back to the free artwork when the image cannot be made, and says why', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const made = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business, storage, make: async () => { throw new Error('rate limited sk-abc123'); } });
    expect(made).toMatchObject({ kind: 'artwork', fallbackReason: 'The image could not be generated just now.' }); expect(made!.asset.label).toMatch(/^Made by Pilot/);
  }, 30_000);

  it('stops at the daily limit and uses the free artwork instead', async () => {
    process.env.PILOT_REALISTIC_IMAGES_PER_DAY = '1';
    await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business, storage, make: maker });
    const second = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'hot tub cleaning', kit, business, storage, make: maker });
    expect(second).toMatchObject({ kind: 'artwork', fallbackReason: 'The daily limit for generated images has been reached.' }); expect(prompts).toHaveLength(1);
  }, 30_000);

  it('uses the free artwork, and calls nothing, when realistic images are not enabled', async () => {
    const made = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'pool closing', kit, business, storage });
    expect(made).toMatchObject({ kind: 'artwork' }); expect(prompts).toHaveLength(0);
  }, 30_000);
});

describe('posts', () => {
  const brief = { ...business };
  it('prefer the owner’s own photo, and generate nothing when one fits', async () => {
    const c = createCanvas(900, 600); c.getContext('2d').fillRect(0, 0, 900, 600);
    await saveBusinessImage({ tenantId: TENANT, bytes: c.toBuffer('image/jpeg'), originalName: 'cover.jpg', storage, fields: { kind: 'product', label: 'Winter cover going on' } });
    const image = await choosePostImage({ tenantId: TENANT, brief, topic: 'winter cover', hook: 'Cover on, worries off', cta: 'Book today', motion: false, storage, make: maker });
    expect(image.source).toBe('photo'); expect(prompts).toHaveLength(0);
  }, 30_000);

  it('use a generated realistic image when no photo fits, with the post’s words over it', async () => {
    const image = await choosePostImage({ tenantId: TENANT, brief, topic: 'pool closing', hook: 'Is your pool ready for winter?', cta: 'Book your closing', motion: false, storage, make: maker, complete: async () => 'A backyard pool under a taut winter cover.' });
    const asset = (await storage.listAssets(TENANT)).find((a) => a.tags.includes('ai-image'));
    expect(asset).toBeTruthy(); expect(image.url).toBe(`/api/marketing/assets/${asset!.id}`); expect(image.prompt).toBe('AI image – pool closing'); expect(prompts).toHaveLength(1);
    const next = await choosePostImage({ tenantId: TENANT, brief, topic: 'closing your pool', hook: 'Pool closing season', cta: 'Book', motion: false, storage, make: maker });
    expect(next.url).toBe(image.url); expect(prompts).toHaveLength(1); // the same image, no second charge
  }, 30_000);
});

describe('a generated picture is looked at before it is kept', () => {
  it('makes it again once when it shows lettering, and refuses it when it still does', async () => {
    let seen = 0;
    await ensureGeneratedVisual({ tenantId: TENANT, subject: 'a van at night', kit, business, make: maker, storage, inspect: async () => (seen++ === 0 ? 'readable text or a logo' : null) });
    expect(prompts.length).toBe(2); expect(prompts[1].prompt).toMatch(/absolutely no letters/);
    prompts = [];
    const result = await ensureGeneratedVisual({ tenantId: TENANT, subject: 'a boiler room', kit, business, make: maker, storage, inspect: async () => 'readable text or a logo' });
    expect(prompts.length).toBe(2); expect(result?.kind).not.toBe('ai-image');
  });
});
