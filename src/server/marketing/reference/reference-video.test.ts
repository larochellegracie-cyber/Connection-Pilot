import { describe, expect, it } from 'vitest';
import { colourFacts, frameSheets } from './analyze.js';
import { buildBlueprint, measuredStyle, sanitizeStyle, pacingOf, type ReferenceAnalysis } from './style.js';
import { blueprintMisses, sanitizeStoryboard, type StoryboardInput } from '../explainer/storyboard.js';
import { buildScript } from '../explainer/index.js';

const seg = (i: number, start: number, end: number, brightness = 0.9) => ({ index: i, start, end, seconds: end - start, brightness, motion: 3, colours: ['#ffffff'] });
const analysis = (segments: ReturnType<typeof seg>[], style: Partial<ReferenceAnalysis['style']> = {}): ReferenceAnalysis => {
  const measures = { seconds: segments.at(-1)!.end, width: 1080, height: 1920, fps: 30, vertical: true, hasAudio: true, meanVolumeDb: -20, cuts: [], segments, speechWordsPerMinute: null };
  return { id: 'ref-1', fileName: 'ad.mp4', createdAt: '', measures, style: { ...measuredStyle(measures), ...style }, pacing: pacingOf(measures), averageSceneSeconds: measures.seconds / segments.length };
};

describe('reference video blueprint', () => {
  it('reads brightness and colours from a small picture', () => { const px = Buffer.alloc(24 * 24 * 3, 255); expect(colourFacts(px).brightness).toBeCloseTo(1); });
  it('joins repeated swap scenes and always ends on a call to action', () => {
    const a = analysis([seg(1, 0, 4), seg(2, 4, 8), seg(3, 8, 12), seg(4, 12, 16)], { theme: 'light', scenes: Array(4).fill({ layout: 'hero_text_card', card: 'line', notes: '' }) });
    const bp = buildBlueprint(a, { photos: false, targetSeconds: null });
    expect(bp.slots.map((s) => s.type)).toEqual(['swap', 'cta']); expect(bp.slots[0].parts).toBe(4); expect(bp.theme).toBe('light'); expect(bp.voice).toBe(false);
  });
  it('turns photo scenes into lists when the business has no pictures, and respects the length asked for', () => {
    const a = analysis([seg(1, 0, 3), seg(2, 3, 6), seg(3, 6, 9)], { scenes: [{ layout: 'photo_full', card: 'none', notes: '' }, { layout: 'checklist', card: 'none', notes: '' }, { layout: 'cta', card: 'none', notes: '' }] });
    expect(buildBlueprint(a, { photos: false }).slots[0].type).toBe('steps'); expect(buildBlueprint(a, { photos: true }).slots[0].type).toBe('photo');
    const total = buildBlueprint(a, { photos: true, targetSeconds: 30 }).slots.reduce((sum, s) => sum + s.seconds, 0); expect(total).toBeGreaterThan(24);
  });
  it('never trusts the model: unknown layouts are corrected', () => {
    const a = analysis([seg(1, 0, 4), seg(2, 4, 8)]); expect(sanitizeStyle({ scenes: [{ layout: 'hologram' }], theme: 'neon' }, a.style, 2).scenes.map((s) => s.layout)).toHaveLength(2);
  });
  it('writes a swap scene from the business’s own words and checks the structure', () => {
    const a = analysis([seg(1, 0, 4), seg(2, 4, 8)], { scenes: [{ layout: 'hero_text_card', card: 'bars', notes: '' }, { layout: 'cta', card: 'none', notes: '' }] });
    const blueprint = buildBlueprint(a, { photos: false });
    const input: StoryboardInput = { request: 'a video for Somerset', business: { name: 'Somerset Pool Service', type: 'pool', location: 'Windsor', services: ['pool closings', 'pool openings'], description: '', tone: '' }, photos: [], character: 'logo', targetSeconds: 12, blueprint };
    const board = sanitizeStoryboard({ title: 'x', scenes: [{ type: 'swap', lead: 'Manage your', words: ['closings', 'openings', 'visits'], tail: 'in one place', card: 'line', items: [], brandLine: 'Somerset Pool Service', cta: 'Book now', narration: 'Simple.' }, { type: 'cta', headline: 'Book your closing', narration: 'Book today.' }] }, input);
    expect(board?.theme).toBe(blueprint.theme); expect(blueprintMisses(board!, blueprint)).toBe(0);
    const script = buildScript({ ...board!, theme: 'light' }, [8, 4], () => null, ['fade', 'wipe']);
    expect(script).toContain('video.theme("light")'); expect(script).toContain('video.explainer_swap("Manage your"'); expect(script).toContain('video.explainer_cta(');
  });
  it('splits a video into sheets of four frames', async () => { expect(typeof frameSheets).toBe('function'); });

  it('turns floating elements arranged in a circle into an orbit scene with the reference’s glow and depth', () => {
    const a = analysis([seg(1, 0, 6), seg(2, 6, 12), seg(3, 12, 18)], { theme: 'dark', arrangement: 'orbit', glow: 'strong', depth: 'layered', scenes: [{ layout: 'character_intro', card: 'none', notes: 'discs circling a central mascot' }, { layout: 'bubbles', card: 'none', notes: 'chips floating' }, { layout: 'cta', card: 'none', notes: '' }] });
    const bp = buildBlueprint(a, { photos: false });
    expect(bp.slots.map((s) => s.type)).toEqual(['orbit', 'chaos', 'cta']); expect(bp.look).toEqual({ glow: 1.7, depth: true, arrangement: 'orbit' });
  });
  it('writes an orbit scene, passes the glow on, and draws it in the script', () => {
    const a = analysis([seg(1, 0, 6), seg(2, 6, 12)], { theme: 'dark', glow: 'strong', scenes: [{ layout: 'orbit', card: 'none', notes: '' }, { layout: 'cta', card: 'none', notes: '' }] });
    const blueprint = buildBlueprint(a, { photos: false });
    const input: StoryboardInput = { request: 'a video for Somerset', business: { name: 'Somerset Pool Service', type: 'pool', location: 'Windsor', services: ['pool closings', 'pool openings', 'pool cleaning', 'power washing', 'repairs'], description: '', tone: '' }, photos: [], character: 'logo', targetSeconds: 12, blueprint };
    const board = sanitizeStoryboard({ title: 'x', scenes: [{ type: 'orbit', headline: 'One crew for it all', subtext: 'Pools, done right', labels: ['Pool closings', 'Pool openings', 'Pool cleaning', 'Power washing', 'Repairs'], narration: 'a' }, { type: 'cta', headline: 'Book today', narration: 'b' }] }, input)!;
    expect(board.scenes[0].type).toBe('orbit'); expect(blueprintMisses(board, blueprint)).toBe(0);
    const script = buildScript(board, [8, 4], () => null);
    expect(script).toContain('video.theme("dark", glow=1.7)'); expect(script).toContain('video.explainer_orbit("One crew for it all"');
  });
});
