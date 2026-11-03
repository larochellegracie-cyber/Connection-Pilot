import { describe, expect, it } from 'vitest';
import { describeRequest, detectCreativeRequest } from '../marketing-creative-mode';

const yes = (text: string) => detectCreativeRequest(text);

describe('noticing a request to make marketing content', () => {
  it.each([
    'Pilot, make me a video for Somerset.',
    'Make me a video about our new chocolate cake.',
    'Make me a fast video for Instagram. Make it dark, cinematic and 3D.',
    'Make me an Instagram post for our cupcakes.',
    'Pilot, I need an Instagram post for tomorrow’s promotion.',
    'Make me a TikTok about pool closing',
    'Create a reel for this weekend',
    'Can you make an ad for our pool closing service?',
    'Write me an Instagram caption for the new menu',
    'Make an Instagram story for the sale',
    'I want a commercial for Somerset',
    'Promote our spring special',
    'Let’s advertise the pool opening',
    'Create something for Valentine’s Day.',
    'Make me something creative for this weekend. Surprise me.',
    'Make me a video using this photo.',
    'Make an Instagram post using our uploaded pictures.',
    'Create a video with no people, dark lighting, fast cuts, 3D text and dramatic music.',
    'Make me a post about our new promotion.',
    'Pilot, make me a 5-second realistic AI video about pool closing',
    'Design a flyer for the open house',
    'An Instagram post for our cupcakes please',
  ])('yes: %s', (text) => { expect(yes(text).isCreative).toBe(true); });

  it.each([
    'Post this invoice to the customer’s account',
    'Post a job opening for a pool technician',
    'Schedule a video call with Cooper tomorrow',
    'How do I reel in more customers?',
    'What is the status of invoice 1042?',
    'Show me this week’s schedule',
    'How many commercial pool customers do I have?',
    'What’s my commercial revenue this month?',
    'Run an ad hoc report on last month’s jobs',
    'What is TikTok?',
    'Send the post office receipt to the customer',
    'Who is working tomorrow?',
    'Tell me about the story behind this account',
    'Make a note that Cooper called',
    'Create an invoice for Cooper’s pool cleaning',
    'How did our Instagram ad perform last week?',
    'Write an email to Cooper about his quote',
  ])('no: %s', (text) => { expect(yes(text).isCreative).toBe(false); });

  it('says what it saw: the formats, the platform and the words that triggered it', () => {
    expect(yes('Make me a fast video for Instagram.')).toMatchObject({ isCreative: true, formats: ['video'], platform: 'instagram', matched: ['video'] });
    expect(yes('Make me a TikTok about pool closing')).toMatchObject({ formats: ['tiktok'], platform: 'tiktok' });
    expect(yes('Create an Instagram post and a reel for the sale').formats).toEqual(expect.arrayContaining(['social_post', 'reel']));
  });

  it('is plain code: the same words always give the same answer, and an empty message is never creative', () => {
    expect(yes('Make me a video')).toEqual(yes('Make me a video'));
    expect(yes('   ')).toEqual({ isCreative: false, formats: [], platform: null, matched: [] });
  });

  it('describes the request back in plain words', () => {
    expect(describeRequest(yes('Make me a TikTok about pool closing'))).toBe('a TikTok');
    expect(describeRequest(yes('Make me a video for Instagram'))).toBe('a video for Instagram');
    expect(describeRequest(yes('Make me an Instagram post for our cupcakes'))).toBe('a social post for Instagram');
    expect(describeRequest(yes('Make me a reel'))).toBe('a reel for Instagram');
  });
});
