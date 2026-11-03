import { describe, expect, it } from 'vitest';
import { describesPicture, dropPictureCaptions } from './strategy.js';
import type { Concept } from './concept.js';

describe('words on screen are never a description of the picture', () => {
  it('flags and removes shot descriptions but keeps real copy', () => {
    expect(describesPicture('mechanical clock close-up', {})).toBe(true);
    expect(describesPicture('silhouette and van beams', {})).toBe(true);
    expect(describesPicture('TIME CHECK', { visual: 'analog clock gears' })).toBe(false);
    expect(describesPicture('Call us any hour', { visual: 'a phone on a table' })).toBe(false);
    const concept = { scenes: [{ headline: 'TIME CHECK', subtext: 'mechanical clock close-up', shot: { text: 'headline_sub' } }, { headline: 'HOME AT NIGHT', subtext: 'silhouette and van beams', shot: { text: 'headline_sub' } }, { headline: 'close-up of tools', subtext: '', shot: { text: 'headline' } }] } as unknown as Concept;
    expect(dropPictureCaptions(concept)).toBe(3);
    expect(concept.scenes.map((s) => [s.headline, s.subtext])).toEqual([['TIME CHECK', ''], ['HOME AT NIGHT', ''], ['', '']]);
    expect(concept.scenes[2].shot?.text).toBe('none');
  });
});
