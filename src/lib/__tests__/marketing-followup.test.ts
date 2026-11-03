import { describe, expect, it } from 'vitest';
import { classifyFollowUp, isConfirmation, lastAssistantInMode } from '../marketing-followup';

describe('what a reply to a brief confirmation means', () => {
  it.each([
    'yes', 'Yes!', 'yep', 'Yeah, go ahead', 'looks good', 'That looks good', 'Looks great, thanks', 'go ahead', 'Go ahead please', 'create it', 'make it', 'Make it!', 'do it',
    'let’s do it', 'perfect', 'sounds good', 'that’s right', 'ok', 'Okay, make it', 'yes please', 'confirmed', 'I’m happy with it', 'go for it', 'Pilot, looks good',
  ])('confirm: %s', (text) => { expect(isConfirmation(text)).toBe(true); expect(classifyFollowUp(text)).toBe('confirm'); });

  it.each([
    'make it darker', 'Make it 20 seconds', 'make it a 20 second video', 'change the ending', 'Change the ending to our phone number', 'more luxurious', 'a bit faster',
    'make the text bigger', 'use our logo', 'actually make it a TikTok', 'no people', 'make it shorter', 'add dramatic music', 'remove the music', '20 seconds', 'yes but make it darker',
    'looks good but change the ending', 'make it brighter and more fun', 'instead of dark, make it bright', 'make it a TikTok', 'make it an Instagram reel', 'Can you make it longer?',
  ])('change: %s', (text) => { expect(classifyFollowUp(text)).toBe('change'); });

  it.each([
    'Make me an Instagram post for our cupcakes', 'Create a reel about the new menu', 'Pilot, make me a video about pool opening', 'Make me a TikTok for Valentine’s Day',
    'Make me a 15 second TikTok about pool closing. Make it dark and cinematic.', 'I need a reel for the sale, make it fast', 'Can you make an ad for pool closing? Make it bold.',
  ])('a different request, not a change: %s', (text) => { expect(classifyFollowUp(text)).toBe('new_request'); });

  it.each([
    'Who is working tomorrow?', 'What is my revenue this month?', 'Send Cooper his invoice', 'hello', '', 'thanks', 'no', 'not yet', 'What does that mean?',
  ])('left to the normal chat: %s', (text) => { expect(classifyFollowUp(text)).toBe('other'); });

  it('never treats a message that asks for a change as a confirmation', () => {
    for (const text of ['yes but make it darker', 'ok, change the ending', 'looks good, make it 20 seconds']) { expect(isConfirmation(text)).toBe(false); expect(classifyFollowUp(text)).toBe('change'); }
  });

  it('knows when Pilot’s last message was a Marketing Creative Mode message', () => {
    const mode = [{ role: 'user', content: 'Make me a TikTok' }, { role: 'assistant', content: '**Marketing Creative Mode is on.** Here’s what I understood: …' }, { role: 'user', content: 'yes' }];
    expect(lastAssistantInMode(mode)).toBe(true);
    expect(lastAssistantInMode([{ role: 'assistant', content: '**Marketing Creative Mode: confirmed.** This brief is locked in' }])).toBe(true);
    expect(lastAssistantInMode([{ role: 'assistant', content: 'Nobody is scheduled tomorrow.' }, { role: 'user', content: 'yes' }])).toBe(false);
    expect(lastAssistantInMode([{ role: 'assistant', content: 'Marketing Creative Mode is on' }, { role: 'user', content: 'x' }, { role: 'assistant', content: 'Sure, done.' }])).toBe(false);
    expect(lastAssistantInMode([])).toBe(false);
  });
});
