import { describe, expect, it } from 'vitest';
import type { CreativeBrief } from './creative-brief';
import { mergeFallback } from './creative-brief';
import { detectCreativeRequest } from '@/lib/marketing-creative-mode';
import { CREDITS_PER_SECOND, costSentence, costWords, describePlan, endTextFrom, estimateCredits, planIteration } from './iteration';
import type { Storyboard } from './storyboard';

const prev: CreativeBrief = { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: [], iteration_of: null };
const scene = (role: string, kind: string, seconds: number, clip: string | null) => ({ role, kind, seconds, description: `${role} scene`, prompt: kind === 'clip' ? 'p' : null, reference_asset_id: null, on_screen_text: kind === 'clip' ? '' : 'Book today', clip_video_id: clip });
const board = (over: Partial<Storyboard> = {}, clips = true): Storyboard => ({ scenes: [scene('hook', 'clip', 4, clips ? 'clip-hook-001' : null), scene('main', 'clip', 4, clips ? 'clip-main-001' : null), scene('support', 'clip', 4, clips ? 'clip-supp-001' : null), scene('ending', 'end_card', 3, null)] as never, total_seconds: 15, direction: { camera: 'c', lighting: 'l', mood: 'm' }, caption: 'cap', hashtags: [], cta: '', grade: 0, ...over });
/** What the real flow does: the change is merged into the brief (plain merge here), then planned. */
const plan = (message: string, storyboard: Storyboard | null = board(), previousBrief = prev) => planIteration({ previousBrief, storyboard, nextBrief: mergeFallback(previousBrief, message, detectCreativeRequest(message), 'Somerset Pool Service', 'job-0001'), message });

describe('how much of a finished video has to be redone', () => {
  it('“make it darker”: only a colour grade on the saved clips, free', () => {
    const p = plan('make it darker', board(), { ...prev, style: ['bright', 'calm'] });
    expect(p).toMatchObject({ kind: 'recut', grade: -0.1, redoScenes: [], redoEnding: false, creditSeconds: 0 });
  });
  it('steps the grade each time, and stops at a limit', () => {
    expect(plan('make it darker', board({ grade: -0.1 }), { ...prev, style: ['bright'] }).grade).toBe(-0.2);
    expect(plan('make it darker', board({ grade: -0.3 }), { ...prev, style: ['bright'] }).grade).toBe(-0.3);
    expect(plan('make it brighter', board({ grade: -0.2 })).grade).toBe(-0.1);
  });
  it('“make the product shot longer”: only the main shot is made again, 2 seconds longer', () => {
    const p = plan('make the product shot longer');
    expect(p).toMatchObject({ kind: 'recut', redoScenes: [1], sceneSeconds: { 1: 6 }, redoEnding: false, grade: null, creditSeconds: 6 });
    expect(estimateCredits(p.creditSeconds)).toBe(6 * CREDITS_PER_SECOND);
  });
  it('can make a named scene shorter, or an exact length', () => {
    expect(plan('make the opening shot shorter')).toMatchObject({ kind: 'recut', redoScenes: [0], sceneSeconds: { 0: 3 } });
    expect(plan('make the main shot 8 seconds')).toMatchObject({ kind: 'recut', redoScenes: [1], sceneSeconds: { 1: 8 }, creditSeconds: 8 });
    expect(plan('make the main shot 30 seconds').sceneSeconds[1]).toBe(10); // a scene is at most 10 seconds
  });
  it('“change the ending”: only the end card, free, with the owner’s words when given', () => {
    expect(plan('change the ending')).toMatchObject({ kind: 'recut', redoEnding: true, endText: null, redoScenes: [], creditSeconds: 0 });
    expect(plan('change the ending to "Book your closing today"').endText).toBe('Book your closing today');
    expect(plan('change the call to action to say Call us now at (519) 982-4901').endText).toBe('Call us now at (519) 982-4901');
  });
  it('a new caption keeps the same video, and new music puts new sound under the same picture', () => {
    expect(plan('make the caption shorter')).toMatchObject({ kind: 'caption_only', recaption: true, creditSeconds: 0 });
    expect(plan('change the hashtags')).toMatchObject({ kind: 'caption_only' });
    expect(plan('make the music more dramatic')).toMatchObject({ kind: 'music_only', creditSeconds: 0 });
    expect(plan('remove the music')).toMatchObject({ kind: 'music_only' });
  });
  it('can combine a free change with a scene remake', () => {
    expect(plan('make the product shot longer and change the ending')).toMatchObject({ kind: 'recut', redoScenes: [1], redoEnding: true });
  });
  it.each([
    ['make it more fun', 'look changed'], ['more energy', 'look changed'], ['make it more luxurious', 'look changed'], ['make it faster', 'look changed'],
    ['make it 20 seconds', 'length changed'], ['make it longer', 'longer or shorter'], ['actually make it about our spring special', ''],
  ])('“%s” needs the whole video made again', (message) => {
    const p = plan(message, board(), message.includes('spring') ? prev : prev);
    if (message.includes('spring')) { const subject = planIteration({ previousBrief: prev, storyboard: board(), nextBrief: { ...prev, main_subject: 'our spring special' }, message }); expect(subject.kind).toBe('full'); expect(subject.reason).toMatch(/subject changed/); return; }
    expect(p.kind).toBe('full'); expect(p.reason).toBeTruthy(); expect(p.creditSeconds).toBeGreaterThan(0);
  });
  it('a different platform or format also remakes everything', () => {
    expect(planIteration({ previousBrief: prev, storyboard: board(), nextBrief: { ...prev, platform: 'instagram' }, message: 'make it for Instagram' }).kind).toBe('full');
    expect(planIteration({ previousBrief: prev, storyboard: board(), nextBrief: { ...prev, content_type: 'both' }, message: 'x' }).kind).toBe('full');
  });
  it('remakes everything when it cannot tell what to change (always correct, if not the cheapest)', () => {
    expect(plan('hmm, something different')).toMatchObject({ kind: 'full' });
  });
  it('falls back to a full remake when a needed earlier clip was not saved, but not for changes that need no clips', () => {
    expect(plan('change the ending', board({}, false))).toMatchObject({ kind: 'full', reason: expect.stringMatching(/no longer have the earlier clips/) });
    expect(plan('make it darker', board({}, false), { ...prev, style: ['bright'] }).kind).toBe('full');
    expect(plan('make the music more dramatic', board({}, false)).kind).toBe('music_only'); // the finished video is enough
    expect(plan('make the caption shorter', board({}, false)).kind).toBe('caption_only');
    expect(plan('make the product shot longer', board({ scenes: board().scenes.map((s, i) => (i === 1 ? { ...s, clip_video_id: null } : s)) as never })).kind).toBe('recut'); // the scene being remade need not have been saved
  });
  it('remakes everything for a job whose scene plan was never saved', () => {
    expect(plan('change the ending', null).kind).toBe('full');
  });
});

describe('explaining the plan to the owner', () => {
  it('says what is kept, what is redone and what it costs', () => {
    expect(describePlan(plan('make the product shot longer'), board())).toEqual(['I’ll redo only the main shot (6 seconds), and keep the other scenes, the music and the caption. That uses about 72 Runway credits.']);
    expect(describePlan(plan('change the ending'), board())).toEqual(['I’ll redo only the ending, and keep the other scenes, the music and the caption. That uses no Runway credits.']);
    expect(describePlan(plan('make it darker', board(), { ...prev, style: ['bright'] }), board())[0]).toMatch(/a darker look across the clips, and keep the other scenes and the caption\. The music will follow the new mood\. That uses no Runway credits/);
    expect(describePlan(plan('make the caption shorter'), board())).toEqual(['I’ll write a new caption and keep the video exactly as it is. That uses no Runway credits.']);
    expect(describePlan(plan('make the music more dramatic'), board())[0]).toMatch(/new music under the same video/);
    expect(describePlan(plan('make it more cinematic', board(), { ...prev, style: ['dark'] }), board())[0]).toMatch(/make the whole video again \(The look changed \(the style words\), so every scene needs to be made again to match\)\. That uses about 144 Runway credits\./);
  });
});

describe('reading the new ending words', () => {
  it('finds quoted words, or the words after “to”', () => {
    expect(endTextFrom('change the ending to "Book now"')).toBe('Book now'); expect(endTextFrom('change the ending to something better')).toBeNull(); expect(endTextFrom('change the ending')).toBeNull();
    expect(endTextFrom('make the cta say Call (519) 982-4901.')).toBe('Call (519) 982-4901');
  });
});

describe('saying what things cost, the same way everywhere', () => {
  it('uses one wording for a cost: “about N Runway credits” or “no Runway credits”', () => {
    expect(costWords(0)).toBe('no Runway credits'); expect(costWords(4)).toBe(`about ${4 * CREDITS_PER_SECOND} Runway credits`); expect(costWords(12)).toBe('about 144 Runway credits');
  });
  it('every plan line ends with the cost in that wording', () => {
    for (const message of ['make the product shot longer', 'change the ending', 'make the caption shorter', 'make the music more dramatic', 'make it darker', 'make it more fun']) {
      const line = describePlan(plan(message, board(), message === 'make it darker' ? { ...prev, style: ['bright'] } : prev), board())[0];
      expect(line).toMatch(/That uses (?:no|about \d+) Runway credits\.$/); expect(line).not.toMatch(/video credits|That is/);
      expect(describePlan(plan(message, board(), message === 'make it darker' ? { ...prev, style: ['bright'] } : prev), board(), 'animated')[0]).toMatch(/That’s free: no credits\.$/);
    }
  });
  it('says a free animated video is free, and a Runway change in the shared wording', () => {
    expect(costSentence('animated', 0)).toBe('That’s free: no credits.'); expect(costSentence('runway', 4)).toBe('That uses about 48 Runway credits.'); expect(costSentence('runway', 0)).toBe('That uses no Runway credits.');
  });

});

describe('changing a free animated video: every change is free', () => {
  const animatedPlan = (message: string, previousBrief = prev) => planIteration({ previousBrief, storyboard: board(), nextBrief: mergeFallback(previousBrief, message, detectCreativeRequest(message), 'Somerset Pool Service', 'job-0001'), message, engine: 'animated' });
  it('a new caption or new music keeps the same video; a new ending is re-drawn; nothing costs credits', () => {
    expect(animatedPlan('make the caption punchier')).toMatchObject({ kind: 'caption_only', creditSeconds: 0 });
    expect(animatedPlan('make the music more dramatic')).toMatchObject({ kind: 'music_only', creditSeconds: 0 });
    expect(animatedPlan('change the ending to "Book your closing today"')).toMatchObject({ kind: 'recut', redoEnding: true, endText: 'Book your closing today', redoScenes: [], creditSeconds: 0 });
  });
  it('anything else plans the animation again (still free), with the reason', () => {
    for (const [message, brief] of [['make it darker', { ...prev, style: ['bright'] }], ['make it more fun', prev], ['make it 20 seconds', prev], ['make the product shot longer', prev]] as const) {
      const p = animatedPlan(message, brief as CreativeBrief); expect(p.kind === 'full' || p.kind === 'caption_only').toBe(true);
      if (message !== 'make the product shot longer') { expect(p).toMatchObject({ kind: 'full', creditSeconds: 0 }); expect(p.reason).toBeTruthy(); }
    }
    expect(animatedPlan('make it more fun').reason).toMatch(/look changed/);
  });
  it('a different subject or platform plans it again', () => {
    expect(planIteration({ previousBrief: prev, storyboard: board(), nextBrief: { ...prev, main_subject: 'our spring special' }, message: 'x', engine: 'animated' })).toMatchObject({ kind: 'full', creditSeconds: 0, reason: expect.stringMatching(/subject changed/) });
    expect(planIteration({ previousBrief: prev, storyboard: board(), nextBrief: { ...prev, platform: 'instagram' }, message: 'x', engine: 'animated' }).kind).toBe('full');
  });
  it('needs no saved clips: an animated video has none', () => {
    expect(planIteration({ previousBrief: prev, storyboard: board({}, false), nextBrief: mergeFallback(prev, 'change the ending', detectCreativeRequest('change the ending'), 'S', 'j'), message: 'change the ending', engine: 'animated' }).kind).toBe('recut');
  });
});

