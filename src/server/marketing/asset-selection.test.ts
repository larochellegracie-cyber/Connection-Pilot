import { describe, expect, it } from 'vitest';
import { cleanSelection, selectAssets, stem, stems, subjectTerms, type SelectableMedia } from './asset-selection';

const somerset = { businessName: 'Somerset Pool service', businessType: 'Pool cleaning compnay' };
const bakery = { businessName: 'Sweet Crumbs Bakery', businessType: 'Bakery' };
let n = 0;
const media = (label: string, extra: Partial<SelectableMedia> = {}): SelectableMedia => ({ id: `asset-${String(++n).padStart(4, '0')}`, kind: 'product', label, description: '', tags: [], mime: 'image/png', originalName: 'photo.png', createdAt: `2026-10-${String(10 + (n % 15)).padStart(2, '0')}T10:00:00Z`, ...extra });
const pick = (subject: string, files: SelectableMedia[], business = somerset) => selectAssets({ brief: { main_subject: subject }, media: files, business, now: new Date('2026-10-23T12:00:00Z') });

describe('the Somerset data', () => {
  const salt = media('Pouring salt into a pool', { id: '53afcf40-e496-4677-ae65-0c0d0cb813c0', originalName: 'Screenshot 2026-10-22.png' });
  it('pool closing: the salt photo does not fit, so nothing is selected and a fallback is needed', () => {
    const result = pick('pool closing', [salt]);
    expect(result).toMatchObject({ selected_assets: [], has_good_match: false, fallback_needed: true });
    expect(result.note).toBe('None of your 1 file fit “pool closing” well. “Pouring salt into a pool” doesn’t relate to it.');
  });
  it('adding salt to your pool: the salt photo is selected, with the reason', () => {
    const result = pick('adding salt to your pool', [salt]);
    expect(result).toMatchObject({ has_good_match: true, fallback_needed: false });
    expect(result.selected_assets).toEqual([{ id: '53afcf40-e496-4677-ae65-0c0d0cb813c0', label: 'Pouring salt into a pool', description: '', type: 'photo', score: 3, reason: 'Its label mentions “salt”.' }]);
  });
  it('a general request names no subject, so no photo is claimed to fit', () => {
    const result = pick('general promotion of Somerset Pool service', [salt]);
    expect(result).toMatchObject({ selected_assets: [], has_good_match: false, fallback_needed: true });
    expect(result.note).toMatch(/doesn’t name a specific subject/);
  });
});

describe('how files are ranked', () => {
  it('matches related forms of a word: closing / closed / close, pools / pool, cakes / cake', () => {
    expect([stem('closing'), stem('closed'), stem('closes'), stem('close')]).toEqual(['clos', 'clos', 'clos', 'clos']);
    expect(stem('pools')).toBe(stem('pool')); expect(stem('cakes')).toBe(stem('cake')); expect(stem('pouring')).toBe('pour'); expect(stem('parties')).toBe('party');
    const result = pick('pool closing', [media('Winter cover closed for the season')]);
    expect(result.has_good_match).toBe(true);
  });
  it('ignores words that describe the whole business, so “pool” alone never makes a pool company’s photo relevant', () => {
    expect(subjectTerms('closing pools', somerset)).toEqual([{ stem: 'clos', word: 'closing' }]);
    expect(pick('pool opening', [media('Our pool', { description: 'a pool in a backyard' })]).has_good_match).toBe(false);
  });
  it('weights the label (3) above tags (2) above the description and file name (1); a word counts once, at its best place', () => {
    const byLabel = media('Closing day cover'); const byTag = media('Pool cover', { tags: ['closing'] }); const byDescription = media('Backyard', { description: 'cover for closing' });
    expect(pick('pool closing', [byDescription, byTag, byLabel]).selected_assets.map((a) => [a.label, a.score])).toEqual([['Closing day cover', 3]]); // only a label match reaches the bar of 3
    expect(pick('pool closing', [byTag]).has_good_match).toBe(false);
    expect(pick('pool closing', [media('Cover', { tags: ['closing'], description: 'closing' })]).has_good_match).toBe(false); // tag + description for the same word is still 2, not 3
    expect(pick('pool closing winter', [media('Cover', { tags: ['closing', 'winter'] })])).toMatchObject({ has_good_match: true }); // two tag matches add up (2 + 2)
  });
  it('ignores filler and time words in the subject, so they never count against a photo', () => {
    expect(subjectTerms('adding salt to your pool this weekend', somerset)).toEqual([{ stem: 'salt', word: 'salt' }]);
    expect(pick('using our real photos for a post about the new menu', [media('New menu board')], bakery).selected_assets[0].reason).toBe('Its label mentions “menu”.');
  });
  it('needs at least half of the subject’s words, so one stray word is not a match', () => {
    const chocolate = media('Chocolate birthday cake'); const bar = media('Chocolate bar');
    const result = pick('chocolate cake', [bar, chocolate], bakery);
    expect(result.selected_assets.map((a) => a.label)).toEqual(['Chocolate birthday cake', 'Chocolate bar']); // best first; the bar covers half the words, so it still qualifies
    expect(pick('fall menu seasonal pumpkin spice latte', [bar], bakery).has_good_match).toBe(false);
  });
  it('picks at most three, best first, and the newest wins a tie', () => {
    const files = Array.from({ length: 5 }, (_, i) => media('Fall menu', { createdAt: `2026-10-0${i + 1}T10:00:00Z` }));
    const result = pick('fall menu', files, bakery);
    expect(result.selected_assets).toHaveLength(3); expect(result.selected_assets.map((a) => a.id)).toEqual([files[4].id, files[3].id, files[2].id]);
  });
  it('explains a partial match in its reason', () => {
    const result = pick('chocolate cake', [media('Chocolate bar')], bakery);
    expect(result.selected_assets[0].reason).toBe('Its label mentions “chocolate”, but not “cake”.');
  });
  it('never selects a logo, and reports a video as a video', () => {
    const logo = media('Fall menu logo', { kind: 'logo' }); const clip = media('Fall menu walkthrough', { mime: 'video/mp4' });
    const result = pick('fall menu', [logo, clip], bakery);
    expect(result.selected_assets.map((a) => [a.label, a.type])).toEqual([['Fall menu walkthrough', 'video']]);
    expect(pick('fall menu', [logo], bakery)).toMatchObject({ has_good_match: false, fallback_needed: true });
  });
  it('says plainly when there is nothing uploaded at all', () => {
    expect(pick('pool closing', [])).toMatchObject({ selected_assets: [], has_good_match: false, fallback_needed: true, note: 'You haven’t uploaded any photos or videos yet, so there is nothing of yours to use.' });
  });
  it('reports the closest miss when something only loosely relates', () => {
    const result = pick('pool closing winter cover', [media('Winter sunset')]);
    expect(result.has_good_match).toBe(false); expect(result.note).toContain('The closest, “Winter sunset”, only loosely relates (it matches “winter” but not “closing” and “cover”).');
  });
  it('is plain code: the same media and brief always give the same selection', () => {
    const files = [media('Pool cover closing'), media('Salt')];
    expect(pick('pool closing', files)).toEqual(pick('pool closing', files));
  });
  it('stems only the meaningful words', () => { expect(stems('Make a video about the new chocolate cakes!')).toEqual(['chocolat', 'cak']); });
});

describe('reading a stored selection', () => {
  it('keeps a good selection and drops damaged parts', () => {
    const stored = { selected_assets: [{ id: 'asset-0001', label: 'Fall menu', description: 'd', type: 'photo', reason: 'r', score: 3 }, { id: '../x', label: 'bad' }, 'nope'], has_good_match: false, fallback_needed: true, note: 'n', selected_at: '2026-10-23T12:00:00.000Z' };
    const clean = cleanSelection(stored)!;
    expect(clean.selected_assets).toHaveLength(1); expect(clean).toMatchObject({ has_good_match: true, fallback_needed: false }); // the flags always agree with what is actually selected
    expect(cleanSelection(null)).toBeNull(); expect(cleanSelection('x')).toBeNull();
    expect(cleanSelection({ selected_assets: [] })).toMatchObject({ has_good_match: false, fallback_needed: true });
  });
});
