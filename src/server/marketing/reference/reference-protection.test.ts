import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { sanitizeConcept } from '../code-video/concept.js';
import { renderProductAd } from '../code-video/product.js';
import { codeVideoSupport } from '../code-video/sandbox.js';
import { resolveProductAsset } from '../product-asset.js';
import { createCanvas } from '@napi-rs/canvas';
import { saveBusinessImage } from '../standard-video/business-assets.js';
import { LocalVolumeStorage, type AssetMeta } from '../standard-video/storage.js';
import { aggregateRoles, colourDistance, colourRoles, saturationOf } from './colour.js';
import { buildDesignBlueprint, paletteFrom } from './design.js';
import { correlation, LOGO_MATCH, nearestWindow, patchFromGray, printFromRgba, REGIONS, smooth, type LogoPrint, lumaOf } from './logo.js';
import { cleanReferenceText, findReferenceText, forbiddenFor, redact, scriptStrings } from './protect.js';
import { buildBlueprint, type ReferenceAnalysis } from './style.js';
import { logoInVideo, printFromVideo, videoColourRoles, warmBeigeOrTan } from './verify.js';

const BEIGE: [number, number, number] = [216, 195, 165]; const BROWN: [number, number, number] = [122, 92, 62]; const DARK: [number, number, number] = [74, 42, 24];
/** A 64 x 64 frame like the reference: a beige backdrop with side strips clear of the hero, a brown floor, a dark hero in the middle, a bright light and a small accent. */
const frame = (back = BEIGE, floor = BROWN, hero = DARK) => {
  const d = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
    let c = y >= 50 ? floor : back;
    if (x >= 19 && x < 45 && y >= 22 && y < 51) c = hero;
    if (x >= 4 && x < 10 && y >= 6 && y < 12) c = [255, 243, 220];
    if (x >= 50 && x < 56 && y >= 30 && y < 36) c = [201, 34, 100];
    const i = (y * 64 + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return d;
};
const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

describe('colour roles', () => {
  it('reads the backdrop, floor, hero, light and accent by role, not as one grey average', () => {
    const roles = colourRoles(frame(), 64);
    expect(colourDistance(roles.background, hex(BEIGE))).toBeLessThan(25); expect(colourDistance(roles.floor, hex(BROWN))).toBeLessThan(25); expect(colourDistance(roles.hero, hex(DARK))).toBeLessThan(30);
    expect(colourDistance(roles.glow, '#FFF3DC')).toBeLessThan(60); expect(saturationOf(roles.accent)).toBeGreaterThan(0.3); expect(roles.temperature).toBe('warm'); expect(roles.warmth).toBeGreaterThan(0.05);
    const px = frame(); let r = 0; let g = 0; let b = 0; for (let i = 0; i < 64 * 64; i += 1) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; }
    const average = hex([Math.round(r / 4096), Math.round(g / 4096), Math.round(b / 4096)]);
    expect(colourDistance(average, hex(BEIGE))).toBeGreaterThan(colourDistance(roles.background, hex(BEIGE)) + 30); // averaging the frame loses the beige; the role keeps it
    expect(roles.proportions.length).toBeGreaterThan(2); expect(roles.proportions.reduce((s, p) => s + p.share, 0)).toBeLessThanOrEqual(1.01); expect(roles.proportions[0].role).toBe('background');
  });
  it('combines frames into one set of roles, and tells warm beige or tan from grey or blue', () => {
    const many = aggregateRoles([colourRoles(frame(), 64), colourRoles(frame([220, 198, 168]), 64), colourRoles(frame([212, 192, 162]), 64)])!; expect(colourDistance(many.background, hex(BEIGE))).toBeLessThan(25);
    expect(warmBeigeOrTan(many).warmBeigeOrTan).toBe(true);
    const grey = colourRoles(frame([150, 150, 150], [100, 100, 100], [60, 60, 60]), 64); const blue = colourRoles(frame([60, 100, 180], [30, 50, 100], [20, 30, 60]), 64);
    expect(warmBeigeOrTan(grey)).toMatchObject({ warmBeigeOrTan: false }); expect(warmBeigeOrTan(grey).why).toMatch(/grey/); expect(warmBeigeOrTan(blue).warmBeigeOrTan).toBe(false);
  });
});

describe('the floor and the backdrop', () => {
  it('keeps them as two surfaces when the reference shows a floor, and does not invent a floor when it does not', () => {
    const roles = colourRoles(frame(), 64); // a beige backdrop with a brown floor from the bottom fifth
    expect(roles.separated).toBe(true); expect(roles.horizon).not.toBeNull(); expect(roles.horizon!).toBeGreaterThan(0.7); expect(roles.horizon!).toBeLessThan(0.85);
    expect(colourDistance(roles.floor, hex(BROWN))).toBeLessThan(25); expect(colourDistance(roles.floor, roles.background)).toBeGreaterThan(80);
    const p = paletteFrom(analysisOf(roles)); expect(colourDistance(p.bgA, roles.background)).toBeLessThan(15); expect(colourDistance(p.bgB, roles.floor)).toBeLessThan(5); // the floor is used as measured, not blended into the wall
    const bp = buildBlueprint(analysisOf(roles), { photos: false }); expect(bp.design!.visual.horizon).toBeCloseTo(roles.horizon!, 2);
    const flat = colourRoles(frame(BEIGE, BEIGE, DARK), 64); expect(flat.separated).toBe(false); expect(buildBlueprint(analysisOf(flat), { photos: false }).design!.visual.horizon).toBeNull();
    expect(colourDistance(paletteFrom(analysisOf(flat)).bgB, flat.background)).toBeGreaterThan(0); // no floor: the lower set is the backdrop a little darker, never a different colour
  });
});

const analysisOf = (roles: ReturnType<typeof colourRoles> | null, extra: Partial<ReferenceAnalysis['style']> = {}): ReferenceAnalysis => {
  const segment = (i: number) => ({ index: i + 1, start: i * 3.75, end: (i + 1) * 3.75, seconds: 3.75, brightness: 0.7, motion: 3, colours: ['#AFA496'], geometry: { colours: roles ?? undefined, subject: { x: 0.5, y: 0.6, spread: 0.3 }, calmest: 'top', placement: 'center', drift: { dx: 0, dy: 0 }, zoom: i === 0 ? 1.2 : 1, activity: [1, 1, 1, 1, 1, 1, 1, 1], glowAt: 'top' } });
  const scene = (i: number) => ({ layout: i === 3 ? 'cta' : 'product_hero', card: 'none', notes: '', design: { elements: 0, shape: 'none', headline: { position: 'upper', align: 'left', size: 'l' }, character: null, rotation: 'none', product: { placement: ['center', 'low_center', 'center', 'right'][i], size: 'large', camera: ['push_in', 'static', 'pan', 'pull_out'][i], objectMotion: 'builds up', textTiming: 'near the start' } } });
  return { id: 'ref-test-0001', fileName: 'ref.mp4', createdAt: 'x', pacing: 'medium', averageSceneSeconds: 3.75, measures: { seconds: 15, width: 1080, height: 1920, fps: 30, vertical: true, hasAudio: false, meanVolumeDb: null, cuts: [], speechWordsPerMinute: null, ...(roles ? { colourRoles: roles } : {}), segments: [0, 1, 2, 3].map(segment) } as never, style: { feel: 'warm', theme: 'light', textTreatment: 'kinetic_headline', motion: 'smooth', transitions: ['fade'], usesCharacter: false, usesPhotos: false, hasVoiceover: false, arrangement: 'none', glow: 'soft', depth: 'layered', palette: [], source: 'vision', kind: 'product_scene', lighting: 'soft warm light', background: 'warm beige set', typography: 'bold sans', negativeSpace: 'high', avoid: [], scenes: [0, 1, 2, 3].map(scene), ...extra } as never };
};

describe('the palette the generator receives', () => {
  it('uses the measured colours as they are: backdrop on top, the floor below, the measured light, readable words', () => {
    const roles = colourRoles(frame(), 64); const p = paletteFrom(analysisOf(roles));
    expect(colourDistance(p.bgA, hex(BEIGE))).toBeLessThan(30); expect(colourDistance(p.bgB, hex(BROWN))).toBeLessThan(60); expect(p.glow).toBe(roles.glow); expect(p.toneA).toBe(roles.hero); expect(p.light).toBe(true);
    expect(warmBeigeOrTan({ ...roles, background: p.bgA }).warmBeigeOrTan).toBe(true); // the palette itself is warm beige, not grey
    const ratio = (a: string, b: string) => { const l = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); const [hi, lo] = [l(a), l(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    expect(ratio(p.text!, p.bgA)).toBeGreaterThanOrEqual(4.5);
  });
  it('reaches the blueprint: the design carries the roles, the palette and every scene\'s numbers', () => {
    const roles = colourRoles(frame(), 64); const a = analysisOf(roles); const bp = buildBlueprint(a, { photos: false, targetSeconds: 15 });
    expect(bp.engine).toBe('custom'); expect(bp.design!.visual.colours).toEqual(roles); expect(bp.design!.visual.palette.glow).toBe(roles.glow); expect(bp.design!.motion.scenes.map((s) => s.camera)).toEqual(['push_in', 'static', 'pan', 'pull_out']); expect(bp.design!.sceneCount).toBe(4);
    expect(buildDesignBlueprint(a, bp.slots, { totalSeconds: 15 }).visual.colours?.temperature).toBe('warm');
  });
});

const fakeStorage = (assets: Array<Partial<AssetMeta> & { id: string; label: string }>) => ({ listAssets: async () => assets.map((a) => ({ kind: 'product', description: '', tags: [], originalName: 'x', mime: 'image/jpeg', width: 10, height: 10, bytes: 1, createdAt: 'x', ...a })) }) as never;
const business = { businessName: 'Staci Bakes', businessType: 'Bakery' };
describe('the product asset decision', () => {
  it('uses the business\'s own photo when it covers the product, over a generated or drawn one', async () => {
    const d = await resolveProductAsset({ tenantId: 't', subject: 'our chocolate birthday cake', business, storage: fakeStorage([{ id: 'logo-1', kind: 'logo', label: 'Logo' }, { id: 'cake-1', label: 'Chocolate birthday cake', tags: ['cake'] }, { id: 'drip-1', label: 'Caramel drip cake' }]), generated: { id: 'gen-1', label: 'AI image – cake' } });
    expect(d).toMatchObject({ found: true, mode: 'own_photo', asset: { id: 'cake-1' } }); expect(d.reason).toMatch(/instead of a generated or drawn product/); expect(d.terms).toEqual(['chocolate', 'cake']); // "birthday" says what it is for, not what it is
  });
  it('does not take a photo that is not that product: a chocolate cupcake or a caramel cake for a chocolate cake', async () => {
    const d = await resolveProductAsset({ tenantId: 't', subject: 'our chocolate birthday cake', business, storage: fakeStorage([{ id: 'cup-1', label: 'Chocoholic chocolate cupcake', tags: ['chocolate', 'cupcake'] }, { id: 'drip-1', label: 'Caramel drip cake', tags: ['cake'] }]) });
    expect(d).toMatchObject({ found: false, mode: 'drawn_product', asset: null }); expect(d.considered.map((c) => [c.label, c.missing.join('+')])).toEqual(expect.arrayContaining([['Chocoholic chocolate cupcake', 'cake'], ['Caramel drip cake', 'chocolate']])); expect(d.reason).toMatch(/not a photo of the business’s own work/);
  });
  it('uses a picture generated for the request when there is no matching photo, and never one of the business\'s logos or earlier generated pictures as its own', async () => {
    const d = await resolveProductAsset({ tenantId: 't', subject: 'chocolate cake', business, storage: fakeStorage([{ id: 'logo-1', kind: 'logo', label: 'Chocolate cake logo' }, { id: 'old-1', label: 'AI image – chocolate cake', tags: ['generated', 'ai-image'] }]), generated: { id: 'gen-2', label: 'AI image – chocolate cake' } });
    expect(d).toMatchObject({ found: false, mode: 'generated_image', asset: { id: 'gen-2' } }); expect(d.considered).toHaveLength(0);
    expect((await resolveProductAsset({ tenantId: 't', subject: 'chocolate cake', business, storage: fakeStorage([]) })).reason).toMatch(/no product photos/);
  });
});

describe('reference text protection', () => {
  const seen = cleanReferenceText({ brand_names: ['Marlow Tiles', 'x'], words: ['Marlow', 'tiles', 'the', 'Grout'], phrases: [{ text: 'Laid right the first time', kind: 'slogan' }, { text: 'Layers assemble', kind: 'descriptive' }, { text: 'warm glaze catches light', kind: 'descriptive' }, 'ok'] });
  it('sorts what the reference said into brand names, identifying slogans and ordinary descriptive lines', () => {
    expect(seen.brands).toEqual(['Marlow Tiles']); expect(seen.words).toEqual(expect.arrayContaining(['Marlow', 'Grout'])); expect(seen.words).not.toContain('the');
    expect(seen.slogans).toEqual(['Laid right the first time']); expect(seen.phrases).toEqual(['Layers assemble', 'warm glaze catches light']);
    // with no label from the vision step, a line is identifying when it names the brand, has a number or a contact, or is as long as a tagline
    const plain = cleanReferenceText({ brand_names: ['Somerset'], phrases: ['Somerset Pool Service & Power Washing', 'Call 519 982 4901', 'rich slices stack up', 'Layers assemble', 'we make every single birthday a little bit more special today'] });
    expect(plain.slogans).toEqual(['Somerset Pool Service & Power Washing', 'Call 519 982 4901', 'we make every single birthday a little bit more special today']); expect(plain.phrases).toEqual(['rich slices stack up', 'Layers assemble']);
  });
  it('lets the owner\'s own words through (a name the owner shares with the reference is not forbidden)', () => {
    const f = forbiddenFor(seen, 'Make me a video for Staci Bakes about our tiles cake'); expect(f.words).toContain('marlow'); expect(f.words).not.toContain('tiles'); expect(f.brands).toContain('Marlow Tiles'); expect(f.words).not.toContain('grout');
    expect(forbiddenFor({ brands: [], words: [], phrases: ['Layers assemble'], slogans: ['Layers assemble slowly'] }, 'layers assemble slowly please').slogans).toEqual([]); // the owner asked for those words
  });
  it('refuses the brand and identifying slogans strictly (whole line, or two of its words in a row), whatever the case or punctuation, and only whole words', () => {
    const f = forbiddenFor(seen, 'Staci Bakes cake');
    const found = findReferenceText([{ where: 'headline', text: 'MARLOW TILES: made for you' }, { where: 'caption', text: 'laid right, the first time!' }, { where: 'hashtag', text: 'Marlowe' }, { where: 'item', text: 'Grout-free' }, { where: 'ok', text: 'A sweet start' }], f);
    expect(found.map((v) => `${v.where}:${v.found}`)).toEqual(expect.arrayContaining(['headline:Marlow Tiles', 'headline:marlow', 'caption:Laid right the first time'])); expect(found.some((v) => v.where === 'item' || v.where === 'hashtag' || v.where === 'ok')).toBe(false);
    expect(findReferenceText([{ where: 'copy', text: 'we laid right every day' }, { where: 'fine', text: 'right on time, first class' }], f).map((v) => v.where)).toEqual(['copy']); // two words in a row from a slogan count as copying it
  });
  it('does NOT refuse generic descriptive wording that happens to match the reference, only a long descriptive line lifted word for word', () => {
    const f = forbiddenFor(seen, 'Staci Bakes cake');
    expect(findReferenceText([{ where: 'a', text: 'Layers assemble' }, { where: 'b', text: 'Watch the layers assemble, one by one' }, { where: 'c', text: 'Glaze catches the light' }, { where: 'd', text: 'A warm glaze' }], f)).toEqual([]);
    expect(findReferenceText([{ where: 'lifted', text: 'Warm glaze catches light.' }], f).map((v) => v.where)).toEqual(['lifted']); // four words, word for word
  });
  it('finds the words in a drawing script, and takes them out as a last resort', () => {
    const f = forbiddenFor(seen, 'Staci Bakes cake'); const script = 'def build(video):\n    video.product_scene("Marlow Tiles rock", "Sweet start", "prop:cake", 3.75, placement="center")\n';
    expect(scriptStrings(script)).toEqual(['Marlow Tiles rock', 'Sweet start']); expect(findReferenceText(scriptStrings(script).map((text) => ({ where: 'script', text })), f).length).toBeGreaterThan(0);
    expect(redact('Sweet news from Marlow Tiles: laid right the first time', f)).toBe('Sweet news from'); expect(findReferenceText([{ where: 'x', text: redact('Sweet news from Marlow Tiles', f) }], f)).toEqual([]);
  });
});

describe('the headline is never behind the product', () => {
  it('places and sizes the hero below the words and above the sign-off for every size, place, headline length and scene', async () => {
    const support = await codeVideoSupport(); if (!support.ok || !support.python) { console.warn('skipped: Python is not set up here'); return; }
    const script = ['import sys, json', 'sys.path.insert(0, sys.argv[1])', 'from pilot_product import fit_hero, HERO_ABOVE, HERO_BELOW, PUSH_MARGIN', 'bad = []; n = 0', 'H = 1920.0',
      'for width in (560, 760, 960):', ' for fy in (0.46, 0.56, 0.6, 0.62):', '  for lines in (1, 2, 3):', '   for sub in (0, 1):', '    for closing in (False, True):', '     for photo in (False, True):',
      '      top = 380.0; text_bottom = top + lines * 104 * 1.04 + (70 if sub else 0)', '      cy, w = fit_hero(H, text_bottom, fy, width, closing, photo)', '      above, below = (0.55, 0.55) if photo else (HERO_ABOVE, HERO_BELOW)',
      '      hero_top = cy - w * (above + PUSH_MARGIN); hero_bottom = cy + w * below; limit = H * (0.835 if closing else 0.93); n += 1',
      '      if hero_top < text_bottom + 30 - 0.5 or hero_bottom > limit + 0.5 or w < 300: bad.append([width, fy, lines, sub, closing, photo, round(hero_top), round(text_bottom), round(hero_bottom), round(w)])',
      'print(json.dumps({"n": n, "bad": bad[:5]}))'].join('\n');
    const run = spawnSync(support.python, ['-I', '-c', script, path.join(process.cwd(), 'src/server/marketing/code-video/runtime')], { encoding: 'utf8' });
    const out = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}'); expect(out.n).toBe(3 * 4 * 3 * 2 * 2 * 2); expect(out.bad).toEqual([]);
  });
});

describe('logo patterns', () => {
  const W = 540; const H = 960; const region = REGIONS.top_left; const bx = Math.round(region.x * W) + 20; const by = Math.round(region.y * H) + 14; // the chip sits inside the logo region
  type C = [number, number, number];
  const frameWith = (draw: (x: number, y: number) => C) => { const g = new Uint8Array(W * H * 4); for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const c = draw(x, y); const i = (y * W + x) * 4; g[i] = c[0]; g[i + 1] = c[1]; g[i + 2] = c[2]; g[i + 3] = 255; } return g; };
  const BEIGE_PX: C = [165, 150, 130]; const WHITE: C = [245, 245, 245]; const ORANGE: C = [225, 97, 26]; const PINK: C = [252, 111, 123]; const BROWN: C = [60, 40, 30];
  /** A white chip on a beige backdrop with a mark inside it. The same chip (size, colour, place) is used for every logo, as Pilot's own logo chip is. */
  const chip = (x0: number, y0: number, mark?: (u: number, v: number) => boolean, ink: C = ORANGE) => (x: number, y: number): C => { const u = x - x0; const v = y - y0; if (u >= 0 && u < 96 && v >= 0 && v < 46) return mark && mark(u - 10, v - 8) ? ink : WHITE; return BEIGE_PX; };
  /** The same strokes as plain text straight on the backdrop (no chip), as a headline is. */
  const text = (x0: number, y0: number, mark: (u: number, v: number) => boolean, ink: C) => (x: number, y: number): C => (mark(x - x0 - 10, y - y0 - 8) ? ink : BEIGE_PX);
  const wordA = (u: number, v: number) => (u >= 0 && u < 70 && v >= 3 && v < 6) || (u >= 5 && u < 9 && v >= 0 && v < 26) || (u >= 22 && u < 26 && v >= 8 && v < 26) || (u >= 42 && u < 46 && v >= 0 && v < 26);
  const wordB = (u: number, v: number) => (u >= 0 && u < 30 && v >= 20 && v < 24) || (u >= 36 && u < 40 && v >= 0 && v < 26) || (u >= 50 && u < 70 && v >= 10 && v < 14);
  const print = printFromRgba(frameWith(chip(bx, by, wordA)), W, H, 'top_left') as LogoPrint;
  it('locates the logo\'s own chip, keeps only its inside, and remembers its ink and paper colours', () => {
    expect(print).not.toBeNull(); expect(print.box.w * W).toBeGreaterThan(80); expect(print.box.w * W).toBeLessThan(110); expect(print.box.h * H).toBeLessThan(60);
    expect(colourDistance(hex([...print.ink]), hex([...ORANGE]))).toBeLessThan(120); expect(colourDistance(hex([...print.paper]), hex([...WHITE]))).toBeLessThan(40);
  });
  it('finds the same logo wherever it sits in a finished frame', () => { const near = nearestWindow(frameWith(chip(300, 700, wordA)), W, H, print, 4); expect(near.confirmed).toBeGreaterThanOrEqual(LOGO_MATCH); });
  it('does not mistake a different logo, an empty chip, or a line of ordinary text for the reference logo', () => {
    expect(nearestWindow(frameWith(chip(bx, by, wordB)), W, H, print, 4).confirmed).toBeLessThan(LOGO_MATCH); // another logo on the same kind of chip
    expect(nearestWindow(frameWith(chip(bx, by)), W, H, print, 4).confirmed).toBeLessThan(LOGO_MATCH); // a chip with nothing in it
    // the real false positive: strokes with the same shape as the logo, in dark text straight on a pale backdrop, look like it by pattern but are not its colours
    const headline = nearestWindow(frameWith(text(300, 400, wordA, BROWN)), W, H, print, 4); expect(headline.similarity).toBeGreaterThanOrEqual(LOGO_MATCH); expect(headline.confirmed).toBeLessThan(LOGO_MATCH);
    expect(nearestWindow(frameWith(chip(300, 700, wordA, PINK)), W, H, print, 4).confirmed).toBeLessThan(LOGO_MATCH); // the same shapes in another business's colours are another logo
  }, 120_000);
  it('can never match a flat or empty frame, and a flat region makes no pattern', () => { expect(nearestWindow(frameWith(() => BEIGE_PX), W, H, print, 8).confirmed).toBeLessThan(LOGO_MATCH); expect(printFromRgba(frameWith(() => BEIGE_PX), W, H, 'top_left')).toBeNull(); expect(correlation(print.cells, new Array(print.cells.length).fill(120))).toBe(0); void lumaOf; void patchFromGray; void smooth; });
});

describe('a real render: the output\'s own colours', () => {
  let root = ''; afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });
  it('draws the product scenes in the reference\'s warm beige and tan, with the business\'s own logo and none of the reference\'s', async () => {
    const support = await codeVideoSupport(); if (!support.ok) { console.warn('skipped: the drawing sandbox is not set up here'); return; }
    /* the sandbox's rules name real paths (on a Mac /var is a link to /private/var) */ root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'product-render-'))); const storage = new LocalVolumeStorage(root, false);
    const roles = colourRoles(frame(), 64); const a = analysisOf(roles); const bp = buildBlueprint(a, { photos: false, targetSeconds: 6 }); const design = bp.design!;
    const input = { request: 'x', subject: 'chocolate birthday cake', seconds: 6, business: { name: 'Staci Bakes', type: 'Bakery', location: '', services: [], description: '', tone: '' }, photos: [], props: ['cake'], reference: design };
    const concept = sanitizeConcept({ scenes: ['A sweet start', 'Layers rise', 'Make a wish', 'x'].map((headline, i) => ({ role: i === 3 ? 'closing' : 'scene', seconds: 2, headline, subtext: i === 0 ? 'rich and silky' : '', items: [], visual: 'the cake builds', photo: null })) }, input)!;
    const kit = { name: 'Staci Bakes', primary: '#FC6F7B', secondary: '#8F3550', accent: '#F6DBDE', logoUrl: null }; const work = path.join(root, 'work'); const out = path.join(work, 'out.mp4'); // the sandbox may only write inside the job's own folder
    const palette = { dark: false, bg_a: concept.palette.bgA, bg_b: concept.palette.bgB, text: concept.palette.text ?? '#1B1B22', glow: concept.palette.glow, glow2: concept.palette.glow2, scrim: concept.palette.bgB, tone_a: concept.palette.toneA, tone_b: concept.palette.toneB };
    const logo = createCanvas(420, 160); const lx = logo.getContext('2d'); lx.fillStyle = '#FFFFFF'; lx.fillRect(0, 0, 420, 160); lx.fillStyle = '#FC6F7B'; lx.font = 'bold 110px sans-serif'; lx.fillText('Staci', 20, 120); lx.fillRect(20, 135, 380, 10);
    const logoId = (await saveBusinessImage({ tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bytes: logo.toBuffer('image/png'), originalName: 'logo.png', fields: { kind: 'logo', label: 'Staci Bakes logo' }, storage })).id;
    const result = await renderProductAd({ tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', concept, design, kit, logoId, storage, workDir: work, outPath: out, palette, hero: 'prop:cake', photos: [] });
    expect(result.ok ? 'ok' : result.reason).toBe('ok'); if (!result.ok) return;
    // the blueprint's numbers are in the drawing script and the palette is in the drawing brief
    expect(result.script).toContain('camera="push_in"'); expect(result.script).toContain('camera="pull_out"'); expect(result.script).toContain('placement="right"'); expect(result.script).not.toMatch(/hook_kinetic|cta_pro|feature_float/);
    const brief = JSON.parse(await readFile(path.join(work, 'product', 'brief.json'), 'utf8')); expect(brief.palette.bg_a).toBe(design.visual.palette.bgA); expect(brief.palette.glow).toBe(roles.glow); expect(JSON.stringify(brief)).not.toMatch(/somerset|pool/i);
    // the output's own colours
    const measured = (await videoColourRoles(out, 1))!; const warm = warmBeigeOrTan(measured);
    expect(warm.why).toBeTruthy(); expect(warm.warmBeigeOrTan).toBe(true); expect(measured.temperature).toBe('warm'); expect(colourDistance(measured.background, design.visual.palette.bgA)).toBeLessThan(90); expect(colourDistance(measured.background, roles.background)).toBeLessThan(90); // the set's lights and vignette shift the backdrop a little, never to another colour expect(saturationOf(measured.background)).toBeGreaterThan(0.1); expect(measured.separated).toBe(true); expect(colourDistance(measured.floor, measured.background)).toBeGreaterThan(30); // a floor and a wall, not one blended colour
    // the reference's logo is not in it; and the detector does find a logo that is
    const fake: LogoPrint = { position: 'top_left', region: REGIONS.top_left, box: { w: 0.18, h: 0.05 }, ink: [225, 97, 26], paper: [255, 255, 255], cells: Array.from({ length: 64 * 24 }, (_, i) => ((Math.floor(i / 64) + (i % 64)) % 9 < 4 ? 30 : 230)) };
    expect((await logoInVideo(out, fake)).found).toBe(false); // the reference's logo is not in the finished video
    const control = await printFromVideo(out, 'top_left'); expect(control).not.toBeNull(); expect((await logoInVideo(out, control!)).found).toBe(true); // the detector does find a logo that is there
  }, 1_200_000);
});
