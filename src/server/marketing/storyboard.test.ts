import { describe, expect, it, vi } from 'vitest';
import type { AssetSelection } from './asset-selection';
import type { CreativeBrief } from './creative-brief';
import { buildScenePrompt, buildStoryboard, planScenes, styleDirection } from './storyboard';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const brief = (extra: Partial<CreativeBrief> = {}): CreativeBrief => ({ platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'cinematic', 'fast'], length_seconds: 15, key_instructions: [], iteration_of: null, ...extra });
const input = { brief: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', website: '', description: 'Pool openings and closings.', services: ['Pool closing'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone: '', description: '' }, learned: [], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true }, signals: [], trends: [], insights: [], existing: [], now: new Date('2026-10-23T12:00:00Z'), timezone: 'America/Toronto' };
const none: AssetSelection = { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'n', selected_at: 'x' };
const photo = (id: string, label = 'Winter cover going on'): AssetSelection['selected_assets'][number] => ({ id, label, description: '', type: 'photo', reason: 'r', score: 3 });
const matched = (...ids: string[]): AssetSelection => ({ selected_assets: ids.map((id) => photo(id)), has_good_match: true, fallback_needed: false, note: 'n', selected_at: 'x' });
const scenesReply = JSON.stringify({ scenes: [{ role: 'hook', description: 'A winter cover slowly draws across calm water.' }, { role: 'main', description: 'The cover settles over the pool as leaves drift by.' }, { role: 'support', description: 'Close detail of the cover edge being secured.' }, { role: 'support', description: 'Wide view of the closed pool at dusk.' }] });
const goodCaption = 'Is your pool ready for the first freeze?\n\nSomerset Pool Service closes pools across Windsor-Essex: water balance, cover and equipment all winterised.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
const captionReply = (over: Record<string, unknown> = {}) => JSON.stringify({ caption: goodCaption, hashtags: ['PoolClosing', '#WindsorEssex', 'PoolCare', 'SomersetPoolService', 'a', 'b', 'c'], cta: 'Book at somersetpoolservice.com or call (519) 982-4901.', end_card_text: 'Book your pool closing today', ...over });
/** The storyboard and the caption are two separate AI calls; this answers each with its own reply. */
const aiReply = async (system: string) => (/storyboard for ONE/.test(system) ? scenesReply : captionReply());

describe('how long each scene is', () => {
  it.each([[null, 4, 15], [6, 3, 6], [10, 3, 10], [15, 4, 15], [20, 5, 20], [30, 5, 30], [90, 5, 30], [2, 3, 6]])('%s seconds asked: %i scenes, about %i seconds', (asked, scenes, total) => {
    const plan = planScenes(asked as number | null);
    expect(plan.roles).toHaveLength(scenes); expect(plan.seconds.reduce((a, b) => a + b, 0)).toBe(total);
    expect(plan.roles[0]).toBe('hook'); expect(plan.roles[1]).toBe('main'); expect(plan.roles.at(-1)).toBe('ending');
    expect(plan.seconds.slice(0, -1).every((s) => s >= 2 && s <= 10)).toBe(true); // every generated clip is 2 to 10 seconds
    expect(scenes).toBeGreaterThanOrEqual(3); expect(scenes).toBeLessThanOrEqual(5);
  });
});

describe('style words become camera, lighting and mood', () => {
  it('maps the brief’s style words', () => {
    expect(styleDirection(['dark', 'cinematic'])).toEqual({ camera: 'slow cinematic push-in with shallow depth of field and subtle parallax', lighting: 'low-key lighting, deep shadows and a soft rim light', mood: 'dramatic, intense and cinematic' });
    expect(styleDirection(['bright', 'fun'])).toMatchObject({ lighting: 'bright, soft natural daylight', mood: 'playful, upbeat and friendly' });
    expect(styleDirection(['luxury', 'slow'])).toMatchObject({ camera: 'slow, smooth gliding camera movement', mood: 'premium, refined and confident' });
    expect(styleDirection(["valentine's", '3d']).mood).toMatch(/romantic and warm, with a layered sense of depth and dimension and romantic red and pink accents/);
  });
  it('has sensible defaults when no style was given', () => {
    expect(styleDirection([])).toEqual({ camera: 'smooth, steady camera movement', lighting: 'natural, soft lighting', mood: 'polished and professional' });
  });
  it('puts style, camera, lighting and mood and the rules in every prompt, within the limit', () => {
    const prompt = buildScenePrompt({ description: 'A calm pool.', direction: styleDirection(['dark']), style: ['dark'], referenced: false, noPeople: true });
    for (const part of ['Style: dark.', 'Camera:', 'Lighting: low-key', 'Mood:', 'No text, captions, logos or watermarks', 'No people.', 'do not show any real business storefront, signage, vehicles, uniforms or branded products']) expect(prompt).toContain(part);
    expect(buildScenePrompt({ description: 'x'.repeat(3000), direction: styleDirection([]), style: [], referenced: true, noPeople: false }).length).toBeLessThanOrEqual(1000);
    expect(buildScenePrompt({ description: 'A pool.', direction: styleDirection([]), style: [], referenced: true, noPeople: false })).toContain('Start from the reference image and keep the subject exactly as it appears in it');
  });
});

describe('the storyboard', () => {
  it('has a hook, a main shot, supporting shots, and a branded ending, with a prompt for each generated scene', async () => {
    const board = await buildStoryboard({ brief: brief(), selection: none, input, complete: aiReply });
    expect(board.scenes.map((s) => [s.role, s.kind])).toEqual([['hook', 'clip'], ['main', 'clip'], ['support', 'clip'], ['ending', 'end_card']]);
    expect(board.total_seconds).toBe(15); expect(board.scenes.map((s) => s.seconds)).toEqual([4, 4, 4, 3]);
    for (const scene of board.scenes.filter((s) => s.kind === 'clip')) { expect(scene.prompt).toContain('Style: dark, cinematic, fast.'); expect(scene.prompt).toContain('Camera:'); expect(scene.prompt).toContain('Lighting:'); expect(scene.prompt).toContain('Mood:'); expect(scene.prompt!.length).toBeLessThanOrEqual(1000); }
    expect(board.scenes[0].prompt).toContain('A winter cover slowly draws across calm water.');
    const end = board.scenes[3]; expect(end).toMatchObject({ prompt: null, reference_asset_id: null, clip_video_id: null, on_screen_text: 'Book your pool closing today' }); // the ending is drawn here, never sent to the generator
  });
  it('starts the hook and main shots from the owner’s real photo, and gives the supporting shots the other selected photos in turn', async () => {
    const board = await buildStoryboard({ brief: brief({ length_seconds: 20 }), selection: matched('photo-aaaa', 'photo-bbbb'), input, complete: aiReply });
    expect(board.scenes.filter((s) => s.kind === 'clip').map((s) => [s.role, s.reference_asset_id])).toEqual([['hook', 'photo-aaaa'], ['main', 'photo-aaaa'], ['support', 'photo-bbbb'], ['support', 'photo-aaaa']]);
    for (const scene of board.scenes.filter((s) => s.kind === 'clip')) expect(scene.prompt).toContain('Start from the reference image');
  });
  it('makes every scene from text alone, with no invented business imagery, when no photo fits', async () => {
    const board = await buildStoryboard({ brief: brief(), selection: none, input, complete: aiReply });
    for (const scene of board.scenes.filter((s) => s.kind === 'clip')) { expect(scene.reference_asset_id).toBeNull(); expect(scene.prompt).toContain('A generic scene: do not show any real business storefront'); expect(scene.prompt).not.toContain('reference image'); }
  });
  it('asks the AI for generic scenes when there is no photo, and for the real photos to come to life when there is', async () => {
    const complete = vi.fn(async (system: string, _p: string) => aiReply(system));
    await buildStoryboard({ brief: brief(), selection: none, input, complete }); await buildStoryboard({ brief: brief(), selection: matched('photo-aaaa'), input, complete });
    const storyboardCalls = complete.mock.calls.filter(([system]) => /storyboard for ONE/.test(system));
    expect(storyboardCalls[0][1]).toContain('There are NO real photos to use'); expect(storyboardCalls[0][0]).toMatch(/Never describe the business's premises, staff, vehicles or products unless a real photo/);
    expect(storyboardCalls[1][1]).toContain('Real photos of the business WILL be used as the starting frame'); expect(storyboardCalls[1][1]).toContain('"Winter cover going on"');
  });
  it('honours “no people”', async () => {
    const board = await buildStoryboard({ brief: brief({ key_instructions: ['no people'] }), selection: none, input, complete: aiReply });
    expect(board.scenes[0].prompt).toContain('No people.');
  });
  it('writes the caption with its own step: a real hook, the real call to action, hashtags fitted to the platform', async () => {
    const board = await buildStoryboard({ brief: brief(), selection: none, input, complete: aiReply });
    expect(board.caption).toBe(goodCaption); expect(board.caption.split('\n')[0]).toBe('Is your pool ready for the first freeze?');
    expect(board.hashtags).toEqual(['#PoolClosing', '#WindsorEssex', '#PoolCare', '#SomersetPoolService']); expect(board.hashtags.length).toBeLessThanOrEqual(5);
    expect(board.cta).toBe('Book at somersetpoolservice.com or call (519) 982-4901.'); expect(board.scenes.at(-1)!.on_screen_text).toBe('Book your pool closing today'); expect(board.grade).toBe(0);
  });
  it('removes promises it cannot keep from the caption, without flattening its layout', async () => {
    const board = await buildStoryboard({ brief: brief(), selection: none, input, complete: async (system) => (/storyboard for ONE/.test(system) ? scenesReply : captionReply({ caption: `${goodCaption}\n\nGuaranteed to go viral.` })) });
    expect(board.caption).not.toMatch(/guarantee|viral/i); expect(board.caption.split('\n').filter(Boolean)).toHaveLength(3);
  });
  it('still makes a complete storyboard if the AI fails or answers nonsense', async () => {
    for (const complete of [async () => { throw new Error('down'); }, async () => 'Sure!', async () => '{}']) {
      const board = await buildStoryboard({ brief: brief(), selection: matched('photo-aaaa'), input, complete });
      expect(board.scenes).toHaveLength(4); expect(board.scenes[0].description).toContain('pool closing'); expect(board.scenes[0].reference_asset_id).toBe('photo-aaaa'); expect(board.caption).toContain('Thinking about pool closing?'); expect(board.scenes.at(-1)!.on_screen_text.length).toBeGreaterThan(5);
    }
  });
  it('is Instagram-style for anything that is not TikTok', async () => {
    expect((await buildStoryboard({ brief: brief({ platform: 'general' }), selection: none, input, complete: aiReply })).hashtags.length).toBeLessThanOrEqual(12);
  });
});
