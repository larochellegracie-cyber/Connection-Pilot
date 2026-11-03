import { describe, expect, it } from 'vitest';
import { chooseCodeVideo, codeVideoMode, subjectFits, wantsCreative, wantsPolish, type BusinessWords } from './choose.js';

const pool: BusinessWords = { businessName: 'Somerset Pool Service & Power Washing', businessType: 'Pool cleaning company', services: ['weekly pool maintenance', 'pool openings and closings', 'equipment repair', 'power washing'], description: 'Pool care in Windsor-Essex', promotions: '', sellingPoints: ['locally owned'] };
const pick = (message: string, subject: string, extra: Partial<Parameters<typeof chooseCodeVideo>[0]> = {}) => chooseCodeVideo({ message, subject, business: pool, hasPhotoMatch: false, mode: 'auto', ...extra });

describe('when Pilot writes its own video code', () => {
  it('knows when a subject is about the business and when it is not', () => {
    expect(subjectFits('pool closing', pool)).toBe(true); expect(subjectFits('equipment repair special', pool)).toBe(true); expect(subjectFits('chocolate cake', pool)).toBe(false); expect(subjectFits('', pool)).toBe(true);
  });
  it('does not use code for an ordinary request about what the business does', () => {
    expect(pick('Make me a 20 second video about pool closing', 'pool closing')).toMatchObject({ use: false, invent: false });
  });
  it('invents when the templates do not fit (a cake for a pool company) or the owner asks for something creative', () => {
    expect(pick('Make a video about a chocolate cake for Somerset', 'chocolate cake')).toMatchObject({ use: true, invent: true });
    expect(pick('Make a creative, original video about weekly pool maintenance', 'weekly pool maintenance')).toMatchObject({ use: true, invent: true });
    expect(wantsCreative('Surprise me with something different')).toBe(true);
  });
  it('does not invent a subject the owner has a photo of', () => { expect(pick('Make a video about our chocolate cake', 'chocolate cake', { hasPhotoMatch: true })).toMatchObject({ use: false }); });
  it('uses code on request, never when off, and stays on the same style when redoing an earlier video', () => {
    expect(pick('make it with a custom animation', 'pool closing')).toMatchObject({ use: true, invent: false });
    expect(pick('Make a video about a chocolate cake', 'chocolate cake', { mode: 'off' })).toMatchObject({ use: false });
    expect(pick('Make a video about a chocolate cake', 'chocolate cake', { mode: 'request' })).toMatchObject({ use: false });
    expect(pick('make it darker', 'pool closing', { forced: true, invented: true })).toMatchObject({ use: true, invent: true });
  });

  describe('primary mode (the default): custom code is the main path', () => {
    const main = (message: string, subject: string, extra: Partial<Parameters<typeof chooseCodeVideo>[0]> = {}) => chooseCodeVideo({ message, subject, business: pool, hasPhotoMatch: true, mode: 'primary', ...extra });
    it('is the default mode', () => { delete process.env.PILOT_CODE_VIDEO; expect(codeVideoMode()).toBe('primary'); });
    it('writes code for a styled, higher-quality or creative request, and for any reference', () => {
      expect(main('Make a cinematic reel about pool closing', 'pool closing')).toMatchObject({ use: true, invent: true });
      expect(main('Make a premium looking ad with smooth transitions', 'weekly pool maintenance')).toMatchObject({ use: true, invent: true });
      expect(main('Make a video about pool closing', 'pool closing', { hasReference: true })).toMatchObject({ use: true, invent: true });
      expect(main('Make a creative video', 'pool closing')).toMatchObject({ use: true, invent: true });
    });
    it('keeps the stable template path for a plain, simple request', () => {
      expect(main('Make me a 20 second video about pool closing', 'pool closing')).toMatchObject({ use: false, invent: false });
      expect(wantsPolish('Make me a video about pool closing')).toBe(false);
    });
    it('never writes code when switched off', () => { expect(main('Make a cinematic reel', 'pool closing', { mode: 'off' })).toMatchObject({ use: false }); });
  });
});
