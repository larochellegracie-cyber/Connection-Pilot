import { describe, expect, it, vi } from 'vitest';
import type { CreativeBrief } from './creative-brief';
import { captionVoice, checkCaption, cleanHashtags, fallbackCaption, writeCaption } from './caption';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const brief = (extra: Partial<CreativeBrief> = {}): CreativeBrief => ({ platform: 'tiktok', content_type: 'video', main_subject: 'adding salt to your pool', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: [], iteration_of: null, ...extra });
const input = (tone = 'Professional') => ({ brief: { businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', location: 'Windsor-Essex', website: 'https://somersetpoolservice.com', description: 'Pool openings, closings, salt systems and water testing.', services: ['Pool opening', 'Pool closing', 'Salt system service'], pricing: '', targetCustomers: '', sellingPoints: [], promotions: '', hours: '', brandVoice: { tone, description: '' }, learned: ['Phone: (519) 982-4901'], websiteNotes: [], setupAnswers: [], hasBusinessInformation: true, confirmedProfile: true }, signals: [], trends: [], insights: [], existing: [], now: new Date('2026-10-23T12:00:00Z'), timezone: 'America/Toronto' }) as never;
const ctx = (extra: Partial<CreativeBrief> = {}, tone?: string, platform: 'tiktok' | 'instagram' = 'tiktok') => ({ brief: brief(extra), input: input(tone), platform });
const good = 'Cloudy water after adding salt? It usually means the balance is off.\n\nSomerset Pool Service tests your water and checks your salt system across Windsor-Essex.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
const reply = (over: Record<string, unknown> = {}) => JSON.stringify({ caption: good, hashtags: ['SaltPool', '#PoolCare', 'WindsorEssex', '#SomersetPoolService'], cta: 'Book at somersetpoolservice.com or call (519) 982-4901.', end_card_text: 'Book at somersetpoolservice.com', ...over });

describe('the voice a caption is written in', () => {
  it('follows the brief’s style and the business’s own voice', () => {
    expect(captionVoice(['dark', 'cinematic'], 'Professional').text).toBe('the business\'s own voice (Professional); short, punchy lines with a confident, dramatic edge');
    expect(captionVoice(['luxury'], '').text).toBe('refined and understated, never pushy');
    expect(captionVoice(['fast', 'high energy'], '').text).toMatch(/quick, energetic/);
    expect(captionVoice([], '').text).toBe('natural, friendly and plain-spoken');
  });
  it('allows an emoji only for a playful style or a warm brand voice', () => {
    expect(captionVoice(['fun'], '').emoji).toBe(true); expect(captionVoice([], 'Friendly and warm').emoji).toBe(true);
    expect(captionVoice(['dark'], 'Professional').emoji).toBe(false); expect(captionVoice(['luxury'], '').emoji).toBe(false);
  });
});

describe('hashtags', () => {
  it('are clean one-word tags, without spaces, symbols, generic filler or repeats', () => {
    expect(cleanHashtags(['pool care', '#PoolCare', '#poolcare', '#love', 'instagood', '#a', 'Windsor-Essex!', 7, '#SomersetPoolService'])).toEqual(['#poolcare', '#WindsorEssex', '#SomersetPoolService']);
  });
});

describe('what counts as a good caption', () => {
  const tags = ['#SaltPool', '#PoolCare', '#WindsorEssex', '#SomersetPoolService'];
  it('accepts a caption with a real hook, a real fact, a real call to action and good hashtags', () => { expect(checkCaption(good, tags, ctx())).toEqual([]); });
  it.each([
    ['restates the topic', 'Adding salt to your pool.\n\nWe handle it.\n\nCall (519) 982-4901.', /only restates the topic/],
    ['opens with a stock phrase', 'Check out our salt pool service in town today!\n\nWe test the water.\n\nCall (519) 982-4901.', /stock phrase/],
    ['opens with “Introducing”', 'Introducing a better way to look after your water!\n\nWe test the water.\n\nCall (519) 982-4901.', /stock phrase/],
    ['starts with the business name', 'Somerset Pool Service is here for your salt pool needs.\n\nWe test the water.\n\nCall (519) 982-4901.', /starts with the business name/],
    ['puts hashtags in the words', 'Cloudy water after salt? Here is why #saltpool\n\nWe test the water.\n\nCall (519) 982-4901.', /Hashtags belong in the hashtag list/],
    ['uses a generic phrase', 'Cloudy water after adding salt? Look no further!\n\nWorld-class water testing.\n\nCall (519) 982-4901.', /generic marketing phrase/],
    ['has no call to action', 'Cloudy water after adding salt? It usually means the balance is off.\n\nWe test water and check salt systems across Windsor-Essex.', /no call to action/],
    ['is one line only', 'Cloudy water after adding salt? Call (519) 982-4901.', /hook, a short body and a call to action/],
    ['has a hook that is too long', `${'Cloudy water after adding salt means the balance is off and the cell may need cleaning '.repeat(2)}?\n\nWe test the water.\n\nCall (519) 982-4901.`, /must be 90 or fewer/],
    ['uses an emoji in a serious voice', 'Cloudy water after adding salt? 💦\n\nWe test the water.\n\nCall (519) 982-4901.', /Remove the emoji/],
  ])('flags a caption that %s', (_name, caption, expected) => { expect(checkCaption(caption, tags, ctx()).join(' ')).toMatch(expected); });
  it('flags a caption that never mentions what the video is about', () => {
    const offTopic = 'Want a hassle-free pool opening?\n\nSomerset Pool Service serves Windsor-Essex with local, friendly service.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
    expect(checkCaption(offTopic, tags, ctx()).join(' ')).toMatch(/never mentions what the video is about \(adding salt to your pool\)/);
    expect(checkCaption(offTopic.replace('local, friendly service', 'saltwater pool care'), tags, ctx())).toEqual([]); // a related word is enough
    expect(checkCaption(offTopic, tags, ctx({ main_subject: 'general promotion of Somerset Pool Service' }))).toEqual([]); // no specific subject to check
  });
  it('wants the last line to say what to do, not only give a number', () => {
    expect(checkCaption(good.replace('Book at somersetpoolservice.com or call (519) 982-4901.', '(519) 982-4901'), tags, ctx()).join(' ')).toMatch(/last line should tell people what to do/);
    expect(checkCaption(good.replace('Book at somersetpoolservice.com or call (519) 982-4901.', 'Call (519) 982-4901.'), tags, ctx())).toEqual([]);
  });
  it('asks for enough hashtags, more on Instagram than TikTok', () => {
    expect(checkCaption(good, ['#SaltPool'], ctx()).join(' ')).toMatch(/at least 3/); expect(checkCaption(good, tags.slice(0, 3), ctx({ platform: 'instagram' }, undefined, 'instagram')).join(' ')).toMatch(/at least 4/);
  });
  it('allows an emoji for a playful style, and a longer hook on Instagram', () => {
    expect(checkCaption(good.replace('balance is off.', 'balance is off. 🌊'), tags, ctx({ style: ['fun'] }))).toEqual([]);
    expect(checkCaption(`${'Cloudy water after adding salt means the balance is off '.repeat(1)}and needs a check?\n\nWe test water.\n\nCall (519) 982-4901.`, tags, ctx({}, undefined, 'instagram'))).toEqual([]);
  });
});

describe('writing the caption', () => {
  it('uses the AI’s caption when it meets the standard, and keeps the hashtags apart from the words', async () => {
    const complete = vi.fn(async (_s: string, _p: string) => reply());
    const result = await writeCaption({ ...ctx(), complete, scenes: ['Salt pours into the water.', 'Ripples spread.'] });
    expect(result).toMatchObject({ source: 'ai', problems: [], cta: 'Book at somersetpoolservice.com or call (519) 982-4901.', end_card_text: 'Book at somersetpoolservice.com' });
    expect(result.caption).toBe(good); expect(result.hashtags).toEqual(['#SaltPool', '#PoolCare', '#WindsorEssex', '#SomersetPoolService']); expect(complete).toHaveBeenCalledTimes(1);
    const [system, prompt] = complete.mock.calls[0];
    expect(system).toMatch(/Line 1 is the HOOK/); expect(system).toMatch(/must NOT just restate the topic/);
    for (const part of ['Somerset Pool Service', 'Brand voice: Professional', 'adding salt to your pool', 'Salt pours into the water. Ripples spread.', 'short, punchy lines with a confident, dramatic edge', 'No emoji.', 'Platform: TikTok']) expect(prompt).toContain(part);
  });
  it('sends a draft that is about something else back, and uses the corrected one', async () => {
    const offTopic = 'Want a hassle-free pool opening?\n\nSomerset Pool Service serves Windsor-Essex with local, friendly service.\n\nBook at somersetpoolservice.com or call (519) 982-4901.';
    const complete = vi.fn(async (_s: string, _p: string) => (complete.mock.calls.length === 1 ? reply({ caption: offTopic }) : reply()));
    const result = await writeCaption({ ...ctx(), complete });
    expect(result.source).toBe('retry'); expect(complete.mock.calls[1][1]).toContain('never mentions what the video is about');
  });
  it('sends a weak draft back with the specific problems, and uses the improved one', async () => {
    const complete = vi.fn(async (_s: string, _p: string) => (complete.mock.calls.length === 1 ? reply({ caption: 'Adding salt to your pool.\n\nWe do it.\n\nCall (519) 982-4901.' }) : reply()));
    const result = await writeCaption({ ...ctx(), complete });
    expect(result.source).toBe('retry'); expect(result.caption).toBe(good); expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][1]).toContain('Your last draft had these problems. Fix every one:'); expect(complete.mock.calls[1][1]).toContain('only restates the topic');
  });
  it('builds an honest caption from the facts, which itself meets the standard, when the AI cannot', async () => {
    for (const complete of [async () => { throw new Error('down'); }, async () => 'Sure!', async () => reply({ caption: 'Adding salt.\n\nWe do it.' })]) {
      const result = await writeCaption({ ...ctx(), complete });
      expect(result.source).toBe('fallback'); expect(checkCaption(result.caption, result.hashtags, ctx())).toEqual([]);
      expect(result.caption).toContain('Thinking about adding salt to your pool?'); expect(result.caption).toContain('somersetpoolservice.com'); expect(result.caption).toContain('(519) 982-4901'); expect(result.hashtags).toContain('#SomersetPoolService');
    }
  });
  it('never invents: promises are removed and the hashtags are fitted to the platform', async () => {
    const result = await writeCaption({ ...ctx(), complete: async () => reply({ caption: `${good}\n\nGuaranteed to go viral.`, hashtags: ['a1b', 'SaltPool', 'PoolCare', 'WindsorEssex', 'SomersetPoolService', 'Extra1', 'Extra2', 'Extra3'] }) });
    expect(result.caption).not.toMatch(/guarantee|viral/i); expect(result.hashtags.length).toBeLessThanOrEqual(5); // TikTok allows 5
  });
  it('rewrites the caption when the owner asks for a change, with the old one as context', async () => {
    const complete = vi.fn(async (_s: string, _p: string) => reply());
    await writeCaption({ ...ctx(), complete, instruction: 'make the caption shorter', previous: { caption: 'OLD CAPTION TEXT', hashtags: [] } });
    expect(complete.mock.calls[0][1]).toContain('make the caption shorter'); expect(complete.mock.calls[0][1]).toContain('OLD CAPTION TEXT');
  });
  it('allows one emoji for a warm brand voice, and says so in the prompt', async () => {
    const complete = vi.fn(async (_s: string, _p: string) => reply());
    await writeCaption({ ...ctx({ style: ['fun'] }, 'Friendly'), complete });
    expect(complete.mock.calls[0][1]).toContain('A single emoji is fine, but never in the first line.');
  });
});

describe('the plain fallback caption', () => {
  it('covers a request with no subject, and a business with no phone or website', () => {
    expect(fallbackCaption(ctx({ main_subject: 'general promotion of Somerset Pool Service' })).caption).toContain('Here’s how Somerset Pool Service can help in Windsor-Essex.');
    const bare = { ...(input() as object), brief: { ...(input() as any).brief, website: '', learned: [], description: '' } } as never;
    expect(fallbackCaption({ brief: brief(), input: bare, platform: 'tiktok' }).cta).toBe('Send us a message to book.');
  });
});
