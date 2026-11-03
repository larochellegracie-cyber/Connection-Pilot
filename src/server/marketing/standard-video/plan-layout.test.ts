import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { drawFrame, mix } from './draw.js';
import { buildSpec, buttonLabel, paletteFor, type PlannedScene } from './plan-layout.js';
import { sizes, validateSpec } from './spec.js';

const kit = { name: 'Somerset Pool service', primary: '#0B3C7D', secondary: '#1E6FD9', accent: '#4FC3F7' } as never;
const scene = (role: PlannedScene['role'], headline: string, asset: string | null, extra: Partial<PlannedScene> = {}): PlannedScene => ({ role, seconds: 4, headline, subtext: 'A short detail', asset, photoStyle: 'full', layout: 'bottom', animation: 'slide-up', transition: 'zoom', ...extra });
const plan = (scenes: PlannedScene[]) => ({ size: '540x960' as const, durationSeconds: scenes.length * 4, scenes });
const five = [scene('hook', 'Closing your pool?', 'p1'), scene('detail', 'Seasonal closing', 'p1'), scene('detail', 'Trusted local team', 'p1'), scene('offer', 'Book before the first frost', null), scene('cta', 'Book your pool closing', 'p1')];

describe('richer free video layouts', () => {
  it('uses a photo with a zoom and pan on the hook, and a drifting photo card on the next photo scene', () => {
    const spec = buildSpec({ plan: plan(five), kit, logoId: null });
    const hook = spec.scenes[0].background;
    expect(hook.type === 'image' && hook.kenBurns?.panX && hook.kenBurns.to > 1.1).toBeTruthy();
    expect(spec.scenes[1].elements.some((el) => el.type === 'image' && el.drift)).toBe(true);
    expect(validateSpec(spec).ok).toBe(true);
  });

  it('falls back to designed brand layouts (shifting gradient, shapes, icons) when there is no photo', () => {
    const spec = buildSpec({ plan: plan(five.map((s) => ({ ...s, asset: null }))), kit, logoId: null });
    for (const sc of spec.scenes) expect(sc.background.type).toBe('gradient');
    expect(spec.scenes[0].background.type === 'gradient' && spec.scenes[0].background.shift).toBeTruthy();
    expect(spec.scenes.flatMap((sc) => sc.elements).some((el) => el.type === 'icon')).toBe(true);
    expect(spec.scenes.some((sc) => sc.elements.some((el) => el.type === 'image'))).toBe(false);
  });

  it('brings words in one after another and never repeats one layout for every scene', () => {
    const spec = buildSpec({ plan: plan(five), kit, logoId: null });
    const delays = spec.scenes[0].elements.filter((el) => el.type === 'text' || (el.type === 'shape' && el.animation?.type === 'grow')).map((el) => el.animation?.delay ?? 0);
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(new Set(spec.scenes.map((sc) => sc.elements.map((el) => el.type + (el.type === 'shape' ? el.animation?.type : '')).join())).size).toBeGreaterThanOrEqual(4);
  });

  it('keeps the closing headline as the biggest text of the last scene', () => {
    const spec = buildSpec({ plan: plan(five), kit, logoId: null });
    const texts = spec.scenes.at(-1)!.elements.filter((el) => el.type === 'text') as { text: string; size: number }[];
    expect(texts.sort((a, b) => b.size - a.size)[0].text).toBe('Book your pool closing');
  });

  it('draws every frame of the new elements, and mixes brand colours', () => {
    const spec = buildSpec({ plan: plan(five), kit, logoId: null });
    const { width, height } = sizes[spec.size];
    const canvas = createCanvas(width / 4, height / 4); const ctx = canvas.getContext('2d');
    const photo = createCanvas(300, 200); photo.getContext('2d').fillRect(0, 0, 300, 200);
    for (let t = 0; t < 20; t += 0.7) expect(() => drawFrame(ctx, spec, new Map([['p1', photo as never]]), t)).not.toThrow();
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
  });

  it('builds product-demo scenes from layered floating cards when there is no photo', () => {
    const scenes = [scene('hook', 'Closing your pool?', null), scene('detail', 'Seasonal closing', null, { visual: 'checklist', items: ['Winter cover fitted', 'Water balanced'] }), scene('detail', 'Ask us anything', null, { visual: 'chat' }), scene('detail', 'Pick a day', null, { visual: 'calendar' }), scene('detail', 'Plans', null, { visual: 'plan', items: ['Weekly visits'] }), scene('cta', 'Book your pool closing', null)];
    const spec = buildSpec({ plan: plan(scenes), kit, logoId: null });
    const cards = spec.scenes.flatMap((sc) => sc.elements.filter((el) => el.type === 'card')) as { card: string; float?: number }[];
    expect(new Set(cards.map((c) => c.card))).toEqual(new Set(['screen', 'checklist', 'blank', 'chat', 'calendar', 'plan'])); // no name badge or corner icons: the brand bar already says who it is
    expect(cards.filter((c) => c.card !== 'blank').every((c) => c.float)).toBe(true);
    expect(spec.scenes.every((sc) => sc.elements.length <= 20)).toBe(true);
    expect(validateSpec(spec).ok).toBe(true);
  });

  it('draws every card kind, floating motion and the new transitions without error', () => {
    const kinds = ['checklist', 'chat', 'calendar', 'quote', 'plan', 'stat', 'chart', 'screen', 'pill', 'blank'];
    const transitions = ['push', 'zoom-through'] as const;
    const raw = { version: 1, size: '540x960', fps: 12, brand: { name: 'Somerset', primary: '#0B3C7D', secondary: '#1E6FD9', accent: '#4FC3F7', textColor: '#FFFFFF' },
      scenes: [0, 1].map((n) => ({ seconds: 2, background: { type: 'solid', color: '#0B3C7D' }, transition: n === 0 ? { type: transitions[0], seconds: 0.5 } : undefined,
        elements: kinds.map((card, i) => ({ type: 'card', card, x: 40 + (i % 2) * 400, y: 60 + i * 150, width: 420, height: 300, title: 'Title', value: '5', button: 'Go', lines: ['< Hi', '> Hello', 'Row'], highlight: 12, tilt: 3, float: 8, animation: { type: 'float-in', delay: 0.1 * i } })) })) };
    const result = validateSpec(raw); expect(result.ok).toBe(true);
    if (!result.ok) return;
    const canvas = createCanvas(270, 480); const ctx = canvas.getContext('2d');
    for (let t = 0; t < 4; t += 0.25) expect(() => drawFrame(ctx, result.spec, new Map(), t)).not.toThrow();
    const alt = validateSpec({ ...raw, scenes: raw.scenes.map((sc) => ({ ...sc, transition: { type: transitions[1], seconds: 0.5 } })) });
    expect(alt.ok && alt.spec.scenes[0].transition?.type).toBe('zoom-through');
    expect(validateSpec({ ...raw, scenes: [{ ...raw.scenes[0], elements: [{ type: 'card', card: 'bogus', x: 0, y: 0, width: 100, height: 100 }] }] }).ok).toBe(true);
  });

  it('uses one calm base colour from the brand and its other colours as highlights, so orange-and-blue brands do not turn muddy', () => {
    const somerset = paletteFor({ name: 'Somerset', primary: '#233D48', secondary: '#E1611A', accent: '#188BF6' } as never);
    expect(somerset.dark).toBe(true); expect(somerset.text).toBe('#FFFFFF');
    expect(somerset.bgA).toMatch(/^#[0-9A-F]{6}$/); expect(parseInt(somerset.bgA.slice(1), 16)).toBeLessThan(0x404040 * 1.2); // a deep base, never a blend of the brand's bright colours
    expect(somerset.accent).toBe('#188BF6'); expect(somerset.glow).toBe('#E1611A');
    const pale = paletteFor({ name: 'Sunny', primary: '#FFF3B0', secondary: '#FDE68A', accent: '#FCD34D' } as never);
    expect(pale.dark).toBe(false); expect(pale.text).toBe('#0B1F44'); // an all-light brand gets a light base and dark text
    const spec = buildSpec({ plan: plan(five.map((sc) => ({ ...sc, asset: null }))), kit: { name: 'Somerset', primary: '#233D48', secondary: '#E1611A', accent: '#188BF6' } as never, logoId: null });
    const back = spec.scenes[1].background; expect(back.type === 'gradient' && back.from === somerset.bgA).toBe(true);
  });

  it('gives photo scenes a stronger slow zoom and pan, and varies how later photos are framed', () => {
    const photos = [scene('hook', 'Is your pool ready?', 'p1'), scene('detail', 'Full closing', 'p1'), scene('detail', 'Ready for spring', 'p1'), scene('detail', 'Trusted team', 'p1'), scene('cta', 'Book today', 'p1')];
    const spec = buildSpec({ plan: plan(photos), kit, logoId: null });
    const hero = spec.scenes[0].background; expect(hero.type === 'image' && hero.kenBurns!.to - hero.kenBurns!.from >= 0.15 && !!hero.kenBurns!.panX && !!hero.kenBurns!.panY).toBe(true);
    const looks = spec.scenes.slice(1, 4).map((sc) => (sc.background.type === 'image' ? 'full-bleed' : sc.elements.some((el) => el.type === 'image' && el.width === 1080) ? 'split' : 'frame'));
    expect(new Set(looks).size).toBe(3); // framed, split and full-bleed, not the same look three times
    expect(spec.scenes[0].elements.some((el) => el.type === 'shape' && el.gradient)).toBe(true); // words sit on a soft fade, not a boxed panel
  });

  it('keeps the words secondary-quiet and deliberate: bold headline, lighter supporting line, slow settling entrances, calm transitions', () => {
    const spec = buildSpec({ plan: plan([scene('hook', 'Closing your pool?', null, { transition: 'wipe' }), scene('detail', 'Seasonal closing', null, { transition: 'slide-up' }), scene('cta', 'Book today', null)]), kit, logoId: null });
    const texts = spec.scenes[0].elements.filter((el) => el.type === 'text') as { size: number; weight: number; animation?: { delay?: number; duration?: number; easing?: string } }[];
    const [head, sub] = texts; expect(head.weight).toBe(800); expect(sub.weight).toBe(400); expect(head.size).toBeGreaterThan(sub.size * 1.6);
    expect(head.animation).toMatchObject({ easing: 'expoOut' }); expect(head.animation!.duration).toBeGreaterThanOrEqual(0.9); expect(sub.animation!.delay!).toBeGreaterThan(head.animation!.delay!); // the supporting line arrives after the headline
    expect(spec.scenes.slice(0, -1).every((sc) => ['fade', 'push', 'zoom-through', 'slide-left'].includes(sc.transition!.type))).toBe(true);
  });

  it('with a bright main colour (Somerset’s orange) the base is the brand’s deep slate, the orange is the highlight, and nothing is blended into brown', () => {
    const p = paletteFor({ name: 'Somerset', primary: '#E1611A', secondary: '#233D48', accent: '#188BF6' } as never);
    expect(p.bgA).toBe('#233D48'); expect(p.accent).toBe('#E1611A'); expect(p.glow).toBe('#188BF6'); expect(p.dark).toBe(true);
  });

  it('puts a long business name on the button as its first part, and reuses the first photo for the ending ring', () => {
    expect(buttonLabel('Somerset Pool Service & Power Washing')).toBe('Somerset Pool Service'); expect(buttonLabel('Somerset Pool service')).toBe('Somerset Pool service');
    const spec = buildSpec({ plan: plan([scene('hook', 'Is your pool ready?', 'p1'), scene('cta', 'Book today', null)]), kit, logoId: null });
    expect(spec.scenes[1].elements.some((el) => el.type === 'image' && el.asset === 'p1' && el.radius === 180)).toBe(true);
  });
});

