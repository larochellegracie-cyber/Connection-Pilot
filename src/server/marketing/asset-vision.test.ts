import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { metadataReview, provenanceOf, reviewAssets, sanitizeReview, shortlist } from './asset-vision.js';
import { repairScript, type CodeBrief } from './code-video/generate.js';
import { cinematicProblems } from './code-video/index.js';
import type { AssetMeta } from './standard-video/storage.js';

const asset = (id: string, label: string, over: Partial<AssetMeta> = {}): AssetMeta => ({ id, kind: 'photo', label, description: '', tags: [], originalName: `${id}.jpg`, mime: 'image/jpeg', width: 1024, height: 1536, bytes: 1000, createdAt: '2026-10-01T00:00:00Z', ...over } as AssetMeta);
const art = asset('art00001', 'Made by Pilot – somerset pool closings water', { tags: ['generated', 'artwork'], createdAt: '2026-10-20T00:00:00Z' });
const ai = asset('aiimg001', 'AI image – pool closing', { tags: ['generated', 'ai-image'] });
const web = asset('web00001', 'From website – photo 4', { tags: ['website'] });
const own = asset('own00001', 'Covered pool with leaves');
const logo = asset('logo0001', 'Somerset logo', { kind: 'logo' });
const all = [art, ai, web, own, logo];

describe('what each picture is, from where it came from', () => {
  it('tells an own upload, a website photo, a product photo, an AI image, Pilot artwork and a logo apart', () => {
    expect(provenanceOf(own)).toBe('own_upload'); expect(provenanceOf(web)).toBe('website'); expect(provenanceOf(ai)).toBe('ai_image'); expect(provenanceOf(art)).toBe('pilot_artwork'); expect(provenanceOf(logo)).toBe('logo');
    expect(provenanceOf(asset('prod0001', 'Salt', { kind: 'product' }))).toBe('product_photo');
  });
});

describe('which pictures are looked at', () => {
  it('puts word matches first, keeps pictures whose label says nothing, never includes a logo, and stops at the limit', () => {
    const list = shortlist(all, 'pool closing');
    expect(list.map((a) => a.id)).not.toContain('logo0001'); expect(list[0].id).not.toBe('web00001'); // a picture whose words match comes before one whose label says nothing
    expect(list.map((a) => a.id)).toContain('web00001'); // "photo 4" matches nothing, and is still looked at
    expect(shortlist(Array.from({ length: 20 }, (_, i) => asset(`bulk000${i}`, `x ${i}`)), 'pool', 8).length).toBe(8);
  });
  it('prefers the business’s own pictures over generated ones when nothing matches by words', () => {
    const order = shortlist([art, ai, web], 'completely unrelated words').map((a) => a.id);
    expect(order.indexOf('web00001')).toBeLessThan(order.indexOf('aiimg001')); expect(order.indexOf('aiimg001')).toBeLessThan(order.indexOf('art00001'));
  });
});

describe('the model’s reading of the sheet, with the rules enforced in code', () => {
  const lettered = [art, ai, web, own];
  const reply = (over: Record<string, unknown> = {}) => ({ assets: [{ id: 'A', kind: 'real_photo', shows: 'blue light swirls', relevance: 9, quality: 9, best_use: 'hero' }, { id: 'B', kind: 'ai_image', shows: 'a pool under a cover', relevance: 8, quality: 7, best_use: 'hero' }, { id: 'C', kind: 'real_photo', shows: 'a man cleaning a pool', relevance: 4, quality: 6, best_use: 'support' }, { id: 'D', kind: 'real_photo', shows: 'a covered pool with leaves', relevance: 10, quality: 8, best_use: 'hero' }], hero: 'A', reason: 'x', ...over });
  it('never lets Pilot’s abstract artwork be a photograph or the hero, whatever the model says', () => {
    const review = sanitizeReview(reply(), lettered, all, 4);
    const a = review.assets.find((f) => f.id === 'art00001')!;
    expect(a.kind).toBe('abstract'); expect(a.best_use).not.toBe('hero'); expect(review.hero?.id).not.toBe('art00001');
    expect(review.hero?.id).toBe('own00001'); // the best allowed picture is used instead: real, relevant and good
    expect(review.source).toBe('vision'); expect(review.logo?.id).toBe('logo0001');
  });
  it('accepts the model’s own choice when it is allowed, and says what each picture shows', () => {
    const review = sanitizeReview(reply({ hero: 'D', reason: 'It shows the cover and the leaves.' }), lettered, all, 4);
    expect(review.hero).toMatchObject({ id: 'own00001', reason: 'It shows the cover and the leaves.' }); expect(review.assets.find((f) => f.id === 'web00001')?.shows).toBe('a man cleaning a pool');
  });
  it('has no hero when nothing is both relevant and good enough, and says so', () => {
    const weak = reply({ assets: [{ id: 'B', kind: 'ai_image', relevance: 3, quality: 9, best_use: 'support' }, { id: 'D', kind: 'real_photo', relevance: 9, quality: 2, best_use: 'hero' }], hero: 'D' });
    const review = sanitizeReview(weak, lettered, all, 4); expect(review.hero).toBeNull(); expect(review.note).toMatch(/None of the/);
  });
  it('ignores letters that do not exist, and marks pictures the model did not mention as skip', () => {
    const review = sanitizeReview({ assets: [{ id: 'Z', kind: 'real_photo', relevance: 10, quality: 10, best_use: 'hero' }], hero: 'Z' }, lettered, all, 4);
    expect(review.hero).toBeNull(); expect(review.assets.every((f) => f.best_use === 'skip')).toBe(true);
  });
  it('treats a logo as branding, never the main visual', () => {
    const review = sanitizeReview({ assets: [{ id: 'A', kind: 'real_photo', relevance: 10, quality: 10, best_use: 'hero' }], hero: 'A' }, [logo], all, 1);
    expect(review.assets[0]).toMatchObject({ kind: 'logo', best_use: 'branding' }); expect(review.hero).toBeNull();
  });
});

describe('without a model, the pictures are judged by their metadata under the same rules', () => {
  it('never picks Pilot artwork or a logo as the main visual, and says the pictures were not looked at', () => {
    const review = metadataReview([art, logo], 'pool closing water', 'No model.'); expect(review.hero).toBeNull(); expect(review.source).toBe('metadata'); expect(review.reviewed).toBe(0);
    const better = metadataReview(all, 'pool closing', 'No model.'); expect(better.hero?.id).not.toBe('art00001'); expect(better.hero?.id).not.toBe('logo0001');
  });
});

describe('looking at the pictures, for real', () => {
  it('sends ONE small contact sheet (not every picture), tells the model where each came from, and maps its letters back to the pictures', async () => {
    const python = path.join(process.cwd(), '.venv-codevideo/bin/python'); if (!existsSync(python)) return;
    const png = (colour: string) => { const c = createCanvas(240, 360); const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 240, 360); return c.toBuffer('image/png'); };
    const bytes = new Map(all.map((a, i) => [a.id, png(['#335', '#463', '#a52', '#245', '#fff'][i])]));
    const storage = { openAsset: async (_t: string, id: string) => (bytes.has(id) ? { size: 1, read: async () => bytes.get(id)! } : null) } as never;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'review-'));
    const seen: { images: number; prompt: string; jpeg: boolean } = { images: 0, prompt: '', jpeg: false };
    try {
      const review = await reviewAssets({ tenantId: 't', request: 'Make a 15 second TikTok about pool closing', subject: 'pool closing', assets: all, storage, workDir: dir, completeWithImages: async (_s, prompt, images) => { seen.images = images.length; seen.prompt = prompt; seen.jpeg = images[0][0] === 0xff && images[0][1] === 0xd8; return { text: JSON.stringify({ assets: shortlist(all, 'pool closing pool closing').map((_a, i) => ({ id: String.fromCharCode(65 + i), kind: 'real_photo', shows: `picture ${i}`, relevance: 8, quality: 8, best_use: 'support' })), hero: 'A', reason: 'ok' }) }; } });
      expect(seen.images).toBe(1); expect(seen.jpeg).toBe(true); expect(seen.prompt).toMatch(/provenance pilot_artwork/); expect(seen.prompt).toMatch(/provenance website/); expect(seen.prompt).not.toMatch(/logo0001|Somerset logo/);
      expect(review.source).toBe('vision'); expect(review.reviewed).toBe(4); expect(review.considered).toBe(5);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('falls back to the metadata review, instead of failing, when the model cannot answer', async () => {
    const review = await reviewAssets({ tenantId: 't', request: 'pool closing', subject: 'pool closing', assets: all, storage: {} as never, workDir: os.tmpdir(), completeWithImages: async () => { throw new Error('offline'); } });
    expect(review.source).toBe('metadata'); expect(review.note).toMatch(/failed|could not/);
  });
});

describe('the repair loop', () => {
  const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'S' }, palette: {}, assets: {}, scenes: [], total_seconds: 10 } as CodeBrief;
  it('reminds the writer of what it was already told, so a fix does not repeat an old mistake', async () => {
    let prompt = '';
    await repairScript({ brief, style: 'custom', script: 'def build(video):\n    pass', errors: ['Design review: water prop over the photo'], history: ['Scene 2 is almost a still', 'Design review: water prop over the photo'], usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, check: async () => [], complete: async (_s, p) => { prompt = p; return { text: 'def build(video):\n    pass' }; } });
    expect(prompt).toMatch(/ALREADY told/); expect(prompt).toMatch(/Scene 2 is almost a still/);
  });
  it('catches the mistakes seen in a live run: a drawn prop over the photograph, and a studio covered by the camera', () => {
    const script = `def build(video):
    def one(c, t, u):
        c.studio(t)
        c.camera("p1", u, "push", 1.0, t)
        c.prop("water", 540, 1300, 900, 1.0, t)
    video.add_scene(3, one, "whip")`;
    const found = cinematicProblems(script).join(' '); expect(found).toMatch(/c\.prop/); expect(found).toMatch(/c\.studio/);
  });
});

describe('a correction that is refused', () => {
  const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'S' }, palette: {}, assets: {}, scenes: [], total_seconds: 10 } as CodeBrief;
  it('gets one more try, told why, and is then used when that one passes', async () => {
    const prompts: string[] = []; const notes: string[] = [];
    const fixed = await repairScript({ brief, style: 'custom', script: 'old', errors: ['text runs off the side'], usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, notes, check: async (script) => (script.includes('bad') ? ['Do not draw illustrations (c.prop)'] : []), complete: async (_s, p) => { prompts.push(p); return { text: prompts.length === 1 ? 'def build(video):\n    bad' : 'def build(video):\n    good' }; } });
    expect(fixed).toContain('good'); expect(prompts.length).toBe(2); expect(prompts[1]).toMatch(/refused by the checker/); expect(prompts[1]).toMatch(/c\.prop/); expect(notes[0]).toMatch(/was refused/);
  });
  it('is bounded: two refusals end the repair (never a third call), and say why', async () => {
    let calls = 0; const notes: string[] = [];
    const fixed = await repairScript({ brief, style: 'custom', script: 'old', errors: ['x'], usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, notes, check: async () => ['still wrong'], complete: async () => { calls += 1; return { text: 'def build(video):\n    pass' }; } });
    expect(fixed).toBeNull(); expect(calls).toBe(2); expect(notes.join(' ')).toMatch(/second correction was refused too/);
  });
});
