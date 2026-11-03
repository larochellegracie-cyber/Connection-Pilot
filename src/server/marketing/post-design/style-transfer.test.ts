import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { cleanPostSpec, measuredPost, type PostSpec } from '../reference-image/style.js';
import { isGenericRequest, refineStyle, wantsBrandColours } from '../reference-image/create-post.js';
import { renderPost, type Pattern, type PostCopy } from './layouts.js';
import { lintPost } from './lint.js';
import { contrast } from './draw-utils.js';
import { paletteFromRoles, styleFromReference, type PostStyle } from './style.js';
import { PAIRINGS, type PostAspect } from './tokens.js';
import type { ColourRoles } from '../reference/colour.js';

const kit = { name: 'Somerset', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null };
const roles = (over: Partial<ColourRoles> = {}): ColourRoles => ({ background: '#FBCED9', floor: '#E9B7C4', glow: '#FFFFFF', hero: '#7A3B2E', accent: '#C2185B', text: '#1E1814', proportions: [], horizon: null, separated: false, warmth: 0.05, temperature: 'warm', ...over });
const base: PostSpec = measuredPost({ width: 1080, height: 1920, aspectRatio: '9:16', orientation: 'portrait', brightness: 0.7, contrast: 0.2, saturation: 0.3, palette: [], background: '#FBCED9', accent: '#C2185B', grid: [], subject: { x: 0.5, y: 0.6, spread: 0.2 }, placement: 'center', calmest: 'top', photographic: false, backgroundKind: 'solid' } as never, { aspect: '9:16', tone: 'light', background: { kind: 'solid', direction: 'vertical', vignette: false }, subject: { placement: 'center', scale: 0.6, shape: 'rounded', frame: 'none' }, headline: { position: 'top', align: 'center', size: 'xl', weight: 800, caps: false, spacing: 0 }, subline: true, cta: { style: 'pill', position: 'bottom' }, accents: [], logo: 'top_center', overlay: 0, margin: 0.08, text: true, shift: 0, mood: [] } as never);

const png = (w: number, h: number, paint: (x: CanvasRenderingContext2D) => void) => { const c = createCanvas(w, h); paint(c.getContext('2d') as never); return c.toBuffer('image/png'); };
const studio = () => png(900, 1100, (x) => { x.fillStyle = '#F7B6C8'; x.fillRect(0, 0, 900, 1100); x.fillStyle = '#5A3320'; x.beginPath(); x.roundRect(250, 300, 400, 560, 60); x.fill(); });
const cutout = () => png(900, 900, (x) => { x.fillStyle = '#5A3320'; x.beginPath(); x.roundRect(300, 300, 300, 400, 40); x.fill(); });
const busy = () => png(1200, 800, (x) => { for (let i = 0; i < 60; i += 1) { x.fillStyle = `hsl(${i * 6},60%,${30 + (i % 5) * 10}%)`; x.fillRect((i % 10) * 120, Math.floor(i / 10) * 133, 120, 133); } });

describe('reading a reference as a post', () => {
  it('decides the plain structures from where the photo and the words are, and keeps the meaningful ones', () => {
    const spec = (raw: Record<string, unknown>) => cleanPostSpec({ ...raw }, base);
    expect(spec({ photoArea: 'full', structure: 'centered_product' }).structure).toBe('photo_full_bleed_overlay'); expect(spec({ photoArea: 'left_half', structure: 'centered_product' })).toMatchObject({ structure: 'split', photo: { position: 'left', bleed: true } });
    expect(spec({ photoArea: 'right_half' }).photo.position).toBe('right'); expect(spec({ photoArea: 'bottom_half' }).structure).toBe('text_top_photo_bottom'); expect(spec({ photoArea: 'none' }).structure).toBe('type_only'); expect(spec({ photoArea: 'inset_center' }).structure).toBe('centered_product');
    expect(spec({ photoArea: 'full', structure: 'quote' }).structure).toBe('quote'); expect(spec({ structure: 'offer' }).structure).toBe('offer');
    expect(spec({ headlineAlign: 'left' }).align).toBe('left'); expect(spec({ headlineAlign: 'right' }).align).toBe('center'); expect(spec({ headlineAlign: 'diagonal' }).align).toBe(base.align);
  });
  it('turns anything unusable into a value the designer can draw', () => {
    const s = cleanPostSpec({ structure: 'spaceship', headlineFont: 'comic', elements: ['grain', 'laser', 'rule', 'rule'], photo: { shape: 'blob' }, button: 'giant' }, base);
    expect(s.structure).toBe(base.structure); expect(s.headlineFont).toBe(base.headlineFont); expect(s.elements).toEqual(['grain', 'rule']); expect(s.photo.shape).toBe(base.photo.shape); expect(s.button).toBe(base.button);
    expect(cleanPostSpec(undefined, base)).toEqual(base); expect(cleanPostSpec('nonsense', base)).toEqual(base);
  });
});

describe('style from a reference', () => {
  it('uses the reference\'s page and ink so words stay clear, an accent that stands out, and the brand\'s own colours when asked', () => {
    const p = paletteFromRoles(roles(), kit)!; const mid = p.bgTop; expect(contrast(p.text, p.bgTop)).toBeGreaterThanOrEqual(4.5); expect(contrast(p.muted, p.bgBottom)).toBeGreaterThanOrEqual(4.5); expect(contrast(p.accent, mid)).toBeGreaterThanOrEqual(3); expect(paletteFromRoles(roles(), kit, 'brand')).toBeNull();
    const white = paletteFromRoles(roles({ text: '#FFFFFF' }), kit)!; expect(contrast(white.text, white.bgTop)).toBeGreaterThanOrEqual(4.5); // the reference's pale text on a pale page is made readable
    const dark = paletteFromRoles(roles({ background: '#101820', text: '#F5F5F5', accent: '#FFB300' }), kit)!; expect(dark.text).toBe('#F5F5F5'); expect(contrast(dark.accent, dark.bgTop)).toBeGreaterThanOrEqual(3);
    expect(wantsBrandColours('make it in our brand colours')).toBe(true); expect(wantsBrandColours('make a post like this')).toBe(false);
  });
  it('maps the reference\'s type, structure, spacing and logo place to the designer\'s', () => {
    const st = (over: Partial<PostSpec>) => styleFromReference({ spec: { ...base, ...over }, roles: roles(), kit, tone: 'light' });
    expect(st({ headlineFont: 'script_brush' }).pairing.id).toBe('friendly-script'); expect(st({ headlineFont: 'serif_high_contrast' }).pairing.id).toBe('elegant-serif'); expect(st({ headlineFont: 'sans_condensed' }).pairing.id).toBe('bold-condensed'); expect(st({ headlineFont: 'sans_light' }).pairing.id).toBe('clean-medium');
    expect(st({ headlineFont: 'slab' }).pairing.display).toBe('Alfa Slab One'); expect(st({ headlineFont: 'marker' }).pairing.display).toBe('Permanent Marker'); expect(st({ headlineFont: 'typewriter' }).pairing.display).toBe('Special Elite'); expect(st({ headlineFont: 'rounded' }).pairing.display).toBe('Fredoka'); expect(st({ headlineFont: 'script_formal' }).pairing.display).toBe('Dancing Script'); expect(st({ headlineFont: 'sans_condensed_caps' }).pairing.display).toBe('Bebas Neue');
    expect(st({ tracking: 'wide' }).type?.tracking).toBeGreaterThan(0); expect(st({ headlineEffect: 'highlight' }).type?.highlight).toBe(true); expect(st({ headlineEffect: 'underline' }).type?.underline).toBe(true);
    expect(st({ headlineCase: 'upper' }).caps).toBe(true); expect(st({ spacing: 'airy' }).air).toBeGreaterThan(1); expect(st({ spacing: 'tight' }).air).toBe(1); // generous space even when the reference is tight expect(st({ structure: 'photo_full_bleed_overlay' }).pattern).toBe('overlay'); expect(st({ structure: 'split' }).pattern).toBe('split'); expect(st({ elements: ['logo_top'] }).logo).toBe('top'); expect(st({ elements: ['logo_top', 'logo_bottom'] }).logo).toBe('bottom');
    expect(st({}).summary).toMatch(/centered product/); for (const p of PAIRINGS) expect(['Inter', 'DM Sans', 'Lora', 'Montserrat', 'Poppins']).toContain(p.body);
  });
  it('treats "make me a post like this for Somerset" as a request about the business, not about a thing to show', () => {
    expect(isGenericRequest('Make me a post like this for Somerset.', 'Somerset Pool service')).toBe(true); expect(isGenericRequest('Make me something like this for our business', 'Somerset')).toBe(true); expect(isGenericRequest('Make me a post like this for our chocolate cake', 'Somerset')).toBe(false); expect(isGenericRequest('like this but about winter pool closing', 'Somerset')).toBe(false);
  });
});

describe('changing a styled post', () => {
  const style = styleFromReference({ spec: base, roles: roles(), kit, tone: 'light' });
  it('follows plain-words changes and keeps the reference\'s structure', () => {
    const r = (m: string) => refineStyle(style, style, m, kit); expect(r('use our brand colours').style.palette).toBeNull(); expect(r('make it darker').style.palette!.bgTop < style.palette!.bgTop).toBe(true); expect(r('make the text bigger').style.headlineScale).toBeGreaterThan(style.headlineScale);
    expect(r('make it more luxurious').style.pairing.id).toBe('elegant-serif'); expect(r('make it bold').style.caps).toBe(true); expect(r('keep it minimal').style.elements.filter((e) => !e.startsWith('logo'))).toEqual([]); expect(r('make it a story').aspect).toBe('9:16');
    expect(r('hello there').understood).toBe(false); expect(r('make it darker').style.pattern).toBe(style.pattern);
    expect(refineStyle(r('make it darker').style, style, 'go back to the original look', kit).style.palette).toEqual(style.palette);
  });
});

describe('every style draws a clean post', () => {
  const copy: PostCopy = { eyebrow: 'Somerset Pool Service', headline: 'Limited spring openings available now', subline: 'Free quotes for weekly care and pool openings', cta: 'Get a quote', callouts: ['Weekly care', 'Pool openings'], items: [] };
  const variants: Array<Partial<PostSpec> & { name: string }> = [
    { name: 'script centred', headlineFont: 'script_brush', align: 'center', button: 'pill', photo: { shape: 'rounded', bleed: false, frame: 'offset', position: 'center' }, elements: ['rule', 'pill_label'] },
    { name: 'serif left', headlineFont: 'serif_high_contrast', align: 'left', button: 'text', photo: { shape: 'arch', bleed: false, frame: 'shadow', position: 'center' }, elements: ['keyline_frame', 'soft_shapes'] },
    { name: 'condensed caps', headlineFont: 'sans_condensed_caps', headlineCase: 'upper', align: 'center', button: 'bar', photo: { shape: 'circle', bleed: false, frame: 'border', position: 'center' }, elements: ['grain', 'logo_top'] },
    { name: 'bold bleed', headlineFont: 'sans_heavy', align: 'left', button: 'pill', photo: { shape: 'rect', bleed: true, frame: 'none', position: 'center' }, elements: ['handwritten_note'], spacing: 'tight' },
    { name: 'light airy', headlineFont: 'sans_light', align: 'center', button: 'none', photo: { shape: 'rounded', bleed: false, frame: 'none', position: 'center' }, elements: [], spacing: 'airy', headlineSize: 'xl' },
  ];
  it('keeps text clear, in its margins, and off the product, for every pattern the styles can reach, every shape and photo type', async () => {
    const bad: string[] = [];
    for (const v of variants) for (const pattern of ['product_focus', 'announcement', 'overlay', 'split'] as Pattern[]) for (const aspect of ['1:1', '4:5', '9:16'] as PostAspect[]) for (const [pname, hero] of [['studio', studio()], ['cutout', cutout()], ['busy', busy()]] as const) {
      const spec: PostSpec = { ...base, ...v, structure: pattern === 'overlay' ? 'photo_full_bleed_overlay' : pattern === 'split' ? 'split' : base.structure, photo: pattern === 'split' ? { ...(v.photo ?? base.photo), position: 'left', bleed: true, shape: 'rect' } : v.photo ?? base.photo };
      const style: PostStyle = { ...styleFromReference({ spec, roles: roles(), kit, tone: 'light' }), pattern };
      try { const r = await renderPost({ pattern, aspect, kit, pairing: style.pairing, copy, hero, logo: null, businessName: 'Somerset', style }); const issues = lintPost(r); if (issues.length) bad.push(`${v.name} ${pattern} ${aspect} ${pname}: ${issues[0]}`); } catch (e) { bad.push(`${v.name} ${pattern} ${aspect} ${pname}: THREW ${(e as Error).message}`); }
    }
    expect(bad).toEqual([]);
  }, 1_800_000);
  it('falls back to a type-led card in the same style when a layout needs a photo and there is none', async () => {
    const style: PostStyle = { ...styleFromReference({ spec: { ...base, structure: 'photo_full_bleed_overlay' }, roles: roles(), kit, tone: 'light' }) };
    const r = await renderPost({ pattern: 'overlay', aspect: '4:5', kit, pairing: style.pairing, copy, hero: null, logo: null, businessName: 'Somerset', style }); expect(r.pattern).toBe('announcement'); expect(r.notes.join(' ')).toMatch(/needs a photo/); expect(lintPost(r)).toEqual([]);
  });
});
