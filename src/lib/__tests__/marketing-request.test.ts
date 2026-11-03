import { describe, expect, it } from 'vitest';
import { suggestedDay, understand } from '../marketing-request';

const u = (text: string) => understand(text, 'Somerset Pool Service');

describe('understanding what the owner asks Pilot for', () => {
  it.each([
    ['Pilot, make me a post for Somerset.', { action: 'create', medium: 'post', topic: '' }],
    ['Make me a video for Somerset', { action: 'create', medium: 'video', topic: '' }],
    ['Make me something for Halloween.', { action: 'create', medium: 'post', topic: 'Halloween' }],
    ['Make me a 20-second Instagram ad for our pool closing service.', { action: 'create', medium: 'video', platform: 'instagram', topic: 'pool closing service' }],
    ['Give me some ideas for what I should post this week.', { action: 'ideas' }],
    ['Make idea #3.', { action: 'make_idea', ideaNumber: 3 }],
    ['I want a post about why people should close their pool early.', { action: 'create', medium: 'post', topic: 'why people should close their pool early' }],
  ])('%s', (text, expected) => { expect(u(text)).toMatchObject(expected); });

  it('does not take a bare yes, ok or no for a request to make something', () => {
    for (const text of ['yes', 'Yes!', 'ok', 'sure', 'go ahead', 'looks good', 'no', 'nope', 'thanks', 'hello']) expect(u(text).action).toBe('clarify');
    expect(u('yes, make me a post about pool closing').action).toBe('create');
  });

  it('understands the different ways of picking an idea', () => {
    for (const text of ['Make #3', 'make number 3', '3', 'Do the third one', 'Let’s do idea 3', 'go with option 3']) expect(u(text)).toMatchObject({ action: 'make_idea', ideaNumber: 3 });
    expect(u('Make idea #2 as a video').medium).toBe('video');
  });

  it('uses an AI picture only when the owner explicitly asks for an AI-generated picture, image or photo', () => {
    const asked = u('Pilot, make me an AI-generated picture of a pool technician closing a pool.');
    expect(asked).toMatchObject({ action: 'create', medium: 'ai_image', topic: 'a pool technician closing a pool' });
    for (const text of ['Make me an AI image of a clean pool', 'Generate a photo of a pool at sunset', 'Create an AI picture for our post']) expect(u(text).medium).toBe('ai_image');
    // ordinary requests, and anything about video, never become an AI picture
    for (const text of ['Pilot, make me a post for Somerset this weekend.', 'Make me a post about pool closing with a nice picture', 'Make me a photo contest post', 'Make an AI-generated video of a pool', 'Make me a 5-second realistic AI video about pool closing']) expect(u(text).medium).not.toBe('ai_image');
  });

  it('uses Standard Video for every video, and AI video only when the owner asks for realistic or generated footage', () => {
    expect(u('Make me a video for pool opening').medium).toBe('video');
    expect(u('Make a TikTok reel about our crew').medium).toBe('video');
    expect(u('Make me a cinematic video of a pool at sunset').medium).toBe('ai_video');
    expect(u('I want realistic AI-generated footage of a backyard pool').medium).toBe('ai_video');
    expect(u('Make idea 2 as an AI video').medium).toBe('ai_video');
    expect(u('Make me an ad for pool closing').medium).toBe('post');
  });

  it('can plan a week', () => { expect(u('Plan my week').action).toBe('plan_week'); expect(u('plan next week’s content').action).toBe('plan_week'); });
  it('does not mistake a numbered request for an idea', () => { expect(u('Make me a 20-second video about pool closing').action).toBe('create'); });

  it('treats "this weekend" as timing, not as the subject', () => {
    expect(u('Pilot, make me a post for Somerset this weekend.')).toMatchObject({ action: 'create', medium: 'post', topic: '', when: 'this weekend' });
    expect(u('Pilot, make me a 20-second Instagram video about pool closing')).toMatchObject({ medium: 'video', platform: 'instagram', topic: 'pool closing', when: null });
    expect(u('Make a post about pool closing tomorrow')).toMatchObject({ topic: 'pool closing', when: 'tomorrow' });
  });

  it('asks one short question when the message is not a request', () => {
    for (const text of ['hello', 'Hi!', 'help', 'what can you do?']) expect(u(text).action).toBe('clarify');
    expect(u('Make me something for this weekend').action).toBe('create');
  });

  it('suggests a sensible day for the calendar', () => {
    expect(suggestedDay('make a post this weekend', '2026-10-21')).toBe('2026-10-24'); // Wednesday -> Saturday
    expect(suggestedDay('make a post this weekend', '2026-10-24')).toBe('2026-10-24');
    expect(suggestedDay('post tomorrow', '2026-10-21')).toBe('2026-10-22');
    expect(suggestedDay('next week', '2026-10-21')).toBe('2026-10-26');
    expect(suggestedDay('make a post', '2026-10-21')).toBe('2026-10-21');
  });
});
