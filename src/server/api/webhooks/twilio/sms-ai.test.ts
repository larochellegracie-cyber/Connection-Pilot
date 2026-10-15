import { describe, expect, it } from 'vitest';
import { extractResponseText } from './sms-ai.js';

describe('extractResponseText', () => {
  it('uses top-level Responses API output_text', () => {
    expect(extractResponseText({ output_text: 'Business hours are 9 to 5.' })).toBe('Business hours are 9 to 5.');
  });

  it('extracts nested output_text content', () => {
    expect(extractResponseText({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'We can help with your furnace.' }] }],
    })).toBe('We can help with your furnace.');
  });

  it('returns an empty string when a successful response has no final text', () => {
    expect(extractResponseText({ output: [{ type: 'reasoning', content: [] }] })).toBe('');
  });
});
