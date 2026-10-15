import type { Request, Response } from 'express';
import { normalizePhone, recordInboundInteraction, requireTwilioSignature, textValue, voiceTwimlResponse } from '../shared.js';

const fallbackBusinessName = 'Connection Pilot';

export default async function handler(req: Request, res: Response) {
  if (!requireTwilioSignature(req, res)) return;

  const callSid = textValue(req.body.CallSid, 255);
  const phoneNumber = normalizePhone(req.body.From);
  const businessNumber = normalizePhone(req.body.To);

  try {
    if (!callSid || !phoneNumber || !businessNumber) {
      console.warn('twilio.voice.missing-call-fields');
      voiceTwimlResponse(res, fallbackBusinessName);
      return;
    }

    const interaction = await recordInboundInteraction({
      interactionType: 'call',
      externalId: callSid,
      phoneNumber,
      businessNumber,
      status: textValue(req.body.CallStatus, 60) || 'ringing',
      summary: 'Incoming phone call received.',
      outcome: 'Received',
    });
    voiceTwimlResponse(res, interaction?.businessName || fallbackBusinessName);
  } catch {
    console.error('twilio.voice.processing-failed');
    voiceTwimlResponse(res, fallbackBusinessName);
  }
}
