import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { businessProfile, customer, customerInteraction, missedCallTextBack, phoneConnection } from '../../../db/schema.js';
import { logCustomerActivity } from '../../customers/activity.js';
import { normalizePhone, sendTwilioSms } from '../../phone-connection/shared.js';
import { assessMissedCall, missedCallMessage, type CallStatusPayload } from './missed-call-text-back-policy.js';

export async function processMissedCallTextBack(payload: CallStatusPayload): Promise<{ processed: boolean; reason: string }> {
  const callerPhone = normalizePhone(payload.from);
  const businessNumber = normalizePhone(payload.to);
  const normalizedPayload = { ...payload, from: callerPhone, to: businessNumber };
  const decision = assessMissedCall(normalizedPayload);
  if (!decision.eligible) return { processed: false, reason: decision.reason };
  const connections = await db.select().from(phoneConnection)
    .where(and(eq(phoneConnection.status, 'connected'), eq(phoneConnection.connectedNumber, businessNumber))).limit(1);
  const connection = connections[0];
  if (!connection) return { processed: false, reason: 'unconnected_business_number' };

  const businesses = await db.select({ id: businessProfile.id, businessName: businessProfile.businessName })
    .from(businessProfile).where(eq(businessProfile.id, connection.businessProfileId)).limit(1);
  const business = businesses[0];
  if (!business) return { processed: false, reason: 'business_not_found' };

  const customerRows = await db.select({ id: customer.id }).from(customer)
    .where(and(eq(customer.businessProfileId, business.id), eq(customer.phoneNumber, callerPhone))).limit(1);
  const customerId = customerRows[0]?.id ?? null;

  try {
    await db.insert(missedCallTextBack).values({
      id: randomUUID(), businessProfileId: business.id, customerId, callSid: payload.callSid,
      callerPhone, businessNumber, callStatus: payload.callStatus, status: 'sending',
    });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code === 'ER_DUP_ENTRY') return { processed: false, reason: 'already_processed' };
    throw error;
  }

  try {
    const sms = await sendTwilioSms({ from: businessNumber, to: callerPhone, body: missedCallMessage(business.businessName) });
    await db.update(missedCallTextBack).set({ status: 'sent', providerMessageSid: sms.sid, sentAt: new Date() }).where(eq(missedCallTextBack.callSid, payload.callSid));
    if (customerId) {
      await logCustomerActivity(customerId, 'missed_call_text_sent', 'Missed-call text sent', 'A text-back was sent after an unanswered incoming call.');
    }
    console.info('twilio.missed-call-text.sent', { callSid: payload.callSid, businessProfileId: business.id, customerId: customerId ?? undefined });
    return { processed: true, reason: 'sent' };
  } catch {
    const detail = 'Twilio SMS delivery request failed.';
    await db.update(missedCallTextBack).set({ status: 'failed', errorDetail: detail }).where(eq(missedCallTextBack.callSid, payload.callSid));
    console.error('twilio.missed-call-text.failed', { callSid: payload.callSid, businessProfileId: business.id, error: detail });
    return { processed: false, reason: 'send_failed' };
  }
}

export async function updateExistingCallStatus(callSid: string, status: string): Promise<void> {
  await db.update(customerInteraction).set({ status, outcome: status === 'completed' ? 'Completed' : status || null, followUpNeeded: status === 'no-answer' })
    .where(and(eq(customerInteraction.externalId, callSid), eq(customerInteraction.interactionType, 'call')));
}
