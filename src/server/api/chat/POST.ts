import type { Request, Response } from 'express';
import { and, asc, desc, eq, gte, like, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { getChatModel, isChatConfigured, SYSTEM_PROMPT } from '@/lib/chatbot/chat-config';
import { getTenant } from '@/server/api/customers/tenant.js';
import { db } from '@/server/db/client.js';
import { businessKnowledge, businessKnowledgeSource, businessNotification, businessProfile, customer, customerActivity, customerAppointment, customerConversation, customerInteraction, customerNote, estimate, invoice, job, lead, marketingProfile, payment } from '@/server/db/schema.js';
import { createAppointmentChangeNotification } from '@/server/appointment-notifications.js';
import { logCustomerActivity } from '@/server/api/customers/activity.js';
import { assertSchedulingAvailability, findNextAvailableSlots, getCalendarSettings } from '@/server/api/calendar/shared.js';
import { jobDetailsFromNotes, orderDetailsFromNotes } from '@/lib/order-record.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { getPilotBusinessContext } from '@/server/pilot/business-context.js';
import { createActionTools } from '@/server/pilot/action-tools.js';
import { pilotDateRange, type PilotDatePeriod } from '@/server/pilot/time-context.js';
import { learnFromOwnerMessage, pilotFactKinds, searchPilotLearning } from '@/server/pilot/learning.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function dayRange(timezone: string, period: Extract<PilotDatePeriod, 'today' | 'tomorrow'>) {
  const range = pilotDateRange(period, timezone);
  if (!range.start || !range.end) throw new Error('A bounded daily date range is required.');
  return { start: range.start, end: range.end };
}

function parseRequestedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPilotDateTime(date: Date, timezone: string, includeDate = true) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    ...(includeDate ? { weekday: 'long', month: 'long', day: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
  }).format(date).replace(',', ' at');
}

function formatPilotTime(date: Date, timezone: string) {
  return formatPilotDateTime(date, timezone, false);
}

function websiteExcerpt(content: string, query: string) {
  const words = query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  const index = words.map((word) => content.toLowerCase().indexOf(word)).find((position) => position >= 0) ?? 0;
  return content.slice(Math.max(0, index - 900), index + 5000);
}

const websiteStopWords = new Set(['about', 'also', 'and', 'are', 'business', 'can', 'does', 'for', 'from', 'have', 'how', 'into', 'its', 'know', 'like', 'more', 'my', 'our', 'please', 'tell', 'that', 'the', 'their', 'there', 'these', 'this', 'what', 'when', 'where', 'which', 'with', 'would', 'you', 'your']);

function websiteSearchTerms(value: string) {
  return [...new Set((value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((word) => !websiteStopWords.has(word)))].slice(0, 8);
}

async function websiteKnowledgeContext(businessProfileId: string, message: string) {
  const terms = websiteSearchTerms(message);
  const condition = terms.length ? or(...terms.map((term) => like(businessKnowledgeSource.content, `%${term}%`))) : undefined;
  const matches = await db.select({ sourceUrl: businessKnowledgeSource.sourceUrl, content: businessKnowledgeSource.content })
    .from(businessKnowledgeSource)
    .where(condition ? and(eq(businessKnowledgeSource.businessProfileId, businessProfileId), condition) : eq(businessKnowledgeSource.businessProfileId, businessProfileId))
    .orderBy(desc(businessKnowledgeSource.importedAt)).limit(4);
  if (!matches.length) return '';
  return `\n\nRelevant imported website pages (authoritative website text for the current question):\n${matches.map((match) => `Source: ${match.sourceUrl}\n${websiteExcerpt(match.content, message)}`).join('\n\n').slice(0, 14000)}`;
}


function isBusinessWideQuestion(message: string) {
  return /\b(?:what should i pay attention to|what do you know|what products do you know i (?:sell|offer)|based on (?:the )?information|business overview|business insights)\b/i.test(message);
}

function learnedFactsContext(facts: Awaited<ReturnType<typeof searchPilotLearning>>, query: string) {
  if (!facts.length) return `\n\nConfirmed learned facts relevant to the owner's question: none. Do not invent a value; say plainly that no confirmed learned fact answers this question.`;
  const rows = facts.map((fact) => `${fact.kind} | ${fact.subject} | ${fact.predicate}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}${fact.details ? ` (${fact.details})` : ''}`).join('\n');
  return `\n\nConfirmed learned facts relevant to the owner's question (“${query.slice(0, 500)}”):\n${rows}\nUse these confirmed facts directly when answering. They are document-reviewed business knowledge, not live operational records. Do not present a documented inventory observation as current stock.`;
}
export default async function handler(req: Request, res: Response) {
  const requestId = randomUUID();
  const messages = req.body?.messages as ChatMessage[] | undefined;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing or invalid messages array', requestId });
    return;
  }

  const tenant = await getTenant(req, res);
  if (!tenant) return;
  const access = await requirePlanFeature(tenant.id, 'pilot_assistant');
  if (!access.allowed) {
    res.status(403).json({ error: access.error, upgradeRequired: true, requestId });
    return;
  }

  if (!isChatConfigured()) {
    console.error(JSON.stringify({ event: 'business-assistant.not-configured', requestId, tenantId: tenant.id, error: 'OPENAI_API_KEY is not set.' }));
    res.status(503).json({ error: 'Pilot chat is not set up yet. An OpenAI API key needs to be added to this app’s settings.', setupRequired: true, requestId });
    return;
  }

  const safeMessages = messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-12)
    .map((message) => ({ ...message, content: message.content.slice(0, 3000) }));
  if (!safeMessages.length) {
    res.status(400).json({ error: 'Add a message before asking Pilot.', requestId });
    return;
  }

  console.info(JSON.stringify({ event: 'business-assistant.request', requestId, tenantId: tenant.id, messageCount: safeMessages.length }));

  try {
    const model = getChatModel();
    const tenantCustomer = eq(customer.businessProfileId, tenant.id);
    const [savedKnowledge, approvedMarketingProfile] = await Promise.all([
      db.select({ serviceArea: businessKnowledge.serviceArea, businessHours: businessKnowledge.businessHours, servicesOffered: businessKnowledge.servicesOffered, pricingInformation: businessKnowledge.pricingInformation, frequentlyAskedQuestions: businessKnowledge.frequentlyAskedQuestions, policies: businessKnowledge.policies, receptionistInstructions: businessKnowledge.receptionistInstructions })
        .from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, tenant.id)).limit(1).then((rows) => rows[0]),
      db.select({ businessName: marketingProfile.businessName, businessDescription: marketingProfile.businessDescription, location: marketingProfile.location, contactPhone: marketingProfile.contactPhone, contactEmail: marketingProfile.contactEmail, businessHours: marketingProfile.businessHours, services: marketingProfile.services, products: marketingProfile.products, pricing: marketingProfile.pricing, targetCustomers: marketingProfile.targetCustomers, customerNeeds: marketingProfile.customerNeeds, brandTone: marketingProfile.brandTone, brandDescription: marketingProfile.brandDescription, brandColors: marketingProfile.brandColors, promotions: marketingProfile.promotions, keySellingPoints: marketingProfile.keySellingPoints, frequentlyAskedQuestions: marketingProfile.frequentlyAskedQuestions, importantNotes: marketingProfile.importantNotes })
        .from(marketingProfile).where(and(eq(marketingProfile.businessProfileId, tenant.id), eq(marketingProfile.approvalStatus, 'confirmed'))).limit(1).then((rows) => rows[0]),
    ]);
    const knowledgeContext = savedKnowledge ? `\n\nSaved Business Knowledge (use this before saying information is unavailable):\n${JSON.stringify(savedKnowledge).slice(0, 18000)}` : '';
    const officialProfileContext = approvedMarketingProfile ? `\n\nOfficial Business Profile — owner confirmed this is the source of truth for marketing and business details. Never advertise, recommend, or imply an offering that is not present here. When it conflicts with website text or unconfirmed extracted data, use this approved profile:\n${JSON.stringify(approvedMarketingProfile).slice(0, 18000)}` : '';
    const latestUserMessage = [...safeMessages].reverse().find((message) => message.role === 'user')?.content ?? '';
    const [learnedFacts, importedWebsiteContext] = await Promise.all([
      searchPilotLearning(tenant.id, isBusinessWideQuestion(latestUserMessage) ? '' : latestUserMessage),
      websiteKnowledgeContext(tenant.id, latestUserMessage),
    ]);
    const confirmedLearningContext = learnedFactsContext(learnedFacts, latestUserMessage);

    const result = streamText({
      model,
      system: `${SYSTEM_PROMPT.replace('{{businessName}}', tenant.businessName)}${knowledgeContext}${officialProfileContext}${confirmedLearningContext}${importedWebsiteContext}`,
      messages: safeMessages,
      // Tool-enabled conversations require more than one model step: one step to
      // request a tool and another to turn its tenant-scoped result into a reply.
      // AI SDK 7 uses stopWhen rather than the former maxSteps option.
      stopWhen: stepCountIs(6),
      onError: ({ error }) => {
        const message = error instanceof Error ? error.message : 'Unknown streaming error';
        console.error(JSON.stringify({ event: 'business-assistant.stream-error', requestId, tenantId: tenant.id, error: message }));
      },
      onFinish: () => {
        console.info(JSON.stringify({ event: 'business-assistant.completed', requestId, tenantId: tenant.id }));
      },
      tools: {
        // Actions that change data or send something: each asks for confirmation and reports only real results.
        ...createActionTools({ tenantId: tenant.id, businessName: tenant.businessName, request: req }),
        learnBusinessFacts: tool({
          description: 'Use when the owner explicitly gives durable business information for Pilot to remember: offerings, prices, resource requirements, suppliers or lead times, operating rules, processes, or observations. Extract only what the owner stated in the newest message. Never infer missing quantities, units, prices, supplier details, dates, or rules. This saves owner-provided facts only; it cannot change prices, inventory, schedules, financial records, or any other business data. Duplicate facts are skipped and conflicting facts are held for owner review rather than overwritten.',
          inputSchema: z.object({
            facts: z.array(z.object({
              kind: z.enum(pilotFactKinds),
              subject: z.string().min(1).max(255),
              predicate: z.string().min(1).max(100),
              value: z.string().min(1).max(4000),
              unit: z.string().max(120).optional(),
              details: z.string().max(6000).optional(),
              evidence: z.string().min(1).max(1000),
            })).min(1).max(12),
          }),
          execute: async ({ facts }) => learnFromOwnerMessage(tenant.id, latestUserMessage, facts),
        }),
        searchPilotLearning: tool({
          description: 'Search previously accepted facts that Pilot learned from the owner. Use this before saying learned products, services, recipes, material requirements, suppliers, lead times, business rules, or processes are unavailable. Treat pending or conflicting facts as unconfirmed.',
          inputSchema: z.object({ query: z.string().min(1).max(500) }),
          execute: async ({ query }) => ({ facts: await searchPilotLearning(tenant.id, query) }),
        }),
        getBusinessContext: tool({
          description: 'Retrieve authoritative, tenant-scoped connected business context. Use this first for work by date period (today, tomorrow, yesterday, this week, next week, past, future, upcoming, or overdue), customer history, employees, jobs or orders, leads, invoices, payments, quotes, inventory, business settings, or the proactive business briefing. Dates are resolved in the business timezone. The result is business-type-aware and must be treated as the source of truth; ask a concise clarification instead of guessing when it reports more than one customer or employee match.',
          inputSchema: z.object({
            topic: z.enum(['today_schedule', 'tomorrow_schedule', 'yesterday_schedule', 'this_week_schedule', 'next_week_schedule', 'past_schedule', 'future_schedule', 'upcoming_schedule', 'overdue_schedule', 'customer_overview', 'customer_history', 'employee_lookup', 'jobs_orders', 'leads', 'finance', 'unpaid_invoices', 'payments', 'accepted_quotes', 'accepted_quotes_unscheduled', 'inventory', 'business_settings', 'pilot_learning', 'proactive_briefing']),
            customerName: z.string().min(1).max(120).optional(),
            employeeName: z.string().min(1).max(120).optional(),
          }),
          execute: async ({ topic, customerName, employeeName }) => getPilotBusinessContext(tenant, topic, { customerName, employeeName }),
        }),
        searchImportedWebsiteKnowledge: tool({
          description: 'Search saved content imported from the business website and connected online menu or ordering pages. Always use this before saying website-derived prices, products, menu details, hours, policies, ordering, delivery, or contact information is unavailable.',
          inputSchema: z.object({ query: z.string().min(1).max(160) }),
          execute: async ({ query }) => {
            const words = websiteSearchTerms(query);
            const matches = words.length
              ? await db.select({ sourceUrl: businessKnowledgeSource.sourceUrl, content: businessKnowledgeSource.content, importedAt: businessKnowledgeSource.importedAt })
                .from(businessKnowledgeSource)
                .where(and(eq(businessKnowledgeSource.businessProfileId, tenant.id), or(...words.map((word) => like(businessKnowledgeSource.content, `%${word}%`)))))
                .orderBy(desc(businessKnowledgeSource.importedAt)).limit(8)
              : [];
            return {
              query,
              matchedPages: matches.map((match) => ({ sourceUrl: match.sourceUrl, excerpt: websiteExcerpt(match.content, query), importedAt: match.importedAt })),
              message: matches.length ? 'Use only facts stated in these excerpts and cite the source URL only if the owner asks where it came from.' : 'No saved imported website page matched that search.',
            };
          },
        }),
        getDailyBriefing: tool({
          description: 'Get a concise, current briefing for today: appointments, new customers, calls, messages, and unread attention items.',
          inputSchema: z.object({}),
          execute: async () => {
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            const { start, end } = dayRange(timezone, 'today');
            const weekStart = pilotDateRange('this_week', timezone).start ?? start;
            const [todayAppointments, newCustomers, callTotals, unreadNotifications] = await Promise.all([
              db.select({ title: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, status: customerAppointment.status, customerName: customer.name })
                .from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id))
                .where(and(tenantCustomer, gte(customerAppointment.scheduledAt, start), lt(customerAppointment.scheduledAt, end), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`))
                .orderBy(asc(customerAppointment.scheduledAt)),
              db.select({ count: sql<number>`count(*)` }).from(customer).where(and(tenantCustomer, gte(customer.createdAt, weekStart))),
              db.select({ calls: sql<number>`coalesce(sum(${customer.callCount}), 0)`, messages: sql<number>`coalesce(sum(${customer.messageCount}), 0)` }).from(customer).where(tenantCustomer),
              db.select({ title: businessNotification.title, detail: businessNotification.detail, customerName: customer.name, createdAt: businessNotification.createdAt })
                .from(businessNotification).innerJoin(customer, eq(businessNotification.customerId, customer.id))
                .where(and(eq(businessNotification.businessProfileId, tenant.id), sql`${businessNotification.readAt} IS NULL`))
                .orderBy(desc(businessNotification.createdAt)).limit(5),
            ]);
            return {
              businessName: tenant.businessName,
              todayAppointments: todayAppointments.map((appointment) => ({ ...appointment, scheduledAt: formatPilotTime(appointment.scheduledAt, timezone) })),
              newCustomersThisWeek: Number(newCustomers[0]?.count || 0),
              callsHandled: Number(callTotals[0]?.calls || 0),
              messagesHandled: Number(callTotals[0]?.messages || 0),
              needsAttention: unreadNotifications,
            };
          },
        }),
        getAppointments: tool({
          description: 'Get appointments for today, tomorrow, or a specified number of upcoming days.',
          inputSchema: z.object({ day: z.enum(['today', 'tomorrow', 'upcoming']).describe('Which appointment period to inspect') }),
          execute: async ({ day }) => {
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            const period = day === 'upcoming' ? 'upcoming' : day;
            const range = pilotDateRange(period, timezone);
            if (!range.start || !range.end) throw new Error('A bounded appointment range is required.');
            const appointments = await db.select({ title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, customerName: customer.name, customerPhone: customer.phoneNumber })
              .from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id))
              .where(and(tenantCustomer, gte(customerAppointment.scheduledAt, range.start), lt(customerAppointment.scheduledAt, range.end), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`))
              .orderBy(asc(customerAppointment.scheduledAt));
            return {
              period: day,
              appointments: appointments.map((appointment) => ({
                ...appointment,
                scheduledAt: formatPilotDateTime(appointment.scheduledAt, timezone),
              })),
            };
          },
        }),
        getFollowUps: tool({
          description: 'Find customer conversations and notifications that need an owner follow-up.',
          inputSchema: z.object({}),
          execute: async () => {
            const [interactions, notifications] = await Promise.all([
              db.select({ customerName: customer.name, summary: customerInteraction.summary, conversation: customerInteraction.conversation, occurredAt: customerInteraction.occurredAt, outcome: customerInteraction.outcome })
                .from(customerInteraction).innerJoin(customer, eq(customerInteraction.customerId, customer.id))
                .where(and(tenantCustomer, eq(customerInteraction.followUpNeeded, true)))
                .orderBy(desc(customerInteraction.occurredAt)).limit(20),
              db.select({ customerName: customer.name, title: businessNotification.title, detail: businessNotification.detail, createdAt: businessNotification.createdAt })
                .from(businessNotification).innerJoin(customer, eq(businessNotification.customerId, customer.id))
                .where(and(eq(businessNotification.businessProfileId, tenant.id), sql`${businessNotification.readAt} IS NULL`))
                .orderBy(desc(businessNotification.createdAt)).limit(20),
            ]);
            return { followUpInteractions: interactions, unreadNotifications: notifications };
          },
        }),
        searchCustomers: tool({
          description: 'Search the business customer list by a customer name, email, or phone number.',
          inputSchema: z.object({ query: z.string().min(1).max(80) }),
          execute: async ({ query }) => {
            const needle = `%${query.trim()}%`;
            const customers = await db.select({ id: customer.id, name: customer.name, phoneNumber: customer.phoneNumber, email: customer.email, status: customer.status, lastContactedAt: customer.lastContactedAt, callCount: customer.callCount, messageCount: customer.messageCount })
              .from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, or(like(customer.name, needle), like(customer.email, needle), like(customer.phoneNumber, needle))))
              .orderBy(desc(customer.lastContactedAt)).limit(10);
            return { customers };
          },
        }),
        getNewestCustomers: tool({
          description: 'Get the most recently added active customers. Use for newest or recent customer questions.',
          inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
          execute: async ({ limit }) => {
            const customers = await db.select({ name: customer.name, email: customer.email, phoneNumber: customer.phoneNumber, status: customer.status, createdAt: customer.createdAt })
              .from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`)).orderBy(desc(customer.createdAt)).limit(limit);
            return { customers };
          },
        }),
        getCustomerSummary: tool({
          description: 'Get an individual customer record and history using a customer name. Use this for questions about a customer’s last order, upcoming pickup or appointment, repeat customer status, quotes, invoices, payments, or messages.',
          inputSchema: z.object({ name: z.string().min(1).max(120) }),
          execute: async ({ name }) => {
            const matches = await db.select({ id: customer.id, name: customer.name, phoneNumber: customer.phoneNumber, email: customer.email, address: customer.address, status: customer.status, lastContactedAt: customer.lastContactedAt, callCount: customer.callCount, messageCount: customer.messageCount })
              .from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${name.trim()}%`))).orderBy(desc(customer.lastContactedAt)).limit(5);
            const customerIds = matches.map((match) => match.id);
            if (!customerIds.length) return { customers: [], appointments: [], orders: [], estimates: [], invoices: [], payments: [], interactions: [] };
            const [appointments, orders, estimates, invoices, payments, interactions] = await Promise.all([
              db.select({ customerId: customerAppointment.customerId, title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, notes: customerAppointment.notes })
                .from(customerAppointment).where(sql`${customerAppointment.customerId} IN ${customerIds}`).orderBy(desc(customerAppointment.scheduledAt)).limit(20),
              db.select({ customerId: job.customerId, title: job.service, status: job.status, pickupAt: job.scheduledAt, notes: job.notes, createdAt: job.createdAt })
                .from(job).where(and(eq(job.businessProfileId, tenant.id), sql`${job.customerId} IN ${customerIds}`)).orderBy(desc(job.scheduledAt)).limit(20),
              db.select({ customerId: estimate.customerId, status: estimate.status, total: estimate.total, notes: estimate.notes, createdAt: estimate.createdAt })
                .from(estimate).where(and(eq(estimate.businessProfileId, tenant.id), sql`${estimate.customerId} IN ${customerIds}`)).orderBy(desc(estimate.createdAt)).limit(20),
              db.select({ customerId: invoice.customerId, status: invoice.status, total: invoice.total, notes: invoice.notes, dueAt: invoice.dueAt, createdAt: invoice.createdAt })
                .from(invoice).where(and(eq(invoice.businessProfileId, tenant.id), sql`${invoice.customerId} IN ${customerIds}`)).orderBy(desc(invoice.createdAt)).limit(20),
              db.select({ customerId: payment.customerId, status: payment.status, amount: payment.amount, method: payment.method, receivedAt: payment.receivedAt, createdAt: payment.createdAt })
                .from(payment).where(and(eq(payment.businessProfileId, tenant.id), sql`${payment.customerId} IN ${customerIds}`)).orderBy(desc(payment.receivedAt)).limit(20),
              db.select({ customerId: customerInteraction.customerId, interactionType: customerInteraction.interactionType, direction: customerInteraction.direction, summary: customerInteraction.summary, conversation: customerInteraction.conversation, followUpNeeded: customerInteraction.followUpNeeded, occurredAt: customerInteraction.occurredAt })
                .from(customerInteraction).where(sql`${customerInteraction.customerId} IN ${customerIds}`).orderBy(desc(customerInteraction.occurredAt)).limit(20),
            ]);
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            return {
              customers: matches,
              appointments: appointments.map((appointment) => ({
                ...appointment,
                scheduledAt: formatPilotDateTime(appointment.scheduledAt, timezone),
              })),
              orders: orders.map((order) => ({
                ...order,
                ...(isFoodBusiness(tenant.businessType) ? orderDetailsFromNotes(order.notes) : jobDetailsFromNotes(order.notes)),
                pickupAt: order.pickupAt ? formatPilotDateTime(order.pickupAt, timezone) : null,
              })),
              estimates,
              invoices,
              payments,
              interactions,
            };
          },
        }),
        getInactiveCustomers: tool({
          description: 'Find active customers who have not contacted the business or booked recently for the requested number of months.',
          inputSchema: z.object({ months: z.number().int().min(1).max(24).default(6) }),
          execute: async ({ months }) => {
            const cutoff = new Date();
            cutoff.setMonth(cutoff.getMonth() - months);
            const customers = await db.select({ name: customer.name, phoneNumber: customer.phoneNumber, email: customer.email, status: customer.status, lastContactedAt: customer.lastContactedAt })
              .from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, lt(customer.lastContactedAt, cutoff))).orderBy(asc(customer.lastContactedAt)).limit(50);
            return { months, customers };
          },
        }),
        getNewCustomerCount: tool({
          description: 'Count customers created in the current calendar month for the authenticated business.',
          inputSchema: z.object({}),
          execute: async () => {
            const start = new Date();
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            const rows = await db.select({ count: sql<number>`count(*)` }).from(customer).where(and(tenantCustomer, gte(customer.createdAt, start)));
            return { newCustomersThisMonth: Number(rows[0]?.count || 0) };
          },
        }),
        getCustomerMessages: tool({
          description: 'Read recent messages for one clearly identified customer.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120) }),
          execute: async ({ customerName }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            const messages = await db.select({ channel: customerConversation.channel, direction: customerConversation.direction, content: customerConversation.content, occurredAt: customerConversation.occurredAt }).from(customerConversation).where(eq(customerConversation.customerId, matches[0].id)).orderBy(desc(customerConversation.occurredAt)).limit(20);
            return { customerName: matches[0].name, messages };
          },
        }),
        addCustomerNote: tool({
          description: 'Save a note to a customer profile only when the owner explicitly asks, the customer is uniquely identified, and the owner has confirmed the exact note in this conversation.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120), note: z.string().min(1).max(2000), confirmed: z.boolean().default(false) }),
          execute: async ({ customerName, note, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            if (!confirmed) return { ok: false, needsConfirmation: true, customerName: matches[0].name, proposedNote: note, message: 'Ask the owner to confirm before saving this customer note.' };
            await db.insert(customerNote).values({ id: randomUUID(), customerId: matches[0].id, body: note.trim() });
            await logCustomerActivity(matches[0].id, 'customer_note_added', 'Pilot added a customer note', note.trim());
            return { ok: true, customerName: matches[0].name, message: 'Customer note saved.' };
          },
        }),
        updateCustomer: tool({
          description: 'Update a customer name, email, address, or status only after the owner confirms the exact change.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120), updates: z.object({ name: z.string().min(1).max(255).optional(), email: z.string().email().optional(), address: z.string().max(1000).optional(), status: z.enum(['new', 'active', 'inactive', 'returning']).optional() }), confirmed: z.boolean().default(false) }),
          execute: async ({ customerName, updates, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            if (!Object.keys(updates).length) return { ok: false, message: 'No customer updates were supplied.' };
            if (!confirmed) return { ok: false, needsConfirmation: true, customerName: matches[0].name, proposedUpdates: updates, message: 'Ask the owner to confirm before changing this customer record.' };
            await db.update(customer).set(updates).where(eq(customer.id, matches[0].id));
            await logCustomerActivity(matches[0].id, 'customer_updated', 'Pilot updated customer information', JSON.stringify(updates));
            return { ok: true, customerName: matches[0].name, message: 'Customer information updated.' };
          },
        }),
        searchBusinessKnowledge: tool({
          description: 'Search the authenticated business’s saved knowledge before answering questions about products, services, menu items, descriptions, prices, FAQs, policies, ordering, delivery, pickup, hours, location, or other business-specific information.',
          inputSchema: z.object({ query: z.string().min(1).max(500) }),
          execute: async ({ query }) => {
            const [profile] = await db.select({ businessName: businessProfile.businessName, businessType: businessProfile.businessType, address: businessProfile.address, city: businessProfile.city, region: businessProfile.region, postalCode: businessProfile.postalCode, website: businessProfile.website })
              .from(businessProfile).where(eq(businessProfile.id, tenant.id)).limit(1);
            const [knowledge, officialProfile] = await Promise.all([
              db.select({ serviceArea: businessKnowledge.serviceArea, businessHours: businessKnowledge.businessHours, servicesOffered: businessKnowledge.servicesOffered, pricingInformation: businessKnowledge.pricingInformation, frequentlyAskedQuestions: businessKnowledge.frequentlyAskedQuestions, policies: businessKnowledge.policies, receptionistInstructions: businessKnowledge.receptionistInstructions })
                .from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, tenant.id)).limit(1).then((rows) => rows[0]),
              db.select({ businessName: marketingProfile.businessName, services: marketingProfile.services, products: marketingProfile.products, pricing: marketingProfile.pricing, businessHours: marketingProfile.businessHours, frequentlyAskedQuestions: marketingProfile.frequentlyAskedQuestions, importantNotes: marketingProfile.importantNotes })
                .from(marketingProfile).where(and(eq(marketingProfile.businessProfileId, tenant.id), eq(marketingProfile.approvalStatus, 'confirmed'))).limit(1).then((rows) => rows[0]),
            ]);
            if (!knowledge && !officialProfile) return { found: false, query, message: 'No saved business knowledge is available yet.' };
            return { found: true, query, profile, officialProfile: officialProfile || null, knowledge: knowledge || null };
          },
        }),
        getBusinessInformation: tool({
          description: 'Get the authenticated business profile, service information, and current booking settings.',
          inputSchema: z.object({}),
          execute: async () => {
            const [profile] = await db.select({ businessName: businessProfile.businessName, businessType: businessProfile.businessType, phoneNumber: businessProfile.phoneNumber, businessEmail: businessProfile.businessEmail, address: businessProfile.address, city: businessProfile.city, region: businessProfile.region, postalCode: businessProfile.postalCode, website: businessProfile.website })
              .from(businessProfile).where(eq(businessProfile.id, tenant.id)).limit(1);
            const [knowledge, officialProfile, settings] = await Promise.all([
              db.select({ serviceArea: businessKnowledge.serviceArea, businessHours: businessKnowledge.businessHours, servicesOffered: businessKnowledge.servicesOffered, pricingInformation: businessKnowledge.pricingInformation, frequentlyAskedQuestions: businessKnowledge.frequentlyAskedQuestions, policies: businessKnowledge.policies, receptionistInstructions: businessKnowledge.receptionistInstructions })
                .from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, tenant.id)).limit(1).then((rows) => rows[0]),
              db.select({ businessName: marketingProfile.businessName, businessDescription: marketingProfile.businessDescription, location: marketingProfile.location, contactPhone: marketingProfile.contactPhone, contactEmail: marketingProfile.contactEmail, businessHours: marketingProfile.businessHours, services: marketingProfile.services, products: marketingProfile.products, pricing: marketingProfile.pricing, targetCustomers: marketingProfile.targetCustomers, brandTone: marketingProfile.brandTone, promotions: marketingProfile.promotions, keySellingPoints: marketingProfile.keySellingPoints, frequentlyAskedQuestions: marketingProfile.frequentlyAskedQuestions, importantNotes: marketingProfile.importantNotes })
                .from(marketingProfile).where(and(eq(marketingProfile.businessProfileId, tenant.id), eq(marketingProfile.approvalStatus, 'confirmed'))).limit(1).then((rows) => rows[0]),
              getCalendarSettings(tenant.id),
            ]);
            return { profile, officialProfile: officialProfile || null, knowledge: knowledge || null, booking: { timezone: settings.timezone, weeklyHours: settings.weeklyHours, defaultDurationMinutes: settings.defaultDurationMinutes, minimumNoticeMinutes: settings.minimumNoticeMinutes, bookingWindowDays: settings.bookingWindowDays } };
          },
        }),
        getBusinessInsights: tool({
          description: 'Get current record-backed customer, appointment, communication, and follow-up counts for the authenticated business. Revenue is not inferred.',
          inputSchema: z.object({}),
          execute: async () => {
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            const today = dayRange(timezone, 'today');
            const activeCustomer = and(tenantCustomer, sql`${customer.archivedAt} IS NULL`);
            const [customers, upcomingAppointments, appointmentsToday, messagesToday, followUps] = await Promise.all([
              db.select({ count: sql<number>`count(*)` }).from(customer).where(activeCustomer),
              db.select({ count: sql<number>`count(*)` }).from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(activeCustomer, gte(customerAppointment.scheduledAt, new Date()), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)),
              db.select({ count: sql<number>`count(*)` }).from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(activeCustomer, gte(customerAppointment.scheduledAt, today.start), lt(customerAppointment.scheduledAt, today.end), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)),
              db.select({ count: sql<number>`count(*)` }).from(customerConversation).innerJoin(customer, eq(customerConversation.customerId, customer.id)).where(and(activeCustomer, gte(customerConversation.occurredAt, today.start), lt(customerConversation.occurredAt, today.end))),
              db.select({ count: sql<number>`count(*)` }).from(customerInteraction).innerJoin(customer, eq(customerInteraction.customerId, customer.id)).where(and(activeCustomer, eq(customerInteraction.followUpNeeded, true))),
            ]);
            return { activeCustomers: Number(customers[0]?.count || 0), upcomingAppointments: Number(upcomingAppointments[0]?.count || 0), appointmentsToday: Number(appointmentsToday[0]?.count || 0), messagesToday: Number(messagesToday[0]?.count || 0), followUps: Number(followUps[0]?.count || 0), revenue: null, revenueStatus: 'No stored revenue records yet.' };
          },
        }),
        getFinanceSummary: tool({
          description: 'Get completed payment revenue and exact outstanding invoice balances by today, week, month, or all time. Use this for money collected, outstanding balances, who owes money, or sales questions.',
          inputSchema: z.object({ period: z.enum(['today', 'this_week', 'this_month', 'all_time']).default('this_month') }),
          execute: async ({ period }) => {
            const now = new Date();
            const start = new Date(now);
            if (period === 'this_week') {
              const day = start.getDay();
              start.setDate(start.getDate() - ((day + 6) % 7));
            } else if (period === 'this_month') {
              start.setDate(1);
            } else if (period === 'all_time') {
              start.setTime(0);
            }
            start.setHours(0, 0, 0, 0);
            const tenantFinance = eq(payment.businessProfileId, tenant.id);
            const [completedPayments, unpaidInvoices, invoicePayments, estimateRows] = await Promise.all([
              db.select({ total: sql<string>`coalesce(sum(${payment.amount}), 0)`, count: sql<number>`count(*)` })
                .from(payment)
                .where(and(tenantFinance, eq(payment.status, 'completed'), period === 'all_time' ? undefined : gte(payment.receivedAt, start))),
              db.select({ id: invoice.id, customerName: customer.name, total: invoice.total, status: invoice.status, dueAt: invoice.dueAt })
                .from(invoice).innerJoin(customer, eq(invoice.customerId, customer.id))
                .where(and(eq(invoice.businessProfileId, tenant.id), sql`${invoice.status} NOT IN ('paid', 'cancelled', 'void')`))
                .orderBy(asc(invoice.dueAt)).limit(30),
              db.select({ invoiceId: payment.invoiceId, received: sql<string>`coalesce(sum(${payment.amount}), 0)` })
                .from(payment).where(and(tenantFinance, eq(payment.status, 'completed'))).groupBy(payment.invoiceId),
              db.select({ status: estimate.status, total: estimate.total, count: sql<number>`count(*)` })
                .from(estimate)
                .where(and(eq(estimate.businessProfileId, tenant.id), period === 'all_time' ? undefined : gte(estimate.createdAt, start)))
                .groupBy(estimate.status),
            ]);
            const receivedByInvoice = new Map(invoicePayments.filter((row) => row.invoiceId).map((row) => [row.invoiceId as string, Number(row.received)]));
            const invoicesWithBalances = unpaidInvoices.map((record) => ({ ...record, received: receivedByInvoice.get(record.id) || 0, balance: Math.max(0, Number(record.total) - (receivedByInvoice.get(record.id) || 0)) })).filter((record) => record.balance > 0);
            return {
              period,
              collectedRevenue: completedPayments[0]?.total || '0',
              completedPaymentCount: Number(completedPayments[0]?.count || 0),
              unpaidInvoices: invoicesWithBalances,
              unpaidInvoiceCount: invoicesWithBalances.length,
              outstandingBalance: invoicesWithBalances.reduce((sum, record) => sum + record.balance, 0),
              estimates: estimateRows.map((row) => ({ ...row, count: Number(row.count || 0) })),
            };
          },
        }),
        getSalesInsights: tool({
          description: 'Get record-backed operational sales insight for a period: completed payments, invoices, estimates, new leads, booked jobs, and job services. Use for best-selling services, sales performance, or what changed.',
          inputSchema: z.object({ period: z.enum(['this_week', 'this_month']).default('this_week') }),
          execute: async ({ period }) => {
            const now = new Date();
            const start = new Date(now);
            if (period === 'this_week') {
              const day = start.getDay();
              start.setDate(start.getDate() - ((day + 6) % 7));
            } else {
              start.setDate(1);
            }
            start.setHours(0, 0, 0, 0);
            const [payments, leadCount, jobsByService, invoicesByStatus] = await Promise.all([
              db.select({ total: sql<string>`coalesce(sum(${payment.amount}), 0)`, count: sql<number>`count(*)` })
                .from(payment).where(and(eq(payment.businessProfileId, tenant.id), eq(payment.status, 'completed'), gte(payment.receivedAt, start))),
              db.select({ count: sql<number>`count(*)` }).from(lead).where(and(eq(lead.businessProfileId, tenant.id), gte(lead.createdAt, start))),
              db.select({ service: job.service, count: sql<number>`count(*)` })
                .from(job).where(and(eq(job.businessProfileId, tenant.id), gte(job.createdAt, start))).groupBy(job.service).orderBy(desc(sql`count(*)`)).limit(10),
              db.select({ status: invoice.status, total: sql<string>`coalesce(sum(${invoice.total}), 0)`, count: sql<number>`count(*)` })
                .from(invoice).where(and(eq(invoice.businessProfileId, tenant.id), gte(invoice.createdAt, start))).groupBy(invoice.status),
            ]);
            return {
              period,
              collectedRevenue: payments[0]?.total || '0',
              completedPaymentCount: Number(payments[0]?.count || 0),
              newLeadCount: Number(leadCount[0]?.count || 0),
              jobsByService: jobsByService.map((row) => ({ ...row, count: Number(row.count || 0) })),
              invoicesByStatus: invoicesByStatus.map((row) => ({ ...row, count: Number(row.count || 0) })),
              note: 'Service performance is based on job counts. Product-level sales are unavailable unless products are recorded as jobs.',
            };
          },
        }),
        getLeadsAndJobs: tool({
          description: 'Get current leads or jobs, optionally filtered by a status. Use for pipeline, open work, and orders/jobs questions.',
          inputSchema: z.object({ record: z.enum(['leads', 'jobs']), status: z.string().max(50).optional() }),
          execute: async ({ record, status }) => {
            if (record === 'leads') {
              const filters = [eq(lead.businessProfileId, tenant.id)];
              if (status?.trim()) filters.push(eq(lead.status, status.trim()));
              const leads = await db.select({ name: lead.name, serviceRequested: lead.serviceRequested, status: lead.status, estimatedValue: lead.estimatedValue, assignedEmployee: lead.assignedEmployee, lastContactedAt: lead.lastContactedAt, createdAt: lead.createdAt })
                .from(lead).where(and(...filters)).orderBy(desc(lead.createdAt)).limit(30);
              return { record, leads };
            }
            const filters = [eq(job.businessProfileId, tenant.id)];
            if (status?.trim()) filters.push(eq(job.status, status.trim()));
            const jobs = await db.select({ customerName: customer.name, service: job.service, status: job.status, assignedEmployee: job.assignedEmployee, scheduledAt: job.scheduledAt, notes: job.notes, createdAt: job.createdAt })
              .from(job).innerJoin(customer, eq(job.customerId, customer.id)).where(and(...filters)).orderBy(desc(job.createdAt)).limit(30);
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            return { record, jobs: jobs.map((item) => ({ ...item, ...(isFoodBusiness(tenant.businessType) ? orderDetailsFromNotes(item.notes) : jobDetailsFromNotes(item.notes)), scheduledAt: item.scheduledAt ? formatPilotDateTime(item.scheduledAt, timezone) : null })) };
          },
        }),
        searchAppointments: tool({
          description: 'Search current and past appointments for the authenticated business by customer name, appointment title, or an ISO date/time range.',
          inputSchema: z.object({ query: z.string().max(120).optional(), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }),
          execute: async ({ query, from, to }) => {
            const filters = [tenantCustomer];
            if (query?.trim()) {
              const needle = `%${query.trim()}%`;
              filters.push(or(like(customer.name, needle), like(customerAppointment.title, needle))!);
            }
            const fromDate = from ? parseRequestedDate(from) : null;
            const toDate = to ? parseRequestedDate(to) : null;
            if (fromDate) filters.push(gte(customerAppointment.scheduledAt, fromDate));
            if (toDate) filters.push(lt(customerAppointment.scheduledAt, toDate));
            const appointments = await db.select({ id: customerAppointment.id, customerName: customer.name, title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, notes: customerAppointment.notes })
              .from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(...filters)).orderBy(asc(customerAppointment.scheduledAt)).limit(20);
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            return {
              appointments: appointments.map((appointment) => ({
                ...appointment,
                scheduledAt: formatPilotDateTime(appointment.scheduledAt, timezone),
              })),
            };
          },
        }),
        getRescheduleOptions: tool({
          description: 'Find one customer’s scheduled appointment and real next available local rescheduling options. Use this first whenever the owner asks to reschedule an appointment.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120) }),
          execute: async ({ customerName }) => {
            const matches = await db.select({ id: customer.id, name: customer.name })
              .from(customer)
              .where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`)))
              .limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            const appointments = await db.select({ id: customerAppointment.id, title: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes })
              .from(customerAppointment)
              .where(and(eq(customerAppointment.customerId, matches[0].id), eq(customerAppointment.status, 'scheduled')))
              .orderBy(asc(customerAppointment.scheduledAt))
              .limit(2);
            if (appointments.length !== 1) return { ok: false, message: appointments.length ? 'More than one scheduled appointment matches this customer.' : 'No scheduled appointment matches this customer.' };
            const appointment = appointments[0];
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            const availableTimes = await findNextAvailableSlots(tenant.id, appointment.scheduledAt, appointment.durationMinutes, 3);
            return {
              ok: true,
              customerName: matches[0].name,
              appointment: { id: appointment.id, title: appointment.title, localTime: formatPilotDateTime(appointment.scheduledAt, timezone), durationMinutes: appointment.durationMinutes },
              availableTimes: availableTimes.map((time) => ({ localTime: formatPilotTime(time, timezone), internalScheduledAt: time.toISOString() })),
            };
          },
        }),
        getAvailableAppointmentTimes: tool({
          description: 'Check real appointment availability and return the next available times for the authenticated business. Use this when a requested time is unavailable or before proposing a new time.',
          inputSchema: z.object({ after: z.string().datetime({ offset: true }), durationMinutes: z.number().int().min(15).max(480).multipleOf(15).default(60), count: z.number().int().min(1).max(6).default(3) }),
          execute: async ({ after, durationMinutes, count }) => {
            const requested = parseRequestedDate(after);
            if (!requested) return { ok: false, message: 'The requested date and time is invalid.' };
            const availableTimes = await findNextAvailableSlots(tenant.id, requested, durationMinutes, count);
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            return {
              ok: true,
              availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })),
            };
          },
        }),
        changeAppointment: tool({
          description: 'Create, reschedule, or cancel an appointment. Always identify a single customer and require explicit owner confirmation before making any change. Date/time must be a valid ISO 8601 datetime with timezone offset.',
          inputSchema: z.object({ action: z.enum(['create', 'reschedule', 'cancel']), customerName: z.string().min(1).max(120), appointmentId: z.string().uuid().optional(), title: z.string().min(1).max(255).optional(), scheduledAt: z.string().datetime({ offset: true }).optional(), durationMinutes: z.number().int().min(15).max(480).multipleOf(15).optional(), confirmed: z.boolean().default(false) }),
          execute: async ({ action, customerName, appointmentId, title, scheduledAt, durationMinutes, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`))).limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name.' : 'No active customer matches that name.' };
            const customerRecord = matches[0];
            if (action === 'create') {
              if (!title || !scheduledAt) return { ok: false, message: 'A title and an ISO date/time are required to create an appointment.' };
              const date = new Date(scheduledAt);
              const duration = durationMinutes || 60;
              if (!confirmed) return { ok: false, needsConfirmation: true, customerName: customerRecord.name, proposedChange: { action, title, scheduledAt, durationMinutes: duration }, message: 'Ask the owner to confirm before creating this appointment.' };
              try {
                await assertSchedulingAvailability(tenant.id, date, duration);
              } catch {
                const availableTimes = await findNextAvailableSlots(tenant.id, date, duration);
                const timezone = (await getCalendarSettings(tenant.id)).timezone;
                return {
                  ok: false,
                  unavailable: true,
                  message: 'That time is not available.',
                  availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })),
                };
              }
              const id = randomUUID();
              await db.insert(customerAppointment).values({ id, customerId: customerRecord.id, title, scheduledAt: date, durationMinutes: duration });
              const timezone = (await getCalendarSettings(tenant.id)).timezone;
              await logCustomerActivity(customerRecord.id, 'appointment_created', 'Appointment created by Pilot', `${title} at ${formatPilotDateTime(date, timezone)}`);
              return { ok: true, appointmentId: id, message: 'Appointment created.' };
            }
            const appointments = await db.select().from(customerAppointment).where(and(eq(customerAppointment.customerId, customerRecord.id), appointmentId ? eq(customerAppointment.id, appointmentId) : sql`${customerAppointment.status} = 'scheduled'`)).orderBy(asc(customerAppointment.scheduledAt)).limit(5);
            const timezone = (await getCalendarSettings(tenant.id)).timezone;
            if (appointments.length !== 1) return {
              ok: false,
              appointments: appointments.map((item) => ({ id: item.id, title: item.title, scheduledAt: formatPilotDateTime(item.scheduledAt, timezone), status: item.status })),
              message: appointments.length ? 'More than one appointment matches. Ask the owner which appointment to change.' : 'No scheduled appointment matches that customer.',
            };
            const appointment = appointments[0];
            if (!confirmed) return {
              ok: false,
              needsConfirmation: true,
              customerName: customerRecord.name,
              proposedChange: {
                action,
                appointmentId: appointment.id,
                title: appointment.title,
                currentTime: formatPilotDateTime(appointment.scheduledAt, timezone),
                scheduledAt: scheduledAt ? formatPilotDateTime(new Date(scheduledAt), timezone) : null,
                durationMinutes,
              },
              message: `Ask the owner to confirm before ${action === 'cancel' ? 'cancelling' : 'rescheduling'} this appointment.`,
            };
            if (action === 'cancel') {
              await db.update(customerAppointment).set({ status: 'cancelled' }).where(eq(customerAppointment.id, appointment.id));
              await logCustomerActivity(customerRecord.id, 'appointment_cancelled', 'Appointment cancelled by Pilot', appointment.title);
              await createAppointmentChangeNotification({ businessProfileId: tenant.id, customerId: customerRecord.id, customerName: customerRecord.name, appointmentId: appointment.id, before: appointment, after: { ...appointment, status: 'cancelled' } });
              return { ok: true, message: 'Appointment cancelled.' };
            }
            if (!scheduledAt) return { ok: false, message: 'A new ISO date/time is required to reschedule an appointment.' };
            const date = new Date(scheduledAt);
            const duration = durationMinutes || appointment.durationMinutes;
            try {
              await assertSchedulingAvailability(tenant.id, date, duration, appointment.id);
            } catch {
              const availableTimes = await findNextAvailableSlots(tenant.id, date, duration, 3);
              const timezone = (await getCalendarSettings(tenant.id)).timezone;
                return {
                  ok: false,
                  unavailable: true,
                  message: 'That time is not available.',
                  availableTimes: availableTimes.map((time) => ({ localTime: formatPilotDateTime(time, timezone), internalScheduledAt: time.toISOString() })),
                };
            }
            await db.update(customerAppointment).set({ scheduledAt: date, durationMinutes: duration }).where(eq(customerAppointment.id, appointment.id));
            await logCustomerActivity(customerRecord.id, 'appointment_rescheduled', 'Appointment rescheduled by Pilot', `${appointment.title} to ${formatPilotDateTime(date, timezone)}`);
            await createAppointmentChangeNotification({ businessProfileId: tenant.id, customerId: customerRecord.id, customerName: customerRecord.name, appointmentId: appointment.id, before: appointment, after: { ...appointment, scheduledAt: date, durationMinutes: duration } });
            return { ok: true, message: 'Appointment rescheduled.' };
          },
        }),
        addFollowUpNote: tool({
          description: 'Add a follow-up activity note to a specific customer record only after the owner confirms the exact note.',
          inputSchema: z.object({ customerName: z.string().min(1).max(120), note: z.string().min(1).max(1000), confirmed: z.boolean().default(false) }),
          execute: async ({ customerName, note, confirmed }) => {
            const matches = await db.select({ id: customer.id, name: customer.name })
              .from(customer)
              .where(and(tenantCustomer, sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${customerName.trim()}%`)))
              .limit(3);
            if (matches.length !== 1) return { ok: false, message: matches.length ? 'More than one customer matches that name. Ask the owner to be more specific before saving a note.' : 'No active customer matches that name.' };
            if (!confirmed) return { ok: false, needsConfirmation: true, customerName: matches[0].name, proposedNote: note, message: 'Ask the owner to confirm before saving this follow-up note.' };
            await db.insert(customerActivity).values({ id: randomUUID(), customerId: matches[0].id, activityType: 'assistant_follow_up', title: 'Pilot follow-up note added', detail: note.trim() });
            return { ok: true, customerName: matches[0].name, message: 'Follow-up note saved to the customer activity record.' };
          },
        }),
      },
    });

    const textResponse = result.toTextStreamResponse({ headers: { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'X-Request-Id': requestId } });
    res.status(textResponse.status);
    textResponse.headers.forEach((value, key) => res.setHeader(key, value));
    if (!textResponse.body) {
      res.end();
      return;
    }

    const reader = textResponse.body.getReader();
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        res.write(chunk.value);
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(JSON.stringify({ event: 'business-assistant.error', requestId, tenantId: tenant.id, error: message }));
    if (!res.headersSent) res.status(500).json({ error: 'Assistant request failed. Please try again.', requestId });
  }
}
