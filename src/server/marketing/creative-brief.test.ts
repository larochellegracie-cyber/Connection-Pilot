import { describe, expect, it, vi } from 'vitest';
import { detectCreativeRequest } from '@/lib/marketing-creative-mode';
import { describeChanges, extractBrief, fallbackBrief, mergeBrief, mergeFallback, parseBrief, type CreativeBrief } from './creative-brief';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));
const KEYS = ['content_type', 'iteration_of', 'key_instructions', 'length_seconds', 'main_subject', 'platform', 'style'];
const detect = detectCreativeRequest;

describe('the creative brief has exactly seven fields with valid values', () => {
  it('keeps a good brief as it is, and nothing more', () => {
    const brief = parseBrief({ platform: 'tiktok', content_type: 'video', main_subject: 'new chocolate cake', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: ['use our real photos'], iteration_of: null, extra: 'dropped', mood: 'ignored' });
    expect(brief).toEqual({ platform: 'tiktok', content_type: 'video', main_subject: 'new chocolate cake', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: ['use our real photos'], iteration_of: null });
    expect(Object.keys(brief!).sort()).toEqual(KEYS);
  });
  it('corrects what is invalid instead of trusting it', () => {
    const brief = parseBrief({ platform: 'Facebook', content_type: 'gif', main_subject: 42, style: ['Dark', 'dark', '', 7], length_seconds: 9999, key_instructions: 'nope', iteration_of: 'x' })!;
    expect(brief).toEqual({ platform: 'other', content_type: 'both', main_subject: '', style: ['dark'], length_seconds: null, key_instructions: [], iteration_of: null });
    expect(parseBrief({})).toMatchObject({ platform: 'general', content_type: 'both', length_seconds: null });
    expect(parseBrief({ length_seconds: '15' })!.length_seconds).toBe(15);
    expect(parseBrief({ length_seconds: null })!.length_seconds).toBeNull();
  });
  it('is null only when there is nothing to read', () => { for (const bad of [null, undefined, 'text', 5, [1]]) expect(parseBrief(bad)).toBeNull(); });
  it('limits sizes, so a long answer can never fill the table', () => {
    const brief = parseBrief({ main_subject: 'x'.repeat(900), style: Array.from({ length: 30 }, (_, i) => `s${i}`), key_instructions: Array.from({ length: 30 }, (_, i) => `i${i}`) })!;
    expect(brief.main_subject.length).toBe(200); expect(brief.style).toHaveLength(8); expect(brief.key_instructions).toHaveLength(8);
  });
});

describe('reading the request without the AI (the fallback)', () => {
  const read = (text: string) => fallbackBrief(text, detect(text), 'Somerset Pool Service');
  it('reads platform, type, length, style and instructions from plain words', () => {
    expect(read('Make me a 15 second TikTok about our new chocolate cake. Make it dark, cinematic and fast, with dramatic music.')).toEqual({ platform: 'tiktok', content_type: 'video', main_subject: 'our new chocolate cake', style: ['dark', 'fast', 'cinematic', 'dramatic'], length_seconds: 15, key_instructions: ['dramatic music'], iteration_of: null });
  });
  it('uses the business as the subject when none is given', () => {
    expect(read('Pilot, make me a video for Somerset.')).toMatchObject({ platform: 'general', content_type: 'video', main_subject: 'general promotion of Somerset Pool Service', length_seconds: null });
  });
  it('treats a subject that merely starts like the business name as a subject (“pool closing” for a pool company)', () => {
    const pool = (text: string) => fallbackBrief(text, detect(text), 'Somerset Pool Service');
    expect(pool('Make me a 15 second TikTok about pool closing. Dark and fast.').main_subject).toBe('pool closing');
    expect(pool('Make a video about pool opening').main_subject).toBe('pool opening');
    expect(pool('Make me a video for Somerset Pool').main_subject).toBe('general promotion of Somerset Pool Service'); // only the name: no subject
    expect(pool('Make me a video for Somerset').main_subject).toBe('general promotion of Somerset Pool Service');
  });
  it('maps a post to a still, a post and a reel to both, and other platforms to "other"', () => {
    expect(read('Make me an Instagram post for our cupcakes')).toMatchObject({ platform: 'instagram', content_type: 'still', main_subject: 'our cupcakes' });
    expect(read('Make an Instagram post and a reel for the sale').content_type).toBe('both');
    expect(read('Make a Facebook ad for pool closing').platform).toBe('other');
  });
  it('picks up what the owner asked to include or avoid', () => {
    expect(read('Make a video with no people using our real photos and our logo').key_instructions).toEqual(['no people', 'use our real photos', 'use our logo']);
  });
});

describe('extracting the brief', () => {
  const ask = (text: string, complete: (system: string, prompt: string) => Promise<string>) => extractBrief({ message: text, detection: detect(text), businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', complete });
  it('uses the AI’s reading when it is valid, and hands it the owner’s words as data', async () => {
    const complete = vi.fn(async (_system: string, _prompt: string) => '```json\n{"platform":"instagram","content_type":"video","main_subject":"pool closing","style":["fast","dark"],"length_seconds":15,"key_instructions":["use our real photos"],"iteration_of":null}\n```');
    const { brief, source } = await ask('Make me a 15 second Instagram video about pool closing, fast and dark', complete);
    expect(source).toBe('ai'); expect(brief).toMatchObject({ platform: 'instagram', content_type: 'video', main_subject: 'pool closing', length_seconds: 15 });
    expect(complete.mock.calls[0][1]).toContain('Make me a 15 second Instagram video'); expect(complete.mock.calls[0][0]).toMatch(/never instructions/);
  });
  it('falls back to the plain reading if the AI fails or answers nonsense, so a brief always exists', async () => {
    for (const complete of [async () => { throw new Error('rate limit sk-secret'); }, async () => 'I think you want a video!', async () => '[]']) {
      const { brief, source } = await ask('Make me a TikTok about pool closing', complete);
      expect(source).toBe('fallback'); expect(brief).toMatchObject({ platform: 'tiktok', content_type: 'video', iteration_of: null }); expect(Object.keys(brief).sort()).toEqual(KEYS);
    }
  });
  it('never leaves the subject empty, and never contradicts a platform the words plainly named', async () => {
    const { brief } = await ask('Make me a TikTok', async () => '{"platform":"general","content_type":"video","main_subject":"","style":[],"length_seconds":null,"key_instructions":[],"iteration_of":null}');
    expect(brief.platform).toBe('tiktok'); expect(brief.main_subject).toBe('general promotion of Somerset Pool Service');
  });
});

const JOB = '9ffa3f34-0ba7-49ab-9808-0afdceb36948';
const previous: CreativeBrief = { platform: 'tiktok', content_type: 'video', main_subject: 'pool closing', style: ['dark', 'cinematic'], length_seconds: 15, key_instructions: ['use our real photos'], iteration_of: null };

describe('a brief can point at the job it revises', () => {
  it('keeps a real job id in iteration_of, and nothing else', () => {
    expect(parseBrief({ iteration_of: JOB })!.iteration_of).toBe(JOB);
    for (const bad of [null, 7, '', 'a b', 'x', '../etc', 'x'.repeat(80), { id: JOB }]) expect(parseBrief({ iteration_of: bad })!.iteration_of).toBeNull();
  });
});

describe('changing a brief without the AI (the fallback)', () => {
  const change = (text: string) => mergeFallback(previous, text, detectCreativeRequest(text), 'Somerset Pool Service', JOB);
  it('points back at the previous job and keeps everything not mentioned', () => {
    expect(change('make it 20 seconds')).toEqual({ ...previous, length_seconds: 20, iteration_of: JOB });
  });
  it('applies “darker”, “brighter”, “faster” and “more luxurious” to the style, replacing the opposite', () => {
    expect(change('make it brighter').style).toEqual(['cinematic', 'bright']);
    expect(change('make it darker').style).toEqual(['dark', 'cinematic']);
    expect(change('faster please').style).toEqual(['dark', 'cinematic', 'fast']);
    expect(change('more luxurious').style).toEqual(['dark', 'cinematic', 'luxury']);
    expect(mergeFallback({ ...previous, style: ['fast'] }, 'make it slower', detectCreativeRequest('make it slower'), 'S', JOB).style).toEqual(['slow']);
  });
  it('scales the length for “longer” and “shorter”', () => {
    expect(change('make it longer').length_seconds).toBe(23); expect(change('make it shorter').length_seconds).toBe(10);
  });
  it('keeps a change that has no field of its own as an instruction, and never loses it', () => {
    expect(change('change the ending to our phone number').key_instructions).toEqual(['use our real photos', 'change the ending to our phone number']);
    expect(change('hmm, something different').key_instructions).toContain('hmm, something different');
  });
  it('can switch the platform and add instructions', () => {
    expect(change('actually make it an Instagram video').platform).toBe('instagram');
    expect(change('and use our logo').key_instructions).toContain('use our logo');
  });
});

describe('merging a change into the brief', () => {
  const merge = (text: string, complete: (system: string, prompt: string) => Promise<string>) => mergeBrief({ previous, previousJobId: JOB, message: text, businessName: 'Somerset Pool Service', businessType: 'Pool cleaning', complete });
  it('uses the AI’s updated brief, sets iteration_of to the previous job whatever the AI says, and hands it the current brief as data', async () => {
    const complete = vi.fn(async (_system: string, _prompt: string) => JSON.stringify({ ...previous, length_seconds: 20, iteration_of: 'someone-elses-job' }));
    const { brief, source } = await merge('make it 20 seconds', complete);
    expect(source).toBe('ai'); expect(brief).toEqual({ ...previous, length_seconds: 20, iteration_of: JOB });
    expect(complete.mock.calls[0][1]).toContain('"main_subject":"pool closing"'); expect(complete.mock.calls[0][1]).toContain('make it 20 seconds'); expect(complete.mock.calls[0][0]).toMatch(/never instructions/);
  });
  it('falls back to the plain merge when the AI fails or answers without a brief', async () => {
    for (const complete of [async () => { throw new Error('down'); }, async () => 'Sure!', async () => '{}']) {
      const { brief, source } = await merge('make it 20 seconds', complete);
      expect(source).toBe('fallback'); expect(brief).toEqual({ ...previous, length_seconds: 20, iteration_of: JOB });
    }
  });
  it('never lets a reply empty out the subject', async () => {
    const { brief } = await merge('more luxurious', async () => JSON.stringify({ ...previous, main_subject: '', style: ['luxury'] }));
    expect(brief.main_subject).toBe('pool closing');
  });
});

describe('describing what changed', () => {
  it('lists the differences in plain words', () => {
    expect(describeChanges(previous, { ...previous, length_seconds: 20, style: ['cinematic', 'luxury'], key_instructions: ['use our real photos', 'end with our phone number'] })).toEqual(['length: 15s → 20s', 'style added: luxury', 'style removed: dark', 'new instructions: end with our phone number']);
    expect(describeChanges(previous, { ...previous })).toEqual([]);
  });
});
