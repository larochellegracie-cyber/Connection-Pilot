import { describe, expect, it } from 'vitest';
import { assessMissedCall, missedCallMessage } from './missed-call-text-back-policy.js';

const incomingMissed = { callSid: 'CA123', direction: 'inbound', callStatus: 'no-answer', from: '+14165550100', to: '+12267735103' };

describe('missed-call text-back qualification', () => {
  it('qualifies an unanswered incoming call with usable numbers', () => {
    expect(assessMissedCall(incomingMissed)).toEqual({ eligible: true, reason: 'unanswered_incoming_call' });
  });

  it('does not qualify an answered incoming call', () => {
    expect(assessMissedCall({ ...incomingMissed, callStatus: 'completed' })).toMatchObject({ eligible: false, reason: 'not_unanswered' });
  });

  it('does not qualify an outgoing call', () => {
    expect(assessMissedCall({ ...incomingMissed, direction: 'outbound-dial' })).toMatchObject({ eligible: false, reason: 'not_inbound' });
  });

  it('does not qualify an invalid caller number', () => {
    expect(assessMissedCall({ ...incomingMissed, from: 'anonymous' })).toMatchObject({ eligible: false, reason: 'invalid_caller' });
  });

  it('uses the confirmed business name in the short default message', () => {
    expect(missedCallMessage('Staci Bakes')).toBe("Hi! Sorry we missed your call. This is Pilot from Staci Bakes. How can we help? Reply to this text and we'll be happy to help.");
  });
});
