import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { getChatModel } from '@/lib/chatbot/chat-config';
import { db } from '@/server/db/client.js';
import { businessKnowledge, customer, customerAppointment, customerInteraction, customerMessagingAction, customerMessagingSettings, job, phoneConnection } from '@/server/db/schema.js';
import { logCustomerActivity } from '@/server/api/customers/activity.js';
import { assertSchedulingAvailability, findNextAvailableSlots, getCalendarSettings } from '@/server/api/calendar/shared.js';
import { jobDetailsToNotes, orderDetailsToNotes, orderTitle, type OrderItem } from '@/lib/order-record.js';
import { requirePlanFeature } from '@/server/plan-access.js';

export type CustomerMessagingStatus = {
  proAccess: boolean;
  phoneConnected: boolean;
  enabled: boolean;
  ready: boolean;
  phoneNumber: string | null;
  message: string;
};

type PendingPayload =
  | { actionType: 'appointment'; title: string; scheduledAt: string; durationMinutes: number; notes: string | null }
  | { actionType: 'work'; service: string; scheduledAt: string | null; durationMinutes: number | null; address: string | null; notes: string | null; fulfillment: 'pickup' | 'delivery'; items: OrderItem[] };

const confirmationPattern = /^(yes|yep|yeah|yup|please do|go ahead|confirm|sounds good|that works|book it|do it)[.!\s]*$/i;
const declinePattern = /^(no|nope|not now|cancel|never mind|nevermind)[.!\s]*$/i;

function clean(value: unknown, maxLength = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function customerName(customerName: string, phone: string) {
  return customerName === phone ? 'the customer' : customerName;
}

function localTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value).replace(',', ' at');
}

function knowledgeHas(knowledge: string, value: string) {
  const subject = value.trim().toLowerCase();
  return subject.length > 2 && knowledge.toLowerCase().includes(subject);
}

export async function getCustomerMessagingStatus(businessProfileId: string): Promise<CustomerMessagingStatus> {
  const [access, settings, phone] = await Promise.all([
    requirePlanFeature(businessProfileId, 'ai_customer_messaging'),
    db.select().from(customerMessagingSettings).where(eq(customerMessagingSettings.businessProfileId, businessProfileId)).limit(1),
    db.select({ connectedNumber: phoneConnection.connectedNumber }).from(phoneConnection).where(and(eq(phoneConnection.businessProfileId, businessProfileId), eq(phoneConnection.status, 'connected'))).limit(1),
  ]);
  const proAccess = access.allowed;
  const phoneNumber = phone[0]?.connectedNumber ?? null;
  const enabled = Boolean(settings[0]?.enabled);
  const ready = proAccess && Boolean(phoneNumber) && enabled;
  const message = !proAccess
    ? 'AI Customer Messaging is available on the Pro plan.'
    : !phoneNumber
      ? 'Coming Soon — connect a supported business messaging number before you can activate AI Customer Messaging.'
      : enabled
        ? 'AI Customer Messaging is active for your connected business number.'
        : 'Your number is connected. Activate AI Customer Messaging when you are ready.';
  return { proAccess, phoneConnected: Boolean(phoneNumber), enabled, ready, phoneNumber, message };
}

export async function updateCustomerMessagingStatus(businessProfileId: string, enabled: boolean) {
  const status = await getCustomerMessagingStatus(businessProfileId);
  if (!status.proAccess) throw new Error('AI Customer Messaging is available on the Pro plan.');
  if (enabled && !status.phoneConnected) throw new Error('A supported business messaging number must be connected before AI Customer Messaging can be activated.');
  const existing = await db.select({ id: customerMessagingSettings.id }).from(customerMessagingSettings).where(eq(customerMessagingSettings.businessProfileId, businessProfileId)).limit(1);
  if (existing[0]) {
    await db.update(customerMessagingSettings).set({ enabled, activatedAt: enabled ? new Date() : null }).where(eq(customerMessagingSettings.id, existing[0].id));
  } else {
    await db.insert(customerMessagingSettings).values({ id: randomUUID(), businessProfileId, enabled, activatedAt: enabled ? new Date() : null });
  }
  return getCustomerMessagingStatus(businessProfileId);
}

async function latestPendingAction(customerId: string) {
  const actions = await db.select().from(customerMessagingAction)
    .where(and(eq(customerMessagingAction.customerId, customerId), eq(customerMessagingAction.status, 'pending')))
    .orderBy(desc(customerMessagingAction.createdAt)).limit(1);
  return actions[0] ?? null;
}

async function executePendingAction(action: typeof customerMessagingAction.$inferSelect, timezone: string) {
  const payload = JSON.parse(action.payload) as PendingPayload;
  if (payload.actionType === 'appointment') {
    const scheduledAt = new Date(payload.scheduledAt);
    await assertSchedulingAvailability(action.businessProfileId, scheduledAt, payload.durationMinutes);
    const appointmentId = randomUUID();
    await db.insert(customerAppointment).values({ id: appointmentId, customerId: action.customerId, title: payload.title, scheduledAt, durationMinutes: payload.durationMinutes, notes: payload.notes });
    await logCustomerActivity(action.customerId, 'appointment_booked', 'Appointment booked through AI Customer Messaging', payload.title);
    await db.update(customerMessagingAction).set({ status: 'completed', completedAt: new Date() }).where(eq(customerMessagingAction.id, action.id));
    return `You're booked for ${payload.title} on ${localTime(scheduledAt, timezone)}.`;
  }

  const foodBusiness = payload.items.length > 0;
  const id = randomUUID();
  const service = foodBusiness ? orderTitle(payload.items) : payload.service;
  const notes = foodBusiness
    ? orderDetailsToNotes({ items: payload.items, fulfillment: payload.fulfillment, total: '', notes: payload.notes ?? '' })
    : jobDetailsToNotes('', payload.notes ?? '');
  await db.insert(job).values({
    id,
    businessProfileId: action.businessProfileId,
    customerId: action.customerId,
    service,
    address: foodBusiness ? null : payload.address,
    assignedEmployee: null,
    scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt) : null,
    durationMinutes: foodBusiness ? null : payload.durationMinutes,
    status: 'booked',
    notes,
  });
  await logCustomerActivity(action.customerId, foodBusiness ? 'order_created' : 'job_created', foodBusiness ? 'Order created through AI Customer Messaging' : 'Job created through AI Customer Messaging', service);
  await db.update(customerMessagingAction).set({ status: 'completed', completedAt: new Date() }).where(eq(customerMessagingAction.id, action.id));
  return foodBusiness ? 'Your order is confirmed. We’ll follow up if we need anything else.' : 'Your job is confirmed. We’ll follow up with any next details.';
}

export async function replyToCustomerMessage(input: { businessProfileId: string; customerId: string; sourceMessageSid: string; message: string; phoneNumber: string }) {
  const status = await getCustomerMessagingStatus(input.businessProfileId);
  if (!status.ready) return null;
  const [profile, savedKnowledge, settings] = await Promise.all([
    db.select().from(customer).where(eq(customer.id, input.customerId)).limit(1),
    db.select().from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, input.businessProfileId)).limit(1),
    getCalendarSettings(input.businessProfileId),
  ]);
  const currentCustomer = profile[0];
  if (!currentCustomer) return null;
  const pending = await latestPendingAction(input.customerId);
  if (pending && confirmationPattern.test(input.message)) {
    try {
      return await executePendingAction(pending, settings.timezone);
    } catch {
      const payload = JSON.parse(pending.payload) as PendingPayload;
      if (payload.actionType === 'appointment') {
        const alternatives = await findNextAvailableSlots(input.businessProfileId, new Date(payload.scheduledAt), payload.durationMinutes);
        const labels = alternatives.map((slot) => localTime(slot, settings.timezone));
        return labels.length ? `That time is no longer available. I have ${labels.join(', ')}. Which works best?` : 'That time is no longer available. What other day or time works for you?';
      }
      return 'I couldn’t confirm that yet. A team member will follow up.';
    }
  }
  if (pending && declinePattern.test(input.message)) {
    await db.update(customerMessagingAction).set({ status: 'cancelled' }).where(eq(customerMessagingAction.id, pending.id));
    return 'No problem. What would you like to do instead?';
  }

  const history = await db.select({ direction: customerInteraction.direction, conversation: customerInteraction.conversation })
    .from(customerInteraction).where(and(eq(customerInteraction.customerId, input.customerId), eq(customerInteraction.interactionType, 'sms')))
    .orderBy(desc(customerInteraction.occurredAt)).limit(10);
  const knowledge = savedKnowledge[0];
  const knowledgeText = knowledge ? [knowledge.serviceArea, knowledge.businessHours, knowledge.servicesOffered, knowledge.pricingInformation, knowledge.frequentlyAskedQuestions, knowledge.policies, knowledge.receptionistInstructions].join('\n') : '';
  const result = await generateText({
    model: getChatModel(),
    stopWhen: stepCountIs(5),
    system: `You reply to a customer by SMS on behalf of a business. Keep replies under 360 characters, natural, concise, and direct. Never say you are AI unless disclosure is required. Use only confirmed business knowledge, the conversation, and tool results. Never invent prices, services, products, availability, policies, appointment times, or order details. Never say an action is booked or confirmed until the customer explicitly confirms a prepared action and the system has completed it. Ask one clear question when a required fact is missing. ${knowledge?.discloseAutomation ? 'Start the first reply with: “I’m the automated assistant for the business.”' : ''}`,
    prompt: `Customer: ${customerName(currentCustomer.name, input.phoneNumber)}\nBusiness knowledge:\n${knowledgeText || '(No saved business knowledge.)'}\n\nRecent conversation:\n${history.reverse().map((item) => `${item.direction === 'outbound' ? 'Business' : 'Customer'}: ${item.conversation ?? ''}`).join('\n')}\n\nNewest customer message: ${input.message}`,
    tools: {
      checkAvailability: tool({
        description: 'Check an exact requested appointment time against real calendar availability and business scheduling rules. Use before offering or preparing a booking.',
        inputSchema: z.object({ scheduledAt: z.string().datetime(), durationMinutes: z.number().int().min(15).max(480) }),
        execute: async ({ scheduledAt, durationMinutes }) => {
          const requested = new Date(scheduledAt);
          try {
            await assertSchedulingAvailability(input.businessProfileId, requested, durationMinutes);
            return { available: true, time: localTime(requested, settings.timezone) };
          } catch {
            const alternatives = await findNextAvailableSlots(input.businessProfileId, requested, durationMinutes);
            return { available: false, alternatives: alternatives.map((slot) => localTime(slot, settings.timezone)) };
          }
        },
      }),
      prepareAppointment: tool({
        description: 'Prepare an appointment for explicit customer confirmation only after availability has been checked and the customer has supplied the service and exact time.',
        inputSchema: z.object({ title: z.string().min(2).max(255), scheduledAt: z.string().datetime(), durationMinutes: z.number().int().min(15).max(480), notes: z.string().max(2000).optional() }),
        execute: async ({ title, scheduledAt, durationMinutes, notes }) => {
          if (!knowledge || !knowledgeHas(knowledgeText, title)) return { prepared: false, message: 'That service is not confirmed in the business knowledge.' };
          const existing = await latestPendingAction(input.customerId);
          if (existing) await db.update(customerMessagingAction).set({ status: 'superseded' }).where(eq(customerMessagingAction.id, existing.id));
          const action = { actionType: 'appointment' as const, title, scheduledAt, durationMinutes, notes: notes?.trim() || null };
          await db.insert(customerMessagingAction).values({ id: randomUUID(), businessProfileId: input.businessProfileId, customerId: input.customerId, sourceExternalId: `appointment:${input.sourceMessageSid}`, actionType: action.actionType, payload: JSON.stringify(action) });
          return { prepared: true, confirmation: `Would you like me to book ${title} for ${localTime(new Date(scheduledAt), settings.timezone)}?` };
        },
      }),
      prepareWork: tool({
        description: 'Prepare a service job or food order for explicit customer confirmation. Only use exact services or items found in the business knowledge. Never include a price unless the customer explicitly supplied it and it is present in business knowledge.',
        inputSchema: z.object({ service: z.string().min(2).max(255), items: z.array(z.object({ name: z.string().min(1).max(255), quantity: z.number().int().min(1).max(99) })).max(20).default([]), address: z.string().max(1000).optional(), notes: z.string().max(2000).optional(), fulfillment: z.enum(['pickup', 'delivery']).default('pickup') }),
        execute: async ({ service, items, address, notes, fulfillment }) => {
          const validService = knowledge && knowledgeHas(knowledgeText, service);
          const validItems = items.every((item) => knowledge && knowledgeHas(knowledgeText, item.name));
          if ((!items.length && !validService) || (items.length > 0 && !validItems)) return { prepared: false, message: 'The requested service or item is not confirmed in the business knowledge.' };
          const action = { actionType: 'work' as const, service, scheduledAt: null, durationMinutes: null, address: address?.trim() || null, notes: notes?.trim() || null, fulfillment, items };
          await db.insert(customerMessagingAction).values({ id: randomUUID(), businessProfileId: input.businessProfileId, customerId: input.customerId, sourceExternalId: `work:${input.sourceMessageSid}`, actionType: action.actionType, payload: JSON.stringify(action) });
          return { prepared: true, confirmation: items.length ? `Would you like me to confirm this ${fulfillment} order?` : `Would you like me to create this job for ${service}?` };
        },
      }),
    },
  });
  const reply = clean(result.text, 480);
  return reply || 'Thanks for reaching out. A team member will follow up shortly.';
}
