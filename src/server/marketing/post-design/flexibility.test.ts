import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { GRAPHIC_ASK, choosePattern } from './choose.js';
import { FONT_LIBRARY, registerLibrary, requestedFamily, requestedPairingId } from './fonts.js';
import { drawMotif, inkFrom, motifFor, MOTIFS } from './graphics.js';
import { renderPost, contrast, type Pattern, type PostCopy, type TypeTreatment } from './layouts.js';
import { lintPost } from './lint.js';
import { moodFrom, moodStyle, type Mood } from './moods.js';
import { PAIRINGS, pairingFor, hasFont, ensureDesignFonts, type PostAspect } from './tokens.js';
import type { PostStyle } from './style.js';

const kit = { name: 'Somerset', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null };
const copy: PostCopy = { eyebrow: 'Somerset Pool Service', headline: 'Pool opening season is here', subline: 'Book early and reserve your spot.', cta: 'Book your opening', callouts: [], items: [] };

describe('the type library', () => {
  it('carries many families in every voice, each of which really draws', async () => {
    await ensureDesignFonts(); await registerLibrary(); expect(FONT_LIBRARY.length).toBeGreaterThanOrEqual(20);
    for (const f of FONT_LIBRARY) expect(await hasFont(f.family), f.family).toBe(true);
    expect(new Set(PAIRINGS.map((p) => p.display)).size).toBeGreaterThanOrEqual(18);
  });
  it('picks a face from the owner\'s words: a style, or a family by name, ahead of what the business is', () => {
    expect(pairingFor({ businessType: 'Pool service', request: 'make it retro' }).display).toBe('Alfa Slab One'); expect(pairingFor({ businessType: 'Pool service', request: 'something handwritten' }).display).toBe('Caveat'); expect(pairingFor({ businessType: 'Bakery', request: 'use Montserrat' }).display).toBe('Montserrat');
    expect(pairingFor({ businessType: 'Pool service', request: 'big poster style' }).display).toBe('Bebas Neue'); expect(pairingFor({ businessType: 'Bakery', request: 'typewriter look' }).display).toBe('Special Elite'); expect(pairingFor({ businessType: 'Pool service', request: 'make me a post' }).display).toBe('Oswald');
    expect(requestedFamily('in Pacifico please')).toBe('Pacifico'); expect(requestedPairingId('hello')).toBeNull();
  });
});

describe('moods', () => {
  it('reads a feeling from the owner\'s words and makes colours from the brand that read clearly in every one', () => {
    expect(moodFrom('make it retro')).toBe('retro'); expect(moodFrom('something elegant')).toBe('luxury'); expect(moodFrom('a bold poster')).toBe('bold'); expect(moodFrom('make me a post')).toBeNull();
    for (const m of ['retro', 'modern', 'luxury', 'playful', 'minimal', 'bold', 'natural', 'handmade'] as Mood[]) { const s = moodStyle(m, kit, 'product_focus'); const p = s.palette!; const worst = (c: string) => Math.min(contrast(c, p.bgTop), contrast(c, p.bgBottom)); expect(worst(p.text), m).toBeGreaterThanOrEqual(4.5); expect(worst(p.muted), m).toBeGreaterThanOrEqual(4.5); expect(contrast(p.accent, p.bgTop), m).toBeGreaterThanOrEqual(2.9); expect(s.pairing.display.length).toBeGreaterThan(0); }
    expect(new Set(['retro', 'modern', 'luxury', 'playful', 'minimal', 'bold'].map((m) => moodStyle(m as Mood, kit, 'product_focus').pairing.id)).size).toBe(6);
  });
});

describe('the graphic engine', () => {
  it('draws every motif, and picks one that suits what the post is about', () => {
    expect(motifFor('pool opening season')).toBe('waves'); expect(motifFor('winter closing')).toBe('snow'); expect(motifFor('spring garden')).toBe('leaf'); expect(motifFor('our home repairs')).toBe('house'); expect(motifFor('grand opening sale')).toBe('burst'); expect(motifFor('hello')).toBeNull();
    const ink = inkFrom({ accent: '#E1611A', text: '#1B1B1F', bgTop: '#FFF4EA', bgBottom: '#FDE6D4' });
    for (const m of MOTIFS) { const c = createCanvas(300, 300); const x = c.getContext('2d'); x.fillStyle = '#FFF4EA'; x.fillRect(0, 0, 300, 300); drawMotif(x as never, m, 150, 150, 240, ink, 3); const d = x.getImageData(0, 0, 300, 300).data; let painted = 0; for (let i = 0; i < d.length; i += 4 * 7) if (Math.abs(d[i] - 255) + Math.abs(d[i + 1] - 244) + Math.abs(d[i + 2] - 234) > 24) painted += 1; expect(painted, m).toBeGreaterThan(40); }
  });
  it('makes a poster when there is no photo and the subject has a motif, or when a graphic is asked for', () => {
    expect(choosePattern({ text: 'pool opening season', photos: 0, products: 0, motif: true }).pattern).toBe('poster'); expect(choosePattern({ text: 'our chocolate cupcake', photos: 0, products: 0 }).pattern).toBe('announcement'); expect(choosePattern({ text: 'a graphic post', photos: 1, products: 0, graphic: true }).pattern).toBe('poster'); expect(choosePattern({ text: 'a poster', photos: 1, products: 0, graphic: true, offer: true }).pattern).toBe('offer');
    expect(GRAPHIC_ASK.test('make me a typographic poster, no photo')).toBe(true); expect(GRAPHIC_ASK.test('make me a post about cupcakes')).toBe(false);
  });
});

describe('graphic posts and type treatments stay clean', () => {
  it('draws a clean poster in every composition, shape and a spread of motifs and faces, with no photo', async () => {
    const bad: string[] = []; const faces = ['bold-condensed', 'casual-script', 'luxe-light', 'retro-slab', 'handwritten', 'tech-grotesk'];
    let i = 0; for (const composition of ['stack', 'side', 'center', 'frame'] as const) for (const aspect of ['1:1', '4:5', '9:16'] as PostAspect[]) for (const motif of ['waves', 'snow', 'house', 'burst', 'blobs', 'check'] as const) for (const long of [false, true]) {
      const faceId = faces[i % faces.length]; i += 1; const pairing = PAIRINGS.find((p) => p.id === faceId)!; const c: PostCopy = { ...copy, headline: long ? 'Pool opening season is finally here for you' : 'Pool season', subline: long ? 'Book early and reserve your spot for the season ahead' : 'Book early', graphic: { motif, composition, seed: i } };
      try { const r = await renderPost({ pattern: 'poster', aspect, kit, pairing, copy: c, hero: null, logo: null, businessName: 'Somerset' }); const issues = lintPost(r); if (issues.length) bad.push(`${composition} ${aspect} ${motif} ${long ? 'long' : 'short'} ${pairing.id}: ${issues[0]}`); } catch (e) { bad.push(`${composition} ${aspect} ${motif}: THREW ${(e as Error).message}`); }
    }
    expect(bad).toEqual([]);
  }, 1_800_000);
  it('sets the headline with tracking, a marker highlight, an underline, a shadow, capitals and a looser line, without breaking the layout', async () => {
    const bad: string[] = []; const treatments: TypeTreatment[] = [{ tracking: 0.06, caps: true }, { highlight: true }, { underline: true }, { shadow: true, tracking: 0.02 }, { lineHeight: 1.15, tracking: -0.01 }];
    for (const type of treatments) for (const pattern of ['product_focus', 'announcement', 'poster'] as Pattern[]) for (const aspect of ['1:1', '4:5', '9:16'] as PostAspect[]) {
      const r = await renderPost({ pattern, aspect, kit, pairing: pairingFor({ businessType: 'Pool', request: 'bold' }), copy: { ...copy, graphic: { motif: 'waves', composition: 'stack', seed: 1 } }, hero: null, logo: null, businessName: 'Somerset', type }); const issues = lintPost(r); if (issues.length) bad.push(`${JSON.stringify(type)} ${pattern} ${aspect}: ${issues[0]}`);
    }
    expect(bad).toEqual([]);
  }, 900_000);
  it('draws a clean post in every mood, and draws the reference\'s shapes and badge without hiding the words', async () => {
    const bad: string[] = [];
    for (const mood of ['retro', 'modern', 'luxury', 'playful', 'minimal', 'bold', 'natural', 'handmade'] as Mood[]) for (const pattern of ['announcement', 'poster'] as Pattern[]) {
      const style: PostStyle = { ...moodStyle(mood, kit, pattern), pattern, shapes: mood === 'modern' ? [{ kind: 'ring', anchor: 'top_right', size: 'l', colour: 'accent' }, { kind: 'dots', anchor: 'bottom_left', size: 'm', colour: 'accent' }] : undefined, badge: mood === 'bold' ? { shape: 'burst', anchor: 'top_right' } : null };
      const r = await renderPost({ pattern, aspect: '4:5', kit, pairing: style.pairing, copy: { ...copy, offer: { big: '20% off', small: '' }, graphic: { motif: 'waves', composition: 'stack', seed: 2 } }, hero: null, logo: null, businessName: 'Somerset', style }); const issues = lintPost(r); if (issues.length) bad.push(`${mood} ${pattern}: ${issues[0]}`);
    }
    expect(bad).toEqual([]);
  }, 600_000);
});
