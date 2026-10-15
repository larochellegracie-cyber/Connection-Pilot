import type { Request, Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { getSecret } from '#airo/secrets';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessProfile, customer, customerAppointment, customerInteraction, customerNote, phoneConnection } from '@/server/db/schema.js';
import { createAppointmentBookedNotification, createAppointmentChangeNotification, createInboundCommunicationNotification } from '@/server/appointment-notifications.js';
import { logCustomerActivity } from '../../customers/activity.js';
import { assertSchedulingAvailability, getCalendarSettings } from '../../calendar/shared.js';
import { voiceTwimlDocument } from './voice-twiml.js';

type TwilioPayload = Record<string, unknown>;

type InteractionInput = {
  interactionType: 'call' | 'sms';
  externalId: string;
  phoneNumber: string;
  businessNumber: string;
  conversation?: string | null;
  summary?: string | null;
  status?: string | null;
  outcome?: string | null;
  followUpNeeded?: boolean;
  recordingUrl?: string | null;
  transcript?: string | null;
};

export function textValue(value: unknown, maxLength = 10000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function normalizePhone(value: unknown): string {
  return textValue(value, 40).replace(/[^0-9+]/g, '');
}

const TWILIO_SMS_WEBHOOK_URL = 'https://00rkwvh8b2.c37.airoapp.ai/api/webhooks/twilio/sms';
const TWILIO_SMS_PREVIEW_WEBHOOK_URL = 'https://00rkwvh8b2.preview.c37.airoapp.ai/api/webhooks/twilio/sms';

type SignatureValidation = 'valid' | 'missing_signature' | 'invalid_signature';

function validateSignature(req: Request, token: string): SignatureValidation {
  const signature = req.header('x-twilio-signature');
  if (!signature) return 'missing_signature';

  const urls = req.path === '/api/webhooks/twilio/sms'
    ? [TWILIO_SMS_WEBHOOK_URL, TWILIO_SMS_PREVIEW_WEBHOOK_URL, 'https://connectionpilot.net/api/webhooks/twilio/sms']
    : [`${req.protocol}://${req.get('host')}${req.originalUrl}`];
  const entries = Object.entries(req.body as TwilioPayload).sort(([left], [right]) => left.localeCompare(right));
  const received = Buffer.from(signature);
  const valid = urls.some((url) => {
    const payload = entries.reduce((value, [key, item]) => `${value}${key}${String(item)}`, url);
    const expectedBuffer = Buffer.from(createHmac('sha1', token).update(payload).digest('base64'));
    return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
  });
  return valid ? 'valid' : 'invalid_signature';
}

export function requireTwilioSignature(req: Request, res: Response): boolean {
  const token = getSecret('TWILIO_AUTH_TOKEN');
  const request = { host: req.get('host') ?? 'unknown', path: req.path };
  if (!token || typeof token !== 'string') {
    console.error('twilio.webhook.signature-secret-missing', request);
    res.status(503).json({ error: 'Twilio webhook signing is not configured.' });
    return false;
  }

  const validation = validateSignature(req, token);
  if (validation !== 'valid') {
    console.warn('twilio.webhook.signature-validation-failed', { ...request, validation });
    res.status(401).json({ error: 'Invalid webhook signature.' });
    return false;
  }
  return true;
}

async function resolveCustomer(businessNumber: string, phoneNumber: string) {
  const connections = await db.select().from(phoneConnection).where(and(eq(phoneConnection.status, 'connected'), or(eq(phoneConnection.connectedNumber, businessNumber), eq(phoneConnection.requestedNumber, businessNumber)))).limit(1);
  const connection = connections[0];
  const profiles = await db.select().from(businessProfile);
  const business = connection
    ? profiles.find((profile) => profile.id === connection.businessProfileId)
    : profiles.find((profile) => normalizePhone(profile.phoneNumber) === businessNumber);
  if (!business) return null;
  const matches = await db.select().from(customer).where(and(eq(customer.businessProfileId, business.id), eq(customer.phoneNumber, phoneNumber))).limit(1);
  const existing = matches[0];
  if (existing) return { business, customer: existing };
  const customerId = randomUUID();
  await db.insert(customer).values({ id: customerId, businessProfileId: business.id, name: phoneNumber, phoneNumber });
  const created = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
  return created[0] ? { business, customer: created[0] } : null;
}


export type ReceptionistCustomerDetails = {
  name?: string | null;
  email?: string | null;
  address?: string | null;
};

function isPhonePlaceholderName(name: string, phoneNumber: string): boolean {
  return normalizePhone(name) === normalizePhone(phoneNumber);
}

export async function updateReceptionistCustomerDetails(customerId: string, details: ReceptionistCustomerDetails) {
  const rows = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
  const profile = rows[0];
  if (!profile) throw new Error('Customer profile not found.');
  const updates: Partial<typeof customer.$inferInsert> = { lastContactedAt: new Date() };
  const name = textValue(details.name, 255);
  const email = textValue(details.email, 255);
  const address = textValue(details.address, 1000);
  if (name && (isPhonePlaceholderName(profile.name, profile.phoneNumber) || profile.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) updates.name = name;
  if (email && !profile.email) updates.email = email;
  if (address && !profile.address) updates.address = address;
  await db.update(customer).set(updates).where(eq(customer.id, customerId));
  return profile;
}

export async function saveVoiceReceptionistNote(customerId: string, callSid: string, note: string) {
  const cleanNote = textValue(note, 5000);
  if (!cleanNote) return;
  const marker = `[voice:${callSid}]`;
  const existing = await db.select({ id: customerNote.id }).from(customerNote).where(and(eq(customerNote.customerId, customerId), like(customerNote.body, `%${marker}%`))).limit(1);
  if (existing[0]) return;
  await db.insert(customerNote).values({ id: randomUUID(), customerId, body: `${marker} ${cleanNote}` });
  await logCustomerActivity(customerId, 'voice_note_added', 'Voice receptionist note saved', cleanNote);
}

export async function getVoiceReceptionistContext(callSid: string) {
  const interactions = await db.select().from(customerInteraction).where(and(eq(customerInteraction.externalId, callSid), eq(customerInteraction.interactionType, 'call'))).limit(1);
  const interaction = interactions[0];
  if (!interaction) return null;
  const profiles = await db.select().from(customer).where(eq(customer.id, interaction.customerId)).limit(1);
  const customerProfile = profiles[0];
  if (!customerProfile) return null;
  const businesses = await db.select().from(businessProfile).where(eq(businessProfile.id, customerProfile.businessProfileId)).limit(1);
  const business = businesses[0];
  if (!business) return null;
  const settings = await getCalendarSettings(business.id);
  return { interaction, customer: customerProfile, business, timezone: settings.timezone };
}

export type ReceptionistAppointmentInput = {
  customerId: string;
  sourceExternalId: string;
  isRebooking?: boolean;
  rebookAppointmentId?: string;
  name: string;
  email?: string | null;
  address?: string | null;
  title: string;
  scheduledAt: Date;
  notes?: string | null;
};

export async function saveReceptionistAppointment(input: ReceptionistAppointmentInput) {
  const customerRecord = await db.select({ businessProfileId: customer.businessProfileId, name: customer.name }).from(customer).where(eq(customer.id, input.customerId)).limit(1);
  if (!customerRecord[0]) throw new Error('Customer profile not found for this appointment.');
  const sourceMatches = await db
    .select({ id: customerAppointment.id, title: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, notes: customerAppointment.notes, status: customerAppointment.status })
    .from(customerAppointment)
    .where(eq(customerAppointment.sourceExternalId, input.sourceExternalId))
    .limit(1);
  const scheduledAppointments = await db
    .select({ id: customerAppointment.id, title: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, notes: customerAppointment.notes, status: customerAppointment.status })
    .from(customerAppointment)
    .where(and(eq(customerAppointment.customerId, input.customerId), eq(customerAppointment.status, 'scheduled')))
    .orderBy(desc(customerAppointment.scheduledAt));
  const explicitlySelected = input.rebookAppointmentId
    ? scheduledAppointments.find((appointment) => appointment.id === input.rebookAppointmentId)
    : undefined;
  if (input.rebookAppointmentId && !explicitlySelected) throw new Error('The appointment selected for rebooking is no longer available.');
  if (!sourceMatches[0] && input.isRebooking && !explicitlySelected && scheduledAppointments.length > 1) {
    throw new Error('Please confirm which existing appointment you would like to change before rebooking.');
  }
  const existingAppointment = sourceMatches[0] ?? explicitlySelected ?? (input.isRebooking ? scheduledAppointments[0] : undefined);
  const settings = await getCalendarSettings(customerRecord[0].businessProfileId);
  await assertSchedulingAvailability(customerRecord[0].businessProfileId, input.scheduledAt, settings.defaultDurationMinutes, existingAppointment?.id);

  await updateReceptionistCustomerDetails(input.customerId, { name: input.name, email: input.email, address: input.address });
  await db.update(customer).set({ status: 'returning', lastContactedAt: new Date() }).where(eq(customer.id, input.customerId));

  const appointmentValues = {
    title: input.title,
    scheduledAt: input.scheduledAt,
    durationMinutes: settings.defaultDurationMinutes,
    notes: input.notes || null,
    status: 'scheduled',
  };
  if (existingAppointment) {
    await db.update(customerAppointment).set(appointmentValues).where(eq(customerAppointment.id, existingAppointment.id));
    await logCustomerActivity(input.customerId, 'appointment_updated', 'Appointment updated by AI receptionist', input.title);
    await createAppointmentChangeNotification({
      businessProfileId: customerRecord[0].businessProfileId,
      customerId: input.customerId,
      customerName: input.name || customerRecord[0].name,
      appointmentId: existingAppointment.id,
      before: existingAppointment,
      after: appointmentValues,
    });
    return existingAppointment.id;
  }

  const appointmentId = randomUUID();
  await db.insert(customerAppointment).values({
    id: appointmentId,
    customerId: input.customerId,
    sourceExternalId: input.sourceExternalId,
    ...appointmentValues,
  });
  await logCustomerActivity(input.customerId, 'appointment_booked', 'Appointment booked by AI receptionist', input.title);
  await createAppointmentBookedNotification({
    businessProfileId: customerRecord[0].businessProfileId,
    customerId: input.customerId,
    customerName: input.name || customerRecord[0].name,
    appointmentId,
    appointment: appointmentValues,
  });
  return appointmentId;
}
export async function recordInboundInteraction(input: InteractionInput) {
  const resolved = await resolveCustomer(input.businessNumber, input.phoneNumber);
  if (!resolved) return null;
  const existing = await db.select().from(customerInteraction).where(eq(customerInteraction.externalId, input.externalId)).limit(1);
  const values = {
    interactionType: input.interactionType,
    phoneNumber: input.phoneNumber,
    direction: 'inbound',
    status: input.status || null,
    conversation: input.conversation || null,
    summary: input.summary || null,
    outcome: input.outcome || null,
    followUpNeeded: input.followUpNeeded ?? false,
    recordingUrl: input.recordingUrl || null,
    transcript: input.transcript || null,
  };
  if (existing[0]) {
    await db.update(customerInteraction).set(values).where(eq(customerInteraction.id, existing[0].id));
    return { customerId: resolved.customer.id, interactionId: existing[0].id, businessProfileId: resolved.business.id, businessName: resolved.business.businessName };
  }
  const interactionId = randomUUID();
  await db.insert(customerInteraction).values({ id: interactionId, customerId: resolved.customer.id, externalId: input.externalId, ...values });
  await db.update(customer).set({ lastContactedAt: new Date(), status: 'active', ...(input.interactionType === 'call' ? { callCount: sql`${customer.callCount} + 1` } : { messageCount: sql`${customer.messageCount} + 1` }) }).where(eq(customer.id, resolved.customer.id));
  await logCustomerActivity(resolved.customer.id, input.interactionType === 'call' ? 'phone_call' : 'sms_received', input.interactionType === 'call' ? 'Phone call received' : 'SMS received', input.conversation || input.summary);
  await createInboundCommunicationNotification({
    businessProfileId: resolved.business.id,
    customerId: resolved.customer.id,
    customerName: resolved.customer.name,
    channel: input.interactionType,
    preview: input.conversation || input.summary,
  });
  return { customerId: resolved.customer.id, interactionId, businessProfileId: resolved.business.id, businessName: resolved.business.businessName };
}

export type SmsConversationContext = {
  businessProfileId: string;
  businessName: string;
  businessType: string;
  customerName: string;
  knowledge: {
    serviceArea: string;
    businessHours: string;
    servicesOffered: string;
    pricingInformation: string;
    frequentlyAskedQuestions: string;
    policies: string;
    receptionistInstructions: string;
    discloseAutomation: boolean;
  } | null;
  bookingRules: { timezone: string; defaultDurationMinutes: number; bufferMinutes: number; allowOverlaps: boolean; maxConcurrentAppointments: number; minimumNoticeMinutes: number; bookingWindowDays: number; allowSameDay: boolean };
  history: Array<{ direction: 'inbound' | 'outbound'; content: string }>;
};

export async function getSmsConversationContext(customerId: string, excludeExternalId?: string): Promise<SmsConversationContext | null> {
  const customers = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
  const profile = customers[0];
  if (!profile) return null;

  const businesses = await db.select().from(businessProfile).where(eq(businessProfile.id, profile.businessProfileId)).limit(1);
  const business = businesses[0];
  if (!business) return null;

  const knowledgeRows = await db
    .select()
    .from(businessKnowledge)
    .where(eq(businessKnowledge.businessProfileId, business.id))
    .limit(1);
  const knowledge = knowledgeRows[0] ?? null;
  const calendar = await getCalendarSettings(business.id);

  const interactions = await db
    .select()
    .from(customerInteraction)
    .where(and(eq(customerInteraction.customerId, customerId), eq(customerInteraction.interactionType, 'sms')))
    .orderBy(desc(customerInteraction.occurredAt))
    .limit(12);

  return {
    businessProfileId: business.id,
    businessName: business.businessName,
    businessType: business.businessType,
    customerName: profile.name,
    knowledge: knowledge ? {
      serviceArea: knowledge.serviceArea,
      businessHours: knowledge.businessHours,
      servicesOffered: knowledge.servicesOffered,
      pricingInformation: knowledge.pricingInformation,
      frequentlyAskedQuestions: knowledge.frequentlyAskedQuestions,
      policies: knowledge.policies,
      receptionistInstructions: knowledge.receptionistInstructions,
      discloseAutomation: knowledge.discloseAutomation,
    } : null,
    bookingRules: {
      timezone: calendar.timezone,
      defaultDurationMinutes: calendar.defaultDurationMinutes,
      bufferMinutes: calendar.bufferMinutes,
      allowOverlaps: calendar.allowOverlaps,
      maxConcurrentAppointments: calendar.maxConcurrentAppointments,
      minimumNoticeMinutes: calendar.minimumNoticeMinutes,
      bookingWindowDays: calendar.bookingWindowDays,
      allowSameDay: calendar.allowSameDay,
    },
    history: interactions
      .filter((interaction) => interaction.externalId !== excludeExternalId)
      .reverse()
      .flatMap((interaction) => {
        const content = interaction.conversation?.trim();
        if (!content || (interaction.direction !== 'inbound' && interaction.direction !== 'outbound')) return [];
        return [{ direction: interaction.direction, content }];
      }),
  };
}

export async function getOutboundSmsReply(sourceMessageSid: string): Promise<string | null> {
  const externalId = `ai:${sourceMessageSid}`;
  const existing = await db.select().from(customerInteraction).where(eq(customerInteraction.externalId, externalId)).limit(1);
  return existing[0]?.conversation ?? null;
}

export async function recordOutboundSmsReply(customerId: string, phoneNumber: string, response: string, sourceMessageSid: string): Promise<string> {
  const externalId = `ai:${sourceMessageSid}`;
  const existing = await db.select().from(customerInteraction).where(eq(customerInteraction.externalId, externalId)).limit(1);
  if (existing[0]?.conversation) return existing[0].conversation;

  await db.insert(customerInteraction).values({
    id: randomUUID(),
    customerId,
    interactionType: 'sms',
    phoneNumber,
    direction: 'outbound',
    status: 'provider_response',
    conversation: response,
    summary: 'AI Customer Messaging response returned to the provider.',
    outcome: 'Provider response returned',
    externalId,
  });
  await db.update(customer).set({ lastContactedAt: new Date(), messageCount: sql`${customer.messageCount} + 1`, status: 'active' }).where(eq(customer.id, customerId));
  await logCustomerActivity(customerId, 'sms_provider_response', 'AI Customer Messaging response returned to provider', response);
  return response;
}

export async function updateCallInteraction(callSid: string, values: Partial<Pick<InteractionInput, 'status' | 'outcome' | 'recordingUrl' | 'transcript' | 'conversation' | 'summary' | 'followUpNeeded'>>) {
  const existing = await db.select().from(customerInteraction).where(eq(customerInteraction.externalId, callSid)).limit(1);
  if (!existing[0]) return false;
  await db.update(customerInteraction).set({ ...values }).where(eq(customerInteraction.id, existing[0].id));
  return true;
}

function escapeTwiml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

export function twimlResponse(res: Response, message?: string): void {
  const response = message
    ? `<Response><Message>${escapeTwiml(message)}</Message></Response>`
    : '<Response></Response>';
  res.status(200).type('text/xml').send(response);
}

export function voiceTwimlResponse(res: Response, businessName: string): void {
  res.status(200).type('text/xml').send(voiceTwimlDocument(businessName));
}
