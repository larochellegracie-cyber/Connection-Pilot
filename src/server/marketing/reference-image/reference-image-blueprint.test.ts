import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { frameOf, logoPrintOf, measureImage, measureLighting } from './analyze.js';
import { buildImageBlueprint } from './blueprint.js';
import { checkOutput, protectCopy } from './create.js';
import { coloursWith, renderDesign } from './render.js';
import { measuredProfile, type ReferenceImageAnalysis } from './style.js';
import { colourRoles } from '../reference/colour.js';
import { warmBeigeOrTan } from '../reference/verify.js';

/** A reference picture drawn here: a warm beige wall over a brown floor, a dark cake shape, a headline, and a brand chip top-left. */
function referencePng(): Buffer {
  const W = 540; const H = 960; const c = createCanvas(W, H); const x = c.getContext('2d');
  const wall = x.createLinearGradient(0, 0, 0, H * 0.68); wall.addColorStop(0, '#CFC3B2'); wall.addColorStop(1, '#B3A391'); x.fillStyle = wall; x.fillRect(0, 0, W, H * 0.68);
  const floor = x.createLinearGradient(0, H * 0.68, 0, H); floor.addColorStop(0, '#5B4639'); floor.addColorStop(1, '#BCAE9F'); x.fillStyle = floor; x.fillRect(0, H * 0.68, W, H * 0.32);
  x.fillStyle = '#4F2C1B'; x.beginPath(); x.roundRect(120, 400, 300, 230, 24); x.fill();
  x.fillStyle = '#FFFFFF'; x.beginPath(); x.roundRect(40, 120, 90, 46, 12); x.fill(); x.fillStyle = '#C0451E'; x.font = 'bold 20px sans-serif'; x.fillText('Somerset', 46, 150);
  x.fillStyle = '#1A171E'; x.font = 'bold 44px sans-serif'; x.fillText('A glossy finish', 36, 230);
  return c.toBuffer('image/png');
}

const analysisFrom = async (): Promise<ReferenceImageAnalysis> => {
  const { measures, frame } = await measureImage(referencePng()); const style = { ...measuredProfile(measures), kind: 'product_ad' as const, logo: { present: true, position: 'top_left' as const }, referenceText: { brands: ['Somerset'], words: ['glossy'], slogans: ['A glossy finish'], phrases: [] } };
  return { id: 'r1', fileName: 'ref.png', createdAt: '', measures, style, logoPrint: logoPrintOf(frame, 'top_left') ?? undefined };
};
const kit = { name: 'Staci Bakes', primary: '#FC6F7B', secondary: '#8F3550', accent: '#FC6F7B', logoUrl: null };

describe('reference image analysis', () => {
  it('reads the colours by role, with the floor kept apart from the wall, and the light', async () => {
    const { measures } = await measureImage(referencePng()); const r = measures.roles!;
    expect(r.separated).toBe(true); expect(r.horizon).toBeGreaterThan(0.6); expect(r.horizon).toBeLessThan(0.76);
    expect(warmBeigeOrTan(r).warmBeigeOrTan).toBe(true); expect(measures.lighting!.direction).toBe('top');
  });
  it('tells hard, high-contrast light from soft, even light', () => {
    const side = 48; const even = new Uint8ClampedArray(side * side * 4).fill(200);
    const hard = new Uint8ClampedArray(side * side * 4); for (let i = 0; i < side * side; i += 1) { const dark = (i % side) > side / 2 ? 1 : 0; hard.set([dark ? 20 : 240, dark ? 20 : 240, dark ? 20 : 240, 255], i * 4); }
    const roles = colourRoles(even, side);
    expect(measureLighting(even, side, roles).shadows).toBe('none'); expect(measureLighting(hard, side, roles).shadows).toBe('strong');
    expect(measureLighting(hard, side, roles).direction).toBe('left');
  });
});

describe('the design blueprint', () => {
  it('carries the reference\'s palette, floor, light and rules, and lists its own text as forbidden except words the owner uses', async () => {
    const a = await analysisFrom(); const bp = buildImageBlueprint(a, 'Staci Bakes glossy chocolate cake');
    expect(bp.aspectRatio).toBe('9:16'); expect(bp.palette.light).toBe(true); expect(bp.background.horizon).not.toBeNull(); expect(bp.colourRoles!.floor).not.toBe(bp.colourRoles!.background);
    expect(bp.forbidden.brands).toContain('Somerset'); expect(bp.forbidden.slogans).toContain('A glossy finish'); expect(bp.forbidden.words).not.toContain('glossy'); // the owner said "glossy" themselves
  });
});

describe('reference text and logo protection', () => {
  it('removes the reference\'s brand and slogan from the words, and falls back to the business when nothing is left', async () => {
    const bp = buildImageBlueprint(await analysisFrom(), 'Staci Bakes cake');
    const r = protectCopy({ headline: 'Somerset: A glossy finish', subline: 'Fresh from Somerset ovens', cta: 'Order' }, 'cake', bp, 'Staci Bakes');
    expect(JSON.stringify(r.copy)).not.toMatch(/somerset|glossy finish/i); expect(r.removed.length).toBeGreaterThan(0); expect(r.copy.headline.length).toBeGreaterThan(0);
    expect(protectCopy({ headline: 'Somerset', subline: '', cta: '' }, 'Somerset', bp, 'Staci Bakes').copy.headline).toBe('Staci Bakes');
  });
  it('finds the reference\'s own logo if a picture reuses it, and finds nothing in a design drawn from the blueprint', async () => {
    const a = await analysisFrom(); const bp = buildImageBlueprint(a, 'Staci Bakes cake');
    expect((await checkOutput(referencePng(), { headline: 'x', subline: '', cta: '' }, a, bp)).logo.found).toBe(true);
    const made = await renderDesign({ blueprint: bp.layout_, copy: { headline: 'Chocolate cake', subline: 'Baked fresh', cta: 'Order' }, businessName: 'Staci Bakes', kit, photo: null, logo: null, palette: bp.palette });
    const checks = await checkOutput(made, { headline: 'Chocolate cake', subline: 'Baked fresh', cta: 'Order' }, a, bp);
    expect(checks.logo.checked).toBe(true); expect(checks.logo.found).toBe(false); expect(checks.referenceText).toEqual([]);
  });
});

describe('drawing from the blueprint', () => {
  it('uses the reference\'s warm beige and brown with the business\'s accent, a separate floor, and keeps the hue when asked for darker', async () => {
    const a = await analysisFrom(); const bp = buildImageBlueprint(a, 'x'); const roles = bp.colourRoles!;
    const photo = (() => { const c = createCanvas(400, 400); const x = c.getContext('2d'); x.fillStyle = '#7A4A2A'; x.fillRect(0, 0, 400, 400); return c.toBuffer('image/png'); })();
    const draw = async (layout = bp.layout_) => renderDesign({ blueprint: layout, copy: { headline: 'Chocolate cake', subline: 'Baked fresh', cta: 'Order' }, businessName: 'Staci Bakes', kit, photo, logo: null, palette: bp.palette, floor: { horizon: roles.horizon!, colour: roles.floor }, light: 'left' });
    const sample = async (bytes: Buffer) => { const f = await frameOf(bytes); const small = createCanvas(96, 96); const ctx = small.getContext('2d'); const src = createCanvas(f.width, f.height); src.getContext('2d').putImageData(new (await import('@napi-rs/canvas')).ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height), 0, 0); ctx.drawImage(src, 0, 0, 96, 96); return colourRoles(ctx.getImageData(0, 0, 96, 96).data, 96); };
    const light = await sample(await draw()); expect(warmBeigeOrTan(light).warmBeigeOrTan).toBe(true); expect(light.separated).toBe(true);
    const dark = await sample(await draw({ ...bp.layout_, tone: 'dark' })); const hue = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const m = Math.max(r, g, b); const d = m - Math.min(r, g, b); return d === 0 ? 0 : (m === r ? ((g - b) / d + 6) % 6 : m === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; };
    expect(Math.abs(hue(dark.background) - hue(light.background))).toBeLessThan(40); // still the warm brown, not the brand's plum
    expect(coloursWith(kit, { ...bp.layout_, tone: 'dark' }, bp.palette).bgA < coloursWith(kit, bp.layout_, bp.palette).bgA).toBe(true);
  });
});

describe('the drawn-product fallback', () => {
  it('draws only subjects that have a ready-made illustration, and says plainly that it is a drawing', async () => {
    const { drawableKind, drawProduct, DRAWN_NOTE } = await import('./drawn-product.js');
    expect(drawableKind('chocolate birthday cake')).toBe('cake'); expect(drawableKind('chocolate cupcakes')).toBe('cupcake'); expect(drawableKind('wood-fired pizza')).toBeNull();
    expect(DRAWN_NOTE('cake')).toMatch(/illustration.*less realistic.*photo/i);
    const png = await drawProduct({ kind: 'cake', tint: '#F6E7C8' }); expect(png).not.toBeNull();
    const { loadImage } = await import('@napi-rs/canvas'); const img = await loadImage(png!); expect(img.width).toBeLessThanOrEqual(1100); expect(img.height).toBeGreaterThan(300);
  }, 120_000);
  it('places the drawing on the design in the reference\'s colours, standing on its floor, and not on any photo', async () => {
    const { drawProduct } = await import('./drawn-product.js'); const a = await analysisFrom(); const bp = buildImageBlueprint(a, 'x'); const roles = bp.colourRoles!;
    const drawn = await drawProduct({ kind: 'cake' });
    const withDrawing = await renderDesign({ blueprint: bp.layout_, copy: { headline: 'Chocolate cake', subline: '', cta: '' }, businessName: 'Staci Bakes', kit, photo: null, logo: null, palette: bp.palette, floor: { horizon: roles.horizon!, colour: roles.floor }, drawn, lighting: bp.lighting });
    const without = await renderDesign({ blueprint: bp.layout_, copy: { headline: 'Chocolate cake', subline: '', cta: '' }, businessName: 'Staci Bakes', kit, photo: null, logo: null, palette: bp.palette, floor: { horizon: roles.horizon!, colour: roles.floor } });
    expect(Buffer.compare(withDrawing, without)).not.toBe(0);
    const f = await frameOf(withDrawing); const g = await frameOf(without); let changed = 0; let total = 0; // the drawing fills a good part of the middle of the picture
    for (let y = Math.round(f.height * 0.3); y < f.height * 0.8; y += 2) for (let x = Math.round(f.width * 0.15); x < f.width * 0.85; x += 2) { const i = (y * f.width + x) * 4; total += 1; if (Math.abs(f.rgba[i] - g.rgba[i]) + Math.abs(f.rgba[i + 1] - g.rgba[i + 1]) + Math.abs(f.rgba[i + 2] - g.rgba[i + 2]) > 60) changed += 1; }
    expect(changed / total).toBeGreaterThan(0.12);
    const checks = await checkOutput(withDrawing, { headline: 'Chocolate cake', subline: '', cta: '' }, a, bp); expect(checks.logo.found).toBe(false);
  }, 120_000);
});
