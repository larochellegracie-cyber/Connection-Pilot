import { describe, expect, it } from 'vitest';
import { cleanTimeline, timelineIssues } from './timeline.js';

const text = (id: string, at: number, until: number, y: number, extra: Record<string, unknown> = {}) => ({ id, type: 'text', text: `Line ${id}`, at, until, x: 0.5, y, size: 80, ...extra });
describe('the timeline spec is tidied and checked by plain code', () => {
  it('keeps type big and out of the area platforms cover, drops bad connectors, scales to the length, and always ends on the business and a call to action', () => {
    const spec = cleanTimeline({ seconds: 10, elements: [text('a', 0, 4, 0.95, { size: 20 }), { type: 'node', id: 'n1', at: 1, x: 0.3, y: 0.5, icon: 'chat', label: 'Chat' }, { type: 'connector', from: 'n1', to: 'missing', at: 2 }, { type: 'bogus', at: 1 }, text('b', 4, 10, 0.5), { type: 'chip', text: 'x', at: 2, x: 0.5, y: 0.5 }] }, { seconds: 20, business: 'Acme', cta: 'Tap to call' })!;
    expect(spec.seconds).toBe(20); expect(spec.elements.find((e) => e.id === 'a')).toMatchObject({ size: 48, y: 0.78 }); expect(spec.elements.find((e) => e.id === 'b')!.at).toBe(8);
    expect(spec.elements.some((e) => e.type === 'connector' || e.type === 'bogus')).toBe(false);
    expect(spec.elements.some((e) => e.type === 'logo')).toBe(true); expect(spec.elements.some((e) => e.type === 'button' && /call/i.test(String(e.text)))).toBe(true);
  });
  it('sends back captionless stretches, overlapping words, crowding and dead time', () => {
    const base = { seconds: 12 };
    expect(timelineIssues({ ...base, elements: [text('a', 0, 3, 0.4), text('b', 8, 12, 0.4)] } as never).join(' ')).toMatch(/no words on screen between/);
    expect(timelineIssues({ ...base, elements: [text('a', 0, 12, 0.4), text('b', 1, 12, 0.41)] } as never).join(' ')).toMatch(/same place/);
    expect(timelineIssues({ ...base, elements: [text('a', 0, 12, 0.3), ...Array.from({ length: 12 }, (_, i) => ({ type: 'chip', id: `c${i}`, text: 'x', at: 0.5, x: 0.5, y: 0.6 }))] } as never).join(' ')).toMatch(/too crowded/);
    expect(timelineIssues({ ...base, elements: [text('a', 0, 12, 0.3), { type: 'chip', text: 'x', at: 8, x: 0.5, y: 0.6 }] } as never).join(' ')).toMatch(/Nothing enters or moves/);
    expect(timelineIssues({ ...base, elements: [text('a', 0, 12, 0.3), text('b', 0.5, 6, 0.55), ...[1.4, 2.8, 4.2, 5.6, 7, 8.4, 9.8, 11.2].map((at) => ({ type: 'chip', text: 'x', at, x: 0.5, y: 0.7, until: at + 0.4 }))] } as never)).toEqual([]);
  });
});

import { cleanBeats, compileBeats, iconFor } from './presets.js';
describe('composition presets place everything, so nothing collides', () => {
  const beats = cleanBeats({ beats: [
    { preset: 'headline_illustration', seconds: 4, headline: 'End-of-season pool stress?', highlight: ['stress'], illustration: { kind: 'pool', story: 'leaves' }, caption: 'Leaves, cold nights, a cover to haul' },
    { preset: 'headline_illustration', seconds: 4, headline: 'We clear it all', illustration: { kind: 'pool', story: 'cover_on' }, caption: 'Closed properly, ready for spring' },
    { preset: 'headline_illustration', seconds: 4, headline: 'Spring is next', illustration: { kind: 'pool', story: 'cover_off' }, caption: 'Cover off, water up' },
    { preset: 'hero_phone', seconds: 8, headline: 'Booked in a tap', screens: [{ title: 'Today', tag: '3 jobs', rows: [{ label: 'Pool closing', status: 'done' }, { label: 'Pool opening', status: 'pending' }] }], floating: [{ title: 'Confirmed', tag: 'ok' }, { title: 'Reminder' }], caption: 'Everything in one place' },
    { preset: 'big_number', seconds: 4, headline: 'Rated by owners', value: 4.9, unit: 'stars', caption: 'Windsor-Essex' },
    { preset: 'cta_end', seconds: 5, headline: 'Book your closing', button: 'Book now', contact: ['somersetpoolservice.com', '(519) 982-4901'] }] }, 29, { poolOk: true })!;
  it('compiles into a timeline with no overlaps, captions always on, dark theme, a logo or name at the end and nothing still for long', () => {
    const spec = compileBeats(beats, { logo: true, business: 'Somerset Pool Service' }); const tidy = cleanTimeline(spec, { seconds: 29, business: 'Somerset Pool Service', cta: 'Book now' })!;
    expect(tidy.theme).toBe('dark'); expect(timelineIssues(tidy)).toEqual([]); expect(tidy.elements.some((e) => e.type === 'logo')).toBe(true); expect(tidy.elements.filter((e) => e.type === 'text').every((e) => Number(e.size) >= 48 && Number(e.y) <= 0.78 + 0.001 || String(e.id).startsWith('ct'))).toBe(true);
  });
  it('drops a pool illustration for a business with no pool, and an icons beat with fewer than two real icons', () => {
    expect(cleanBeats({ beats: [{ preset: 'headline_illustration', seconds: 4, headline: 'Hello there', illustration: { kind: 'pool', story: 'leaves' } }, { preset: 'headline_illustration', seconds: 4, headline: 'Two things', illustration: { kind: 'icons', items: [{ icon: 'leaf', label: 'Leaves' }, { icon: 'nonsense', label: 'Nope' }] } }, { preset: 'cta_end', seconds: 4, button: 'Go' }] }, 12)).toBeNull();
  });
  it('never falls back to a star: unknown icons are dropped and synonyms map to real ones', () => {
    expect(iconFor('leaves')).toBe('leaf'); expect(iconFor('cover')).toBe('shield'); expect(iconFor('star')).toBeNull(); expect(iconFor('mystery')).toBeNull();
  });
});
