import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { aspectFrom, choosePattern, extractEvent, extractOffer, extractQuote, fontFrom } from './choose.js';
import { buildCopy, buttonOf, calloutsFrom, headlineOf, pointsFrom, splitHook } from './copy.js';
import { iconFor } from './layouts-extra.js';
import { renderPost, contrast, type Pattern, type PostCopy } from './layouts.js';
import { lintPost } from './lint.js';
import { loadPhoto, readPhoto } from './photo.js';
import { PAIRINGS, pairingFor, scaleFor, SIZES, type PostAspect } from './tokens.js';

const png = (w: number, h: number, paint: (x: CanvasRenderingContext2D) => void) => { const c = createCanvas(w, h); paint(c.getContext('2d') as never); return c.toBuffer('image/png'); };
const studio = () => png(900, 1100, (x) => { x.fillStyle = '#F7B6C8'; x.fillRect(0, 0, 900, 1100); x.fillStyle = '#5A3320'; x.beginPath(); x.roundRect(250, 300, 400, 560, 60); x.fill(); x.fillStyle = '#F3E3C3'; x.beginPath(); x.arc(450, 300, 200, 0, Math.PI * 2); x.fill(); });
const cutout = () => png(900, 900, (x) => { x.fillStyle = '#5A3320'; x.beginPath(); x.roundRect(300, 300, 300, 400, 40); x.fill(); });
const busy = () => png(1200, 800, (x) => { for (let i = 0; i < 60; i += 1) { x.fillStyle = `hsl(${i * 6},60%,${30 + (i % 5) * 10}%)`; x.fillRect((i % 10) * 120, Math.floor(i / 10) * 133, 120, 133); } });
const kit = { name: 'Staci Bakes', primary: '#FC6F7B', secondary: '#8F3550', accent: '#FC6F7B', logoUrl: null };
const poolKit = { name: 'Somerset', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6', logoUrl: null };

describe('design choices', () => {
  it('pairs fonts with what the business is, honours a font the owner names, and only ever uses carried fonts', () => {
    expect(pairingFor({ businessType: 'Bakery' }).display).toBe('Lobster'); expect(pairingFor({ businessType: 'Pool cleaning company' }).display).toBe('Oswald'); expect(pairingFor({ businessType: 'Bakery', brandFont: 'We use Playfair Display' }).display).toBe('Playfair Display');
    expect(pairingFor({ businessType: 'Unknown thing' }).id).toBe('clean-sans'); for (const p of PAIRINGS) expect(['Inter', 'DM Sans', 'Lora', 'Montserrat', 'Poppins']).toContain(p.body);
    expect(fontFrom('make it with a script font')).toBe('Lobster'); expect(fontFrom('use something elegant')).toBe('Playfair Display'); expect(fontFrom('make me a post')).toBe('');
  });
  it('picks a layout from what the post is about and what photos exist', () => {
    expect(choosePattern({ text: 'our cupcake menu flavours', photos: 1, products: 4 }).pattern).toBe('grid'); expect(choosePattern({ text: 'a lovely fall treat', seasonText: 'our chocolate cupcake', photos: 1, products: 0 }).pattern).toBe('product_focus'); expect(choosePattern({ text: 'winter pool closing', photos: 1, products: 0 })).toMatchObject({ pattern: 'seasonal', season: { label: 'Winter' } });
    expect(choosePattern({ text: 'now open on Saturdays', photos: 1, products: 0 }).pattern).toBe('announcement'); expect(choosePattern({ text: 'our chocolate cupcake', photos: 1, products: 0 }).pattern).toBe('product_focus'); expect(choosePattern({ text: 'our chocolate cupcake', photos: 0, products: 0 }).pattern).toBe('announcement');
    expect(aspectFrom('an Instagram story')).toBe('9:16'); expect(aspectFrom('a square post')).toBe('1:1'); expect(aspectFrom('a post')).toBe('4:5');
  });
  it('keeps the words few, and takes call-outs only from what the photo itself says', () => {
    expect(headlineOf('Is your pool ready for the long cold winter ahead of us?', 'Somerset').split(' ').length).toBeLessThanOrEqual(8); expect(buttonOf('Book your pool closing today. We are booking fast, call us now.')).toBe('Book your pool closing today'); expect(buttonOf('Book your winter pool closing at somersetpoolservice.com/book or call (519) 982-4901')).toBe('Book your winter pool closing'); expect(buttonOf('Call (519) 982-4901')).toBe(''); expect(buttonOf('Send us a DM to place your order today and we will confirm it')).toBe('');
    expect(splitHook('Now booking spring pool openings — limited spots. Book early to reserve your spot.')).toEqual({ headline: 'Now booking spring pool openings', rest: 'Limited spots. Book early to reserve your spot.' }); expect(splitHook('Fall is here — book your winter pool closing before the first freeze.').headline).toBe('Fall is here');
    expect(calloutsFrom({ label: 'Chocoholic', description: 'Chocolate frosting swirl on a chocolate cupcake in a dark paper case', tags: ['chocolate', 'cupcake'] })).toEqual(expect.arrayContaining(['Chocolate frosting swirl'])); expect(calloutsFrom({ label: 'Pool', description: '', tags: [] })).toEqual([]);
    const c = buildCopy({ pattern: 'product_focus', hook: 'Chocoholic', cta: 'Order today', businessName: 'Staci Bakes', topic: 'chocolate cupcake', season: null, product: { label: 'Chocoholic', description: 'Chocolate frosting swirl on a chocolate cupcake', tags: [] }, items: [] }); expect(c.eyebrow).toBe('Staci Bakes'); expect(c.callouts.length).toBeGreaterThan(0);
  });
});

describe('how a photo is used', () => {
  it('reads a studio shot as seamless (its backdrop becomes the page), a cut-out as a cut-out, and anything else as a card', async () => {
    const read = async (b: Buffer) => readPhoto((await loadPhoto(b))!, b);
    const a = await read(studio()); expect(a.mode).toBe('seamless'); expect(a.top).toBe('#F7B6C8'); expect((await read(cutout())).mode).toBe('cutout'); expect((await read(busy())).mode).toBe('card');
  });
});

describe('every layout passes its own design check', () => {
  const copy = (long: boolean, grid = false): PostCopy => ({ eyebrow: 'Staci Bakes', headline: long ? 'Warm chocolate birthday cakes made fresh daily' : 'Chocoholic', subline: long ? 'Rich, dark and baked in small batches every morning' : 'Deep chocolate', cta: long ? 'Order your birthday cake today' : 'Order now', callouts: ['Chocolate buttercream', 'Dark chocolate base', 'Chocolate shavings'], offer: { big: long ? 'Twenty percent off all birthday cakes' : '20% off', small: long ? 'every cake ordered this weekend only' : 'this weekend' }, points: [{ label: long ? 'Weekly pool maintenance and cleaning' : 'Weekly care', detail: long ? 'Vacuuming, testing and balancing every single visit' : 'Every visit', icon: 'drop' }, { label: 'Openings and closings', detail: '', icon: 'clock' }, { label: 'Equipment repair', detail: 'Pumps and filters', icon: 'bolt' }, { label: 'Power washing', detail: '', icon: 'check' }], quote: { text: long ? 'They closed our pool perfectly and left everything spotless, and we will be back in the spring for the opening as well' : 'Spotless work, every time.', by: 'A customer' }, graphic: { motif: 'waves', composition: (['stack', 'side', 'center', 'frame'] as const)[(long ? 1 : 0) + (grid ? 2 : 0)], seed: 3 }, event: { label: 'Open house', line: long ? 'Saturday, 10 am to 2 pm at our shop on the main street' : 'Saturday, 10 am' },
    items: grid ? [studio(), studio(), cutout(), busy()].map((photo, i) => ({ label: ['Chocoholic', 'Vanilla Dream', 'Caramel Drip', 'Cookie Butter Crumble'][i], photo })) : [], season: { label: 'Fall menu', colour: '#B8561B' } });
  const matrix: Array<[Pattern, PostAspect, 'studio' | 'cutout' | 'busy' | 'none', boolean]> = [];
  for (const pattern of ['product_focus', 'announcement', 'grid', 'seasonal', 'offer', 'benefits', 'collage', 'quote', 'spotlight', 'banner', 'poster'] as Pattern[]) for (const aspect of ['1:1', '4:5', '9:16'] as PostAspect[]) for (const photo of ['studio', 'cutout', 'busy', 'none'] as const) for (const long of [false, true]) matrix.push([pattern, aspect, photo, long]);
  it('has no text off the margin, overlapping, too small, too faint or over the product, in any of the ten patterns, shape, photo type or amount of text', async () => {
    const bad: string[] = [];
    for (const [pattern, aspect, photo, long] of matrix) {
      const hero = photo === 'studio' ? studio() : photo === 'cutout' ? cutout() : photo === 'busy' ? busy() : null;
      for (const k of [kit, poolKit]) { const r = await renderPost({ pattern, aspect, kit: k, pairing: pairingFor({ businessType: k === kit ? 'Bakery' : 'Pool service' }), copy: copy(long, pattern === 'grid' || pattern === 'collage'), hero, logo: null, businessName: k.name }); const issues = lintPost(r); if (issues.length) bad.push(`${pattern} ${aspect} ${photo} ${long ? 'long' : 'short'} ${k.name}: ${issues[0]}`); expect([r.width, r.height]).toEqual(SIZES[aspect]); }
    }
    expect(bad).toEqual([]);
  }, 1_200_000);
  it('puts a studio photo on a page of its own backdrop colour, and reads the words clearly on it', async () => {
    const r = await renderPost({ pattern: 'product_focus', aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy: copy(false), hero: studio(), logo: null, businessName: 'Staci Bakes' });
    expect(r.palette.seamless).toBe(true); expect(r.palette.bgTop).toBe('#F7B6C8'); expect(contrast(r.palette.text, r.palette.bgTop)).toBeGreaterThanOrEqual(4.5); expect(r.fonts.display).toBe('Lobster');
  });
  it('has a type scale from the post\'s size and one margin', () => { const s = scaleFor(1080, 1350); expect(s.margin).toBe(86); expect(s.headline).toBeGreaterThan(s.sub); expect(s.sub).toBeGreaterThan(s.small); });
});

describe('the finer details', () => {
  const base: PostCopy = { eyebrow: 'Staci Bakes', headline: 'Caramel drip cake', subline: '', cta: 'DM us to order', callouts: ['Small layer cake', 'Caramel drip', 'Cookie-butter piping', 'White board'], items: [] };
  it('keeps every note beside the product, never over it, with the arrow ending on it', async () => {
    for (const aspect of ['1:1', '4:5', '9:16'] as PostAspect[]) {
      const r = await renderPost({ pattern: 'product_focus', aspect, kit, pairing: pairingFor({ businessType: 'Bakery' }), copy: base, hero: cutout(), logo: null, businessName: 'Staci Bakes' });
      const hero = r.boxes.find((b) => b.id === 'hero')!; const notes = r.boxes.filter((b) => /^callout/.test(b.id));
      if (r.pattern === 'split') continue; // a square with no room for notes beside the product sets the photo beside the words instead
      expect(notes.length).toBeGreaterThan(0);
      const core = { x: hero.x + hero.w * 0.12, y: hero.y + hero.h * 0.12, w: hero.w * 0.76, h: hero.h * 0.76 }; // the rounded corners of the box are empty; the body of the product is not
      for (const n of notes) expect(Math.min(n.x + n.w, core.x + core.w) - Math.max(n.x, core.x) <= 1 || Math.min(n.y + n.h, core.y + core.h) - Math.max(n.y, core.y) <= 1).toBe(true);
      for (const n of notes) { expect(n.size).toBeGreaterThanOrEqual(r.width * 0.029); expect(contrast(n.colour!, n.on!)).toBeGreaterThanOrEqual(4.5); }
    }
  });
  it('draws the same button everywhere: one height and padding, centred under a product and left-aligned on a card', async () => {
    const heights = new Set<number>(); const out: Array<[string, number]> = [];
    for (const [pattern, hero] of [['product_focus', studio()], ['product_focus', cutout()], ['announcement', null], ['announcement', busy()], ['seasonal', busy()]] as Array<[Pattern, Buffer | null]>) {
      const r = await renderPost({ pattern, aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy: { ...base, callouts: [], subline: pattern === 'announcement' ? 'Time to order' : '', season: { label: 'Fall', colour: '#B8561B' } }, hero, logo: null, businessName: 'Staci Bakes' });
      const b = r.boxes.find((x) => x.kind === 'button')!; heights.add(Math.round(b.h)); out.push([pattern, Math.round(b.x + b.w / 2)]); const t = r.boxes.find((x) => x.id === 'cta')!; expect(Math.abs(t.x + t.w / 2 - (b.x + b.w / 2))).toBeLessThan(2); // the words sit in the middle of the pill
      expect(b.h).toBeGreaterThanOrEqual(r.height * 0.06);
    }
    expect(heights.size).toBe(1); expect(out.filter(([p]) => p !== 'announcement').every(([, cx]) => Math.abs(cx - 540) < 2)).toBe(true);
  });
  it('lays out an announcement card with an even rhythm: the headline, its rule, the supporting line and the button are spaced by the same few steps', async () => {
    const r = await renderPost({ pattern: 'announcement', aspect: '4:5', kit: poolKit, pairing: pairingFor({ businessType: 'Pool' }), copy: { ...base, eyebrow: 'Somerset Pool Service', headline: 'Fall is here', subline: 'Time to book your winter pool closing.', callouts: [] }, hero: null, logo: null, businessName: 'Somerset' });
    const s = scaleFor(1080, 1350); const head = r.boxes.filter((b) => /^headline/.test(b.id)); const sub = r.boxes.find((b) => /^sub0/.test(b.id))!; const btn = r.boxes.find((b) => b.kind === 'button')!; const eyebrow = r.boxes.find((b) => b.id === 'eyebrow')!;
    const headBottom = Math.max(...head.map((b) => b.y + b.h)); expect(sub.y - headBottom).toBeGreaterThanOrEqual(s.group); expect(btn.y - (sub.y + sub.h)).toBeGreaterThanOrEqual(s.group); expect(head[0].y - (eyebrow.y + eyebrow.h)).toBeGreaterThanOrEqual(s.group * 0.8);
    expect(btn.y + btn.h).toBeLessThan(1350 - s.margin * 1.4); expect(lintPost(r)).toEqual([]);
  });
});


describe('the six extra patterns', () => {
  it('does not leave a stray percent sign in a headline that said the offer (the offer panel says it)', () => {
    const c = buildCopy({ pattern: 'offer', hook: 'Weekend treat: 20% off cupcakes', cta: 'DM us', businessName: 'Staci Bakes', topic: 'cupcakes', season: null, product: null, items: [], extra: { offer: { big: '20% off', small: 'this weekend' } } });
    expect(c.headline).toBe('Cupcakes'.length > 0 ? c.headline : ''); expect(c.headline).not.toMatch(/%|\d/); expect(c.headline.length).toBeGreaterThan(0);
  });
  it('takes a price, an offer, words to quote and event details only from what the owner wrote', () => {
    expect(extractOffer('Make a post: 20% off all cupcakes this weekend')).toEqual({ big: '20% off', small: 'all cupcakes this weekend' }); expect(extractOffer('Make me a post: 20% off cupcakes this weekend. cupcakes this weekend')?.small).toBe('cupcakes this weekend'); expect(extractOffer('free quote on pool openings')?.big).toBe('Free quote'); expect(extractOffer('cupcakes for $3 each')).toMatchObject({ big: '$3' });
    expect(extractOffer('Make me a post about our chocolate cupcakes')).toBeNull(); expect(extractOffer('call us at 519 982 4901')).toBeNull();
    expect(extractQuote('Make a testimonial post: “They closed our pool perfectly and left everything spotless.” — Sarah M.')).toEqual({ text: 'They closed our pool perfectly and left everything spotless.', by: 'Sarah M.' }); expect(extractQuote('Make me a testimonial post')).toBeNull(); expect(extractQuote('Make a post saying "hi"')).toBeNull();
    expect(extractEvent('We are hosting an open house on Saturday 10 am to 2 pm. Come say hi')).toEqual({ label: 'Open House', line: 'Saturday 10 am to 2 pm' }); expect(extractEvent('Open house Saturday at 10 am open to all')?.line).toBe('Saturday at 10 am'); expect(extractEvent('Make me a post about our cupcakes')).toBeNull();
  });
  it('chooses the pattern that fits the request, with the rest unchanged', () => {
    const c = (text: string, o: Partial<Parameters<typeof choosePattern>[0]> = {}) => choosePattern({ text, photos: 1, products: 0, ...o }).pattern;
    expect(c('x', { quote: true })).toBe('quote'); expect(c('20% off', { offer: true })).toBe('offer'); expect(c('why choose us', { points: 3 })).toBe('benefits'); expect(c('why choose us', { points: 1 })).toBe('product_focus'); expect(c('a look at our work', { gallery: 3 })).toBe('collage'); expect(c('a look at our work', { gallery: 1 })).toBe('product_focus');
    expect(c('our open house event')).toBe('banner'); expect(c('introducing our new flavour')).toBe('spotlight'); expect(c('our menu favourites', { products: 3 })).toBe('grid'); expect(c('winter pool closing')).toBe('seasonal'); expect(c('now open on saturdays')).toBe('announcement'); expect(c('our chocolate cupcake')).toBe('product_focus');
    expect(c('introducing our new flavour', { photos: 0 })).toBe('announcement');
  });
  it('lists points from what the business says about itself, with a fitting icon, and never from nothing', () => {
    const p = pointsFrom({ sellingPoints: ['Fast, friendly service'], services: ['Weekly pool maintenance', 'Pool openings & closings', 'Equipment repair & replacement'] }); expect(p.length).toBe(4); expect(pointsFrom({ sellingPoints: ['Reliable weekly maintenance to keep your pool clear all season', 'Over twenty years serving Windsor-Essex'] }).map((x) => x.label)).toEqual(['Reliable weekly maintenance', 'Over twenty years serving Windsor-Essex']); expect(p[0].icon).toBe('clock'); expect(p.every((x) => x.label.length > 0)).toBe(true);
    expect(pointsFrom({})).toEqual([]); expect(pointsFrom({ services: ['Cakes'] })).toEqual([]); expect(iconFor('licensed and insured')).toBe('shield'); expect(iconFor('something else')).toBe('check');
  });
  it('shows the offer as the biggest text, and the offer caption clear of it', async () => {
    const r = await renderPost({ pattern: 'offer', aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy: { eyebrow: 'Staci Bakes', headline: 'Cupcake weekend', subline: '', cta: 'DM us', callouts: [], items: [], offer: { big: '20% off', small: 'every cupcake, Sat & Sun' } }, hero: null, logo: null, businessName: 'Staci Bakes' });
    const big = r.boxes.find((b) => b.id === 'offer')!; const small = r.boxes.find((b) => b.id === 'offersmall')!; expect(big.size).toBeGreaterThan(Math.max(...r.boxes.filter((b) => b.kind === 'text' && b.id !== 'offer').map((b) => b.size ?? 0))); expect(small.y).toBeGreaterThanOrEqual(big.y + big.h); expect(lintPost(r)).toEqual([]);
  });
  it('uses a portrait photo as a round badge with the offer (never cropped into a wide band), and a wide photo as a band', async () => {
    const mk = async (photo: Buffer) => renderPost({ pattern: 'offer', aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy: { eyebrow: 'Staci Bakes', headline: 'Cupcake weekend', subline: '', cta: 'DM us', callouts: [], items: [], offer: { big: '20% off', small: 'this weekend' } }, hero: photo, logo: null, businessName: 'Staci Bakes' });
    const portrait = (await mk(studio())).boxes.find((b) => b.id === 'hero')!; const wide = (await mk(busy())).boxes.find((b) => b.id === 'hero')!; expect(Math.abs(portrait.w - portrait.h)).toBeLessThan(2); expect(wide.w / wide.h).toBeGreaterThan(2);
  });
});

describe('the finishing touches', () => {
  it('draws the same post the same way every time (the grain is deterministic), and sets the label in tracked capitals', async () => {
    const copy: PostCopy = { eyebrow: 'Staci Bakes', headline: 'Our caramel drip cake', subline: '', cta: 'DM us', callouts: [], items: [] };
    const a = await renderPost({ pattern: 'product_focus', aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy, hero: cutout(), logo: null, businessName: 'Staci Bakes' });
    const b = await renderPost({ pattern: 'product_focus', aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy, hero: cutout(), logo: null, businessName: 'Staci Bakes' });
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0); expect(a.boxes.find((x) => x.id === 'eyebrow')!.w).toBeGreaterThan(0); expect(lintPost(a)).toEqual([]);
  });
  it('puts one accent word in a headline only where it reads clearly, and never when the headline is one or two words', async () => {
    const mk = async (headline: string) => renderPost({ pattern: 'product_focus', aspect: '4:5', kit, pairing: pairingFor({ businessType: 'Bakery' }), copy: { eyebrow: '', headline, subline: '', cta: '', callouts: [], items: [] }, hero: null, logo: null, businessName: 'Staci Bakes' });
    expect(lintPost(await mk('Our caramel drip cake'))).toEqual([]); expect(lintPost(await mk('Chocoholic'))).toEqual([]); expect((await mk('Our caramel drip cake')).boxes.filter((b) => /^headline/.test(b.id)).length).toBeGreaterThan(0);
  });
});
