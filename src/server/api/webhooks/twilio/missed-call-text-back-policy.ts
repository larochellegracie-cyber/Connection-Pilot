export type CallStatusPayload = { callSid: string; direction: string; callStatus: string; from: string; to: string };
export type MissedCallDecision = { eligible: boolean; reason: string };

function validE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function assessMissedCall(payload: CallStatusPayload): MissedCallDecision {
  if (!payload.callSid) return { eligible: false, reason: 'missing_call_sid' };
  if (payload.direction.toLowerCase() !== 'inbound') return { eligible: false, reason: 'not_inbound' };
  if (payload.callStatus.toLowerCase() !== 'no-answer') return { eligible: false, reason: 'not_unanswered' };
  if (!validE164(payload.from)) return { eligible: false, reason: 'invalid_caller' };
  if (!validE164(payload.to)) return { eligible: false, reason: 'invalid_business_number' };
  return { eligible: true, reason: 'unanswered_incoming_call' };
}

export function missedCallMessage(businessName: string): string {
  return `Hi! Sorry we missed your call. This is Pilot from ${businessName}. How can we help? Reply to this text and we'll be happy to help.`;
}
