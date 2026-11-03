import { describe, expect, it } from 'vitest';
import { cleanPalette, conceptPalette, conceptPlan, sanitizeConcept, writeConcept, PROP_KINDS, type ConceptInput } from './concept.js';
import { heroKindFor, missingHeroProp, usesReadyMade } from './index.js';
import { buildProductScript } from './product.js';

const input: ConceptInput = { request: 'Make me a 15 second video about a chocolate cake for Somerset.', subject: 'chocolate cake', seconds: 15, business: { name: 'Somerset Pool Service', type: 'Pool cleaning company', location: 'Windsor', services: ['pool closings', 'pool openings'], description: '', tone: '' }, photos: [{ id: 'photo-1', label: 'Pool photo' }], props: PROP_KINDS };
const scene = (over: Record<string, unknown> = {}) => ({ role: 'scene', seconds: 3, headline: 'Layer by layer', subtext: 'Sweet and simple', items: ['rich', 'dark'], visual: 'a cake builds layer by layer', photo: null, ...over });

describe('the concept of a fully custom video', () => {
  it('keeps the invented scenes, one hook and one closing sign-off with the business name, scaled to the length asked', () => {
    const concept = sanitizeConcept({ title: 'Cake', mood: 'warm', scenes: [scene({ role: 'hook' }), scene(), scene({ visual: 'candles light', headline: 'Make a wish' }), scene({ role: 'closing', headline: 'Book now', subtext: 'From all of us' })] }, input)!;
    expect(concept.scenes.map((s) => s.role)).toEqual(['hook', 'scene', 'scene', 'closing']); expect(concept.scenes.at(-1)!.headline).toBe('Somerset Pool Service'); expect(concept.scenes.at(-1)!.subtext).toBe('From all of us');
    expect(Math.round(concept.seconds)).toBe(15);
  });
  it('removes invented numbers, prices and links from the words, and photos that were not offered', () => {
    const concept = sanitizeConcept({ scenes: [scene({ headline: 'Only 5 dollars', subtext: 'Visit cakes.com now', photo: 'nope' }), scene(), scene(), scene({ role: 'closing' })] }, input)!;
    expect(concept.scenes[0].headline).not.toMatch(/\d/); expect(concept.scenes[0].subtext).not.toMatch(/cakes\.com/); expect(concept.scenes[0].photoId).toBeNull();
  });
  it('picks colours for the subject, repairs unusable ones, and never lets a mid-tone backdrop through', () => {
    const good = { bgA: '#2A1020', bgB: '#12080F', glow: '#FFB347', glow2: '#FF6F91', toneA: '#F5E6CC', toneB: '#C98B5B' };
    expect(sanitizeConcept({ mood: 'warm', palette: good, scenes: [scene(), scene(), scene(), scene({ role: 'closing' })] }, input)!.palette).toMatchObject({ bgA: '#2A1020', light: false });
    expect(sanitizeConcept({ mood: 'a warm chocolate treat', palette: { bgA: 'red' }, scenes: [scene(), scene(), scene(), scene({ role: 'closing' })] }, input)!.palette.bgA).toBe('#3A1D2A'); // the dessert preset
    expect(cleanPalette({ ...good, bgA: '#808080' }, 'water').bgA).toBe('#0B3C5D'); // mid grey is refused; the water preset
    expect(conceptPalette(sanitizeConcept({ palette: { ...good, bgA: '#FFF1E6', bgB: '#FFD6C2' }, scenes: [scene(), scene(), scene(), scene({ role: 'closing' })] }, input)!)).toMatchObject({ dark: false, text: '#1B1B22', tone_a: '#F5E6CC' });
  });
  it('is not usable with too few real scenes', () => { expect(sanitizeConcept({ scenes: [scene(), { role: 'scene', visual: '' }] }, input)).toBeNull(); expect(sanitizeConcept('nonsense', input)).toBeNull(); });
  it('is asked for twice, then gives up', async () => {
    let calls = 0; const none = await writeConcept(input, async () => { calls += 1; return 'not json'; }); expect(none).toBeNull(); expect(calls).toBe(2);
    const ok = await writeConcept(input, async () => JSON.stringify({ scenes: [scene(), scene(), scene(), scene({ role: 'closing' })] })); expect(ok?.scenes).toHaveLength(4);
  });
  it('becomes a plan the code writer can use, with no service words in it', () => {
    const concept = sanitizeConcept({ scenes: [scene(), scene(), scene(), scene({ role: 'closing' })] }, input)!;
    const plan = conceptPlan(concept, { name: 'Somerset', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null }, input.photos);
    expect(plan.summary.scenes).toHaveLength(4); expect(plan.summary.scenes[0]).toMatchObject({ visual: 'a cake builds layer by layer' }); expect(JSON.stringify(plan.summary)).not.toMatch(/closing service|openings|maintenance/i);
  });
  it('refuses a fully custom script that uses the ready-made scenes', () => {
    expect(usesReadyMade('def build(video):\n    video.hook_kinetic("p1", "x")\n    video.cta_pro("y")\n')[0]).toMatch(/hook_kinetic, video\.cta_pro/);
    expect(usesReadyMade('def build(video):\n    video.add_scene(3, draw)\n')).toEqual([]);
  });

  it('asks for the ready-made prop when the subject has one, and for nothing when it does not', () => {
    expect(missingHeroProp('def build(video):\n    c.cylinder(1, 2, 3, 4, "#fff")\n', 'our chocolate birthday cake')[0]).toMatch(/c\.prop\("cake"/);
    expect(missingHeroProp('def build(video):\n    c.prop("cake", 540, 900, 800, k, t)\n', 'a chocolate cake')).toEqual([]);
    expect(missingHeroProp('def build(video):\n    pass\n', 'a cupcake')[0]).toMatch(/"cupcake"/);
    expect(missingHeroProp('def build(video):\n    pass\n', 'a new logo reveal')).toEqual([]);
  });

  it('builds a product advert from the reference blueprint: placement, camera, headline place and timing per scene, the hero building up, a sign-off at the end', () => {
    const concept = sanitizeConcept({ scenes: [scene({ role: 'hook' }), scene(), scene(), scene({ role: 'closing', subtext: 'warm wishes' })] }, input)!;
    const sc = (camera: string, size: string, place: string, transition: string) => ({ seconds: 3.75, role: 'scene' as const, transition, headline: { position: 'upper third', size, align: 'left' }, product: { placement: place, size: 'large' }, camera, objectMotion: '', textTiming: 'short headline appears near start' });
    const design: any = { format: '9:16', totalSeconds: 15, sceneCount: 4, pacing: 'medium', visual: {}, avoid: [], motion: { transitions: [], overall: '', scenes: [sc('push_in', 'm', 'center', 'fade'), sc('static', 's', 'center', 'zoom'), sc('push_in', 'l', 'center', 'fade'), sc('pull_out', 'm', 'right', 'fade')] } };
    const script = buildProductScript(concept, design, 'prop:cake');
    expect(script.match(/video\.product_scene\(/g)).toHaveLength(4); expect(script).toContain('camera="push_in"'); expect(script).toContain('camera="pull_out"'); expect(script).toContain('placement="right"'); expect(script).toContain('transition="zoom"');
    expect(script).toContain('k0=0, k1=0.333'); expect(script).toContain('closing=True, sign_line="warm wishes"'); expect(script).toContain('text_at=0.1'); expect(usesReadyMade(script)).toEqual([]);
    expect(heroKindFor('our chocolate birthday cake')).toBe('cake'); expect(heroKindFor('a new logo')).toBeNull();
  });
});
