import type { Request, Response } from 'express';
import { normalizePhone, recordInboundInteraction, requireTwilioSignature, textValue, twimlResponse } from './shared.js';

const acknowledgement = 'Thanks for contacting us. We received your message and a team member will follow up shortly.';

export default async function handler(req: Request, res: Response) {
  if (!requireTwilioSignature(req, res)) return;

  const externalId = textValue(req.body.MessageSid, 255) || textValue(req.body.CallSid, 255);
  const phoneNumber = normalizePhone(req.body.From);
  const businessNumber = normalizePhone(req.body.To);
  const message = textValue(req.body.Body, 10000);
  if (!externalId || !phoneNumber || !businessNumber) {
    twimlResponse(res, acknowledgement);
    return;
  }

  try {
    const interactionType = message ? 'sms' : 'call';
    const interaction = await recordInboundInteraction({
      interactionType,
      externalId,
      phoneNumber,
      businessNumber,
      conversation: message || null,
      summary: message ? 'Incoming SMS message received.' : 'Incoming phone call received.',
      status: textValue(req.body.SmsStatus, 60) || textValue(req.body.CallStatus, 60) || 'received',
      outcome: 'Received',
    });
    if (!interaction) {
      twimlResponse(res, acknowledgement);
      return;
    }
    twimlResponse(res, interactionType === 'sms' ? acknowledgement : undefined);
  } catch (error) {
    console.error('twilio.webhook.record-failed', { externalId, error: error instanceof Error ? error.message : String(error) });
    twimlResponse(res, acknowledgement);
  }
}
