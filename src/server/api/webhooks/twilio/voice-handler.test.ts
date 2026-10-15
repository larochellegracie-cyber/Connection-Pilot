import { beforeEach, describe, expect, it, vi } from 'vitest';

const voiceTwimlResponse = vi.fn();
const recordInboundInteraction = vi.fn();

vi.mock('./shared.js', () => ({
  normalizePhone: (value: unknown) => typeof value === 'string' ? value : '',
  recordInboundInteraction,
  requireTwilioSignature: () => true,
  textValue: (value: unknown) => typeof value === 'string' ? value : '',
  voiceTwimlResponse,
}));

const { default: voiceHandler } = await import('./voice/POST.js');

type MockResponse = { status: ReturnType<typeof vi.fn>; type: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };

function response(): MockResponse {
  const mock: MockResponse = { status: vi.fn(), type: vi.fn(), send: vi.fn() };
  mock.status.mockReturnValue(mock);
  mock.type.mockReturnValue(mock);
  return mock;
}

describe('voice webhook resilience', () => {
  beforeEach(() => {
    voiceTwimlResponse.mockReset();
    recordInboundInteraction.mockReset();
  });

  it('returns a TwiML response even when inbound-call recording fails', async () => {
    recordInboundInteraction.mockRejectedValue(new Error('database unavailable'));
    const res = response();
    await voiceHandler({ body: { CallSid: 'CA123', From: '+14165550100', To: '+12267735103', CallStatus: 'ringing' } } as never, res as never);
    expect(voiceTwimlResponse).toHaveBeenCalledWith(res, 'Connection Pilot');
  });

  it('returns a TwiML response for a signed call without required fields', async () => {
    const res = response();
    await voiceHandler({ body: {} } as never, res as never);
    expect(voiceTwimlResponse).toHaveBeenCalledWith(res, 'Connection Pilot');
  });
});
