import { describe, expect, it } from 'vitest';
import { ANIMATED_STARTING, animatedNote, engineFor, footageSeconds, isAmbiguous, premiumRequested, runwayStarting, runwayWarning } from './video-engine';

describe('which way a video is made', () => {
  it.each([
    'Make me a cinematic video about pool closing', 'Make me an AI video of a pool', 'Make an AI-generated video about our cake', 'Use Runway for this one', 'I want a realistic video of a pool at sunset',
    'Make a photorealistic clip', 'real footage of the pool please', 'a live-action style video', 'Make me a text-to-video clip', 'generated footage of a backyard',
  ])('premium (Runway): %s', (message) => { expect(engineFor({ message, style: [] })).toBe('runway'); expect(premiumRequested(message)).toBe(true); });

  it.each([
    'Make me a 15 second TikTok about pool closing', 'Make me a video for Somerset', 'Make me a fast video for Instagram. Make it dark and 3D.', 'Make a fun video about our cupcakes',
    'Create a video using this photo', 'Make me a luxury video about our new cake', 'Make it slow and calm', 'Make a video with our uploaded pictures',
  ])('free (animated) by default: %s', (message) => { expect(engineFor({ message, style: ['dark', 'fast', 'luxury'] })).toBe('animated'); });

  it('uses the style words of a NEW request, so “cinematic” in the brief means premium', () => {
    expect(engineFor({ message: 'x', style: ['dark', 'cinematic'] })).toBe('runway'); expect(engineFor({ message: 'x', style: ['realistic'] })).toBe('runway');
  });
  it('lets the owner switch to the free way in plain words', () => {
    for (const message of ['make it animated', 'make it free, no credits', 'without Runway please', 'use the free version', 'make it an animated video instead', 'don’t use Runway']) expect(engineFor({ message, style: ['cinematic'], earlier: 'runway' })).toBe('animated');
  });
  it('keeps the engine a video was made with when a change does not name one', () => {
    expect(engineFor({ message: 'make it darker', style: [], earlier: 'animated' })).toBe('animated'); expect(engineFor({ message: 'make it darker', style: ['cinematic'], earlier: 'runway' })).toBe('runway');
  });
  it('never turns a free video premium just because its brief still says “cinematic”; only the owner’s new words can', () => {
    expect(engineFor({ message: 'make it darker', style: ['cinematic'], earlier: 'animated' })).toBe('animated');
    expect(engineFor({ message: 'make it cinematic', style: ['cinematic'], earlier: 'animated' })).toBe('runway'); // asked for in so many words
    expect(engineFor({ message: 'use Runway', style: [], earlier: 'animated' })).toBe('runway');
  });
});

describe('when to ask', () => {
  it('asks only when there is no subject: just the business, or nothing', () => {
    expect(isAmbiguous({ main_subject: 'general promotion of Somerset Pool Service', style: [] })).toBe(true); expect(isAmbiguous({ main_subject: '', style: [] })).toBe(true); expect(isAmbiguous({ main_subject: '   ', style: [] })).toBe(true);
    expect(isAmbiguous({ main_subject: 'pool closing', style: [] })).toBe(false); expect(isAmbiguous({ main_subject: 'our new chocolate cake', style: ['dark'] })).toBe(false);
  });
  it('does not ask when the owner said “surprise me”', () => { expect(isAmbiguous({ main_subject: 'general promotion of Somerset', style: ['surprise me'] })).toBe(false); });
});

describe('what the owner is told about each path', () => {
  it('says plainly that the animated path is free and starts now', () => {
    expect(ANIMATED_STARTING).toBe('Creating a free animated video… I’ll use your photos where they fit, your brand colours, text and motion, and original music. It uses no Runway credits and takes about a minute.');
    expect(animatedNote('Soft and elegant: wide pads, 72 BPM')).toBe('Made with Pilot’s free animation: your photos where they fit, brand colours, text and motion. No Runway credits were used. Music: Soft and elegant: wide pads, 72 BPM. It was made for this video, so there’s nothing to license.');
    expect(animatedNote(null)).not.toMatch(/Music:/);
  });
  it('shows the Runway cost first and offers the free version', () => {
    expect(runwayWarning({ length_seconds: 15 })).toBe('Using Runway: this will cost about 144 Runway credits (12 seconds of AI-generated footage). The caption, the music and the ending card cost nothing extra. Say yes to go ahead, or say “make it animated” for the free version.');
    expect(runwayWarning({ length_seconds: 6 })).toMatch(/about 48 Runway credits \(4 seconds/); expect(runwayWarning({ length_seconds: null })).toMatch(/about 144 Runway credits/);
  });
  it('repeats the cost when Runway starts', () => {
    expect(runwayStarting({ length_seconds: 15 })).toMatch(/^Using Runway: this will cost about 144 Runway credits\. I’ll plan about 4 short scenes/);
  });
  it('counts only the generated footage, not the ending card', () => { expect(footageSeconds(15)).toBe(12); expect(footageSeconds(6)).toBe(4); expect(footageSeconds(30)).toBe(27); });
});
