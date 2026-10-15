import { describe, expect, it } from 'vitest';
import { voiceTwimlDocument } from './voice-twiml.js';

describe('voice webhook TwiML', () => {
  it('returns a valid TwiML response document for an incoming call', () => {
    const twiml = voiceTwimlDocument('Staci Bakes');
    expect(twiml).toContain('<Response>');
    expect(twiml).toContain('<Say>Hi, thanks for calling Staci Bakes.');
    expect(twiml).toContain('<Record ');
    expect(twiml).toContain('</Response>');
  });

  it('escapes business names before including them in TwiML', () => {
    expect(voiceTwimlDocument('Bakes & Co.')).toContain('Bakes &amp; Co.');
  });
});
