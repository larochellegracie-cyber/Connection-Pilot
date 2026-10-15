import { replyToCustomerMessage } from '@/server/customer-messaging.js';
import {
  getOutboundSmsReply,
  normalizePhone,
  recordInboundInteraction,
  recordOutboundSmsReply,
  requireTwilioSignature,
  textValue,
  twimlResponse,
} from '../shared.js';

export default async function handler(req: Request, res: Response) {
  if (!requireTwilioSignature(req, res)) return;

  const messageSid = textValue(req.body.MessageSid, 255);
  const phoneNumber = normalizePhone(req.body.From);
  const businessNumber = normalizePhone(req.body.To);
  const message = textValue(req.body.Body, 10000);
  if (!messageSid || !phoneNumber || !businessNumber || !message) {
    twimlResponse(res);
    return;
  }

  try {
    const interaction = await recordInboundInteraction({
      interactionType: 'sms',
      externalId: messageSid,
      phoneNumber,
      businessNumber,
      conversation: message,
      summary: 'Incoming SMS message received.',
      status: textValue(req.body.SmsStatus, 60) || 'received',
      outcome: 'Received',
    });
    if (!interaction) {
      twimlResponse(res);
      return;
    }

    const existingReply = await getOutboundSmsReply(messageSid);
    if (existingReply) {
      twimlResponse(res, existingReply);
      return;
    }

    const reply = await replyToCustomerMessage({
      businessProfileId: interaction.businessProfileId,
      customerId: interaction.customerId,
      sourceMessageSid: messageSid,
      message,
      phoneNumber,
    });
    if (!reply) {
      // The channel is intentionally silent until a Pro business activates a
      // real connected number. Never simulate customer delivery or a fallback chat.
      twimlResponse(res);
      return;
    }
    const providerReply = await recordOutboundSmsReply(interaction.customerId, phoneNumber, reply, messageSid);
    twimlResponse(res, providerReply);
  } catch (error) {
    console.error('customer-messaging.sms.failed', { messageSid, error: error instanceof Error ? error.message : String(error) });
    twimlResponse(res);
  }
}
