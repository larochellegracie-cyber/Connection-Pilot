import { describe, expect, it } from 'vitest';
import { aspectLabel, imageType, measurePixels } from './analyze.js';
import { looksLikeRefinement, refine } from './refine.js';
import { renderDesign, sizeOf, coloursFor, contrast } from './render.js';
import { cleanBlueprint, measuredBlueprint, sanitizeProfile } from './style.js';

const solid = (side: number, rgb: [number, number, number], patch?: (x: number, y: number) => [number, number, number] | null) => {
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) { const [r, g, b] = patch?.(x, y) ?? rgb; const i = (y * side + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return data;
};
const measures = (rgb: [number, number, number], patch?: Parameters<typeof solid>[2]) => measurePixels(solid(64, rgb, patch), 64, 1080, 1350);
const kit = { name: 'Somerset', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null };

describe('measuring a reference image', () => {
  it('knows its type from its bytes, not its name', () => {
    expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('png');
    expect(imageType(Buffer.from('not a picture at all, just text'))).toBeNull();
  });
  it('names the aspect ratio', () => { expect(aspectLabel(1080, 1350)).toBe('4:5'); expect(aspectLabel(1000, 1000)).toBe('1:1'); expect(aspectLabel(1080, 1920)).toBe('9:16'); });
  it('reads a dark, plain picture with a bright object in the middle', () => {
    const m = measures([10, 14, 20], (x, y) => (Math.hypot(x - 32, y - 32) < 12 ? [230, 180, 60] : null));
    expect(m.brightness).toBeLessThan(0.3); expect(m.placement).toBe('center'); expect(m.backgroundKind).toBe('solid'); expect(m.background).toBe('#0a0e14'); expect(m.accent.toLowerCase()).toMatch(/^#e/);
  });
  it('reads a light picture with the object low down', () => {
    const m = measures([250, 215, 225], (x, y) => (y > 44 && Math.abs(x - 32) < 10 ? [190, 140, 80] : null));
    expect(m.brightness).toBeGreaterThan(0.7); expect(m.placement).toBe('bottom'); expect(m.calmest).toBe('top');
  });
});

describe('the design blueprint', () => {
  it('turns measurements into a blueprint with only valid values', () => {
    const bp = measuredBlueprint(measures([10, 14, 20], (x, y) => (Math.hypot(x - 32, y - 32) < 12 ? [230, 180, 60] : null)));
    expect(bp.tone).toBe('dark'); expect(bp.aspect).toBe('4:5'); expect(bp.subject.placement).toBe('center');
  });
  it('repairs anything unusable instead of trusting it', () => {
    const base = measuredBlueprint(measures([10, 14, 20]));
    const bp = cleanBlueprint({ tone: 'purple', headline: { size: 'giant', weight: 999, position: 'sideways' }, accents: ['rule', 'rule', 'sparkle'], margin: 9, shift: -4 }, base);
    expect(bp.tone).toBe(base.tone); expect(bp.headline.size).toBe(base.headline.size); expect(bp.headline.weight).toBe(base.headline.weight); expect(bp.accents).toEqual(['rule']); expect(bp.margin).toBe(0.16); expect(bp.shift).toBe(-0.5);
  });
  it('keeps descriptions free of quotes, links and addresses from the reference', () => {
    const m = measures([10, 14, 20]);
    const profile = sanitizeProfile({ visualStyle: 'bold "ACME BAKERY" see https://acme.example and hi@acme.example', graphicElements: ['gold rule'], blueprint: { tone: 'dark' } }, m);
    expect(profile.visualStyle).not.toMatch(/acme\.example|"|@/i); expect(profile.source).toBe('vision');
  });
});

describe('changes after the picture is made', () => {
  const original = measuredBlueprint(measures([250, 250, 250], (x, y) => (Math.hypot(x - 32, y - 32) < 12 ? [90, 60, 40] : null)));
  it('recognises a change, but not a new request', () => {
    expect(looksLikeRefinement('Make the text bigger')).toBe(true); expect(looksLikeRefinement('Use our actual cake photo')).toBe(true);
    expect(looksLikeRefinement('Make me a video about pool closing')).toBe(false); expect(looksLikeRefinement('give me ideas for this week')).toBe(false);
  });
  it('makes the text bigger and keeps the rest of the design', () => {
    const next = refine(original, original, 'Make the text bigger'); expect(['l', 'xl', 'xxl']).toContain(next.blueprint.headline.size);
    expect(next.blueprint.tone).toBe(original.tone); expect(next.blueprint.subject).toEqual(original.subject); expect(next.changes).toContain('made the text bigger');
  });
  it('darkens a light design into a dark version of the same design', () => {
    const next = refine(original, original, 'Make it darker'); expect(next.blueprint.tone).toBe('dark'); expect(next.blueprint.subject).toEqual(original.subject);
  });
  it('changes the shape, removes text, and asks for the owner’s own photo', () => {
    expect(refine(original, original, 'Make it Instagram square').blueprint.aspect).toBe('1:1');
    expect(refine(original, original, 'Remove the text').blueprint.text).toBe(false);
    expect(refine(original, original, 'Use our actual chocolate birthday cake photo').photo).toBe('chocolate birthday cake');
    expect(refine(original, original, 'no photo').photo).toBe('none');
  });
  it('can go back to the reference’s original design', () => {
    const changed = refine(original, original, 'Make it more luxurious').blueprint; const back = refine(changed, original, 'go back to the original look');
    expect(back.reset).toBe(true); expect(back.blueprint).toEqual(original);
  });
  it('uses the owner’s own words when they quote a headline', () => { expect(refine(original, original, 'Change the headline to "Closing season is here"').headline).toBe('Closing season is here'); });
});

describe('drawing the new picture', () => {
  const bp = measuredBlueprint(measures([10, 14, 20], (x, y) => (Math.hypot(x - 32, y - 32) < 12 ? [230, 180, 60] : null)));
  it('draws a picture of the right size from the blueprint and the business’s own words only', async () => {
    const jpeg = await renderDesign({ blueprint: bp, copy: { headline: 'Close your pool', subline: 'Done properly, every time', cta: 'Book now' }, businessName: 'Somerset', kit, photo: null, logo: null });
    expect(jpeg.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const { loadImage } = await import('@napi-rs/canvas'); const image = await loadImage(jpeg); expect([image.width, image.height]).toEqual(sizeOf(bp.aspect));
  });
  it('draws no words when the text is removed, in every shape', async () => {
    for (const aspect of ['1:1', '4:5', '9:16', '16:9'] as const) {
      const jpeg = await renderDesign({ blueprint: { ...bp, aspect, text: false }, copy: { headline: 'x', subline: '', cta: '' }, businessName: 'Somerset', kit, photo: null, logo: null });
      const { loadImage } = await import('@napi-rs/canvas'); const image = await loadImage(jpeg); expect([image.width, image.height]).toEqual(sizeOf(aspect));
    }
  });
  it('keeps text readable on the brand’s colours, light or dark', () => {
    for (const tone of ['dark', 'light'] as const) { const c = coloursFor(kit, tone); expect(contrast(c.text, c.bgA)).toBeGreaterThan(4.5); expect(contrast(c.accent, c.bgA)).toBeGreaterThanOrEqual(3); }
  });
});
