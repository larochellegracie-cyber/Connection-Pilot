import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const loaded = vi.hoisted(() => ({ brief: [] as string[], kit: [] as string[] }));
const brief = (name: string) => ({ businessName: name, businessType: 'Pool cleaning', location: 'Windsor-Essex', website: '', description: 'Pool openings and closings.', services: ['Pool opening', 'Pool closing'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: 'Friendly', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true });
vi.mock('./store.js', () => ({
  loadBusinessBrief: async (id: string) => { loaded.brief.push(id); return brief(id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' ? 'Other Business' : 'Somerset Pool Service'); },
  loadBrandKit: async (id: string) => { loaded.kit.push(id); return { name: 'Somerset Pool Service', primary: '#0B1F44', secondary: '#2454D6', accent: '#6C98FF', logoUrl: null }; },
}));

import { creativeModeReply, loadCreativeContext } from './creative-context';
import { detectCreativeRequest } from '@/lib/marketing-creative-mode';
import { saveBusinessImage } from './standard-video/business-assets';
import { LocalVolumeStorage } from './standard-video/storage';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let root: string; let storage: LocalVolumeStorage;
const jpeg = () => { const c = createCanvas(600, 400); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 600, 400); return c.toBuffer('image/jpeg'); };
const upload = (tenantId: string, label: string, kind = 'product') => saveBusinessImage({ tenantId, bytes: jpeg(), originalName: 'p.jpg', fields: { kind, label }, storage });
beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'creative-ctx-')); storage = new LocalVolumeStorage(root, false); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('loading the business and its media for Marketing Creative Mode', () => {
  it('loads the business profile and the FULL list of uploaded media, including logos, for this business only', async () => {
    await upload(A, 'Pouring salt into a pool'); await upload(A, 'Winter cover going on'); await upload(A, 'Somerset logo', 'logo'); await upload(B, 'Other business secret photo');
    const context = await loadCreativeContext(A, { storage });
    expect(context.business.businessName).toBe('Somerset Pool Service');
    expect(context.business.services).toEqual(['Pool opening', 'Pool closing']);
    expect(context.media.all.map((m) => m.label).sort()).toEqual(['Pouring salt into a pool', 'Somerset logo', 'Winter cover going on']);
    expect(context.media.photos).toHaveLength(2); expect(context.media.logos).toHaveLength(1);
    expect(JSON.stringify(context)).not.toMatch(/Other business secret photo/); // another business's media is never visible
    expect(loaded.brief).toContain(A); expect(loaded.kit).toContain(A); expect(loaded.brief).not.toContain(B);
    expect(context.media.all[0].link).toMatch(/^\/api\/marketing\/assets\/[\w-]+$/);
  });

  it('says plainly what is missing instead of pretending: no videos (upload is not available), no photos, no logo', async () => {
    const empty = await loadCreativeContext('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { storage });
    expect(empty.media.videos).toEqual([]); expect(empty.media.all).toEqual([]);
    expect(empty.gaps.join(' ')).toMatch(/No photos/); expect(empty.gaps.join(' ')).toMatch(/No logo/); expect(empty.gaps.join(' ')).toMatch(/No videos/);
  });

  it('confirms Marketing Creative Mode, the request, the business and the media, and says nothing was made', async () => {
    const context = await loadCreativeContext(A, { storage });
    const reply = creativeModeReply(detectCreativeRequest('Pilot, make me a TikTok for Somerset'), context);
    expect(reply).toMatch(/Marketing Creative Mode is on/); expect(reply).toMatch(/a TikTok/);
    expect(reply).toMatch(/Somerset Pool Service/); expect(reply).toMatch(/2 photos/); expect(reply).toMatch(/“Pouring salt into a pool”/); expect(reply).toMatch(/1 logo/); expect(reply).toMatch(/0 videos/);
    expect(reply).toMatch(/haven’t made anything yet/);
  });
});
