import type { Request } from 'express';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { tool } from 'ai';
import { z } from 'zod';
import { db } from '@/server/db/client.js';
import { customer, employee, employeeShift, estimate, financeLineItem, invoice, job, weeklySchedule } from '@/server/db/schema.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { normalizePhone } from '@/server/api/customers/tenant.js';
import { lineItemsFrom } from '@/server/api/finance/shared.js';
import createCustomerRoute from '@/server/api/customers/POST.js';
import createLeadRoute from '@/server/api/leads/POST.js';
import createJobRoute from '@/server/api/jobs/POST.js';
import financeRoute from '@/server/api/finance/POST.js';
import sendQuoteRoute from '@/server/api/finance/estimates/[estimateId]/send/POST.js';
import publishScheduleRoute from '@/server/api/schedules/[scheduleId]/PATCH.js';
import emailScheduleRoute from '@/server/api/schedules/[scheduleId]/email/POST.js';
import { randomUUID } from 'node:crypto';
import { callRoute, errorText, succeeded } from './route-call.js';
import { resolveScheduleWeek } from './schedule-week.js';
import { card } from './confirmation-card.js';

type Context = { tenantId: string; businessName: string; businessType?: string; request: Pick<Request, 'headers'>; now?: () => Date };

const money = (value: string | number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value) || 0);
const customerLink = (id: string) => ({ label: 'Open customer', href: `/dashboard/customers/${id}` });
const quoteNumber = (id: string) => `Q-${id.slice(0, 8).toUpperCase()}`;
const invoiceNumber = (id: string) => `INV-${id.slice(0, 8).toUpperCase()}`;

const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive().max(100000).default(1),
  unitPrice: z.number().min(0).max(10000000).describe('The price the owner stated. Never guess a price.'),
  taxRate: z.number().min(0).max(100).default(0),
});
const lineItemsHelp = 'Only include line items and prices the owner actually stated. If a price or description is missing, ask for it instead of guessing.';

/**
 * Pilot actions that create or send business records. Each runs the same route the screens use, after
 * the owner confirms in the chat. Preparing never writes anything, and a failure is reported as a failure.
 */
export function createRecordTools({ tenantId, businessName, businessType, request, now = () => new Date() }: Context) {
  const findCustomer = (name: string) => db.select({ id: customer.id, name: customer.name, email: customer.email, phoneNumber: customer.phoneNumber }).from(customer)
    .where(and(eq(customer.businessProfileId, tenantId), sql`${customer.archivedAt} IS NULL`, sql`${customer.name} LIKE ${`%${name.trim()}%`}`)).limit(3);
  const oneCustomer = async (name: string) => {
    const matches = await findCustomer(name);
    if (matches.length !== 1) return { error: { ok: false as const, message: matches.length ? `More than one customer matches “${name}”: ${matches.map((row) => row.name).join(', ')}. Ask the owner which one.` : `No active customer matches “${name}”. Offer to create the customer first.` } };
    return { person: matches[0] };
  };

  return {
    createCustomer: tool({
      description: 'Create a new customer. Needs a name and a phone number from the owner; ask for the phone number if it was not given and never invent contact details. This only prepares the action: the owner confirms with a button in the chat.',
      inputSchema: z.object({ name: z.string().min(1).max(120), phoneNumber: z.string().min(7).max(40), email: z.string().email().optional(), address: z.string().max(500).optional(), company: z.string().max(120).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ name, phoneNumber, email, address, company, confirmed }) => {
        const phone = normalizePhone(phoneNumber);
        if (phone.length < 7) return { ok: false, message: 'That phone number does not look valid. Ask the owner for the right number.' };
        const existing = (await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(eq(customer.businessProfileId, tenantId), email ? sql`(${customer.phoneNumber} = ${phone} OR ${customer.email} = ${email})` : eq(customer.phoneNumber, phone))).limit(1))[0];
        if (existing) return { ok: false, message: `${existing.name} already uses that phone number or email, so no duplicate was prepared.`, link: customerLink(existing.id) };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Create customer ${name}`, [`Phone: ${phone}`, email ? `Email: ${email}` : '', address ? `Address: ${address}` : '', company ? `Company: ${company}` : ''], 'Create customer', 'Creating the customer…'), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(createCustomerRoute, request, { name, phoneNumber: phone, email, address, company });
        if (!succeeded(result)) return { ok: false, message: `The customer was NOT created. ${errorText(result, 'Something went wrong.')}` };
        const created = result.body.customer as { id?: string } | undefined;
        return { ok: true, created: true, message: `Customer ${name} was created.`, ...(created?.id && { link: customerLink(created.id) }) };
      },
    }),

    createLead: tool({
      description: 'Create a new lead (a potential customer who has not booked yet). Needs a name, what they asked for, and a phone number or email. Ask for anything missing. This only prepares the action: the owner confirms with a button.',
      inputSchema: z.object({ name: z.string().min(1).max(120), serviceRequested: z.string().min(1).max(200), phoneNumber: z.string().max(40).optional(), email: z.string().email().optional(), estimatedValue: z.number().min(0).max(10000000).optional(), source: z.string().max(100).optional(), notes: z.string().max(2000).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ name, serviceRequested, phoneNumber, email, estimatedValue, source, notes, confirmed }) => {
        if (!phoneNumber && !email) return { ok: false, message: 'A lead needs a phone number or an email. Ask the owner for one.' };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Create lead ${name}`, [`Wants: ${serviceRequested}`, phoneNumber ? `Phone: ${phoneNumber}` : '', email ? `Email: ${email}` : '', estimatedValue !== undefined ? `Estimated value: ${money(estimatedValue)}` : ''], 'Create lead', 'Creating the lead…', { label: 'Open leads', href: '/leads' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(createLeadRoute, request, { name, serviceRequested, phoneNumber, email, estimatedValue, source, notes });
        if (!succeeded(result)) return { ok: false, message: `The lead was NOT created. ${errorText(result, 'Something went wrong.')}` };
        return { ok: true, created: true, message: `Lead ${name} was created.`, link: { label: 'Open leads', href: '/leads' } };
      },
    }),

    createJob: tool({
      description: `Create a ${isFoodBusiness(businessType) ? 'customer order' : 'job'} for an existing customer. Needs the customer and ${isFoodBusiness(businessType) ? 'the items ordered (name and quantity)' : 'what the work is'}; a date/time (ISO 8601 with offset), address, assigned employee, duration in minutes and price are optional and must come from the owner. If the customer does not exist yet, offer to create them first. This only prepares the action: the owner confirms with a button.`,
      inputSchema: z.object({ customerName: z.string().min(1).max(120), service: z.string().max(255).optional(), items: z.array(z.object({ name: z.string().min(1).max(255), quantity: z.number().int().min(1).max(10000) })).max(30).optional(), scheduledAt: z.string().datetime({ offset: true }).optional(), address: z.string().max(500).optional(), assignedEmployee: z.string().max(120).optional(), durationMinutes: z.number().int().min(15).max(1440).optional(), price: z.number().min(0).max(10000000).optional(), notes: z.string().max(2000).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ customerName, service, items, scheduledAt, address, assignedEmployee, durationMinutes, price, notes, confirmed }) => {
        const found = await oneCustomer(customerName); if ('error' in found) return found.error;
        const food = isFoodBusiness(businessType);
        if (food && !items?.length) return { ok: false, message: 'An order needs at least one item and quantity. Ask the owner what was ordered.' };
        if (!food && !service?.trim()) return { ok: false, message: 'What is the job? Ask the owner what work it is.' };
        const when = scheduledAt ? new Date(scheduledAt) : null;
        if (scheduledAt && (!when || Number.isNaN(when.getTime()))) return { ok: false, message: 'That date and time is not valid. Ask the owner for the day and time.' };
        const { timezone } = await getCalendarSettings(tenantId);
        const whenText = when ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(when).replace(',', ' at') : 'No date yet';
        const title = food ? items!.map((item) => `${item.quantity} × ${item.name}`).join(', ') : service!.trim();
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Create ${food ? 'an order' : 'a job'} for ${found.person.name}`, [title, `When: ${whenText}`, assignedEmployee ? `Assigned to: ${assignedEmployee}` : '', address ? `Address: ${address}` : '', price !== undefined ? `Price: ${money(price)}` : ''], food ? 'Create order' : 'Create job', food ? 'Creating the order…' : 'Creating the job…', { label: food ? 'Open orders' : 'Open jobs', href: '/jobs' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(createJobRoute, request, { customerId: found.person.id, service, items, scheduledAt, address, assignedEmployee, durationMinutes, price, notes });
        if (!succeeded(result)) return { ok: false, message: `The ${food ? 'order' : 'job'} was NOT created. ${errorText(result, 'Something went wrong.')}` };
        return { ok: true, created: true, message: `${food ? 'Order' : 'Job'} “${title}” was created for ${found.person.name}.`, link: { label: food ? 'Open orders' : 'Open jobs', href: '/jobs' } };
      },
    }),

    createQuote: tool({
      description: `Create a DRAFT quote for an existing customer. It is not sent to the customer. ${lineItemsHelp} This only prepares the action: the owner confirms with a button.`,
      inputSchema: z.object({ customerName: z.string().min(1).max(120), lineItems: z.array(lineItemSchema).min(1).max(30), notes: z.string().max(2000).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ customerName, lineItems, notes, confirmed }) => {
        const found = await oneCustomer(customerName); if ('error' in found) return found.error;
        const parsed = lineItemsFrom(lineItems); if ('error' in parsed) return { ok: false, message: parsed.error };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Create a quote for ${found.person.name}`, [...parsed.items.map((item) => `${item.description}: ${Number(item.quantity)} × ${money(item.unitPrice)}`), `Total: ${money(parsed.total)}${Number(parsed.taxTotal) ? ` (includes ${money(parsed.taxTotal)} tax)` : ''}`, 'Saved as a draft. Nothing is emailed.'], 'Create quote', 'Creating the quote…', { label: 'Open quotes', href: '/finance' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(financeRoute, request, { recordType: 'estimates', customerId: found.person.id, lineItems, notes, status: 'draft', clientRequestId: randomUUID() });
        if (!succeeded(result)) return { ok: false, message: `The quote was NOT created. ${errorText(result, 'Something went wrong.')}` };
        return { ok: true, created: true, total: money(parsed.total), message: `A draft quote for ${found.person.name} (${money(parsed.total)}) was created. It has not been sent.`, link: { label: 'Open quotes', href: '/finance' } };
      },
    }),

    createInvoice: tool({
      description: `Create a DRAFT invoice for an existing customer. It is not sent. ${lineItemsHelp} This only prepares the action: the owner confirms with a button.`,
      inputSchema: z.object({ customerName: z.string().min(1).max(120), lineItems: z.array(lineItemSchema).min(1).max(30), notes: z.string().max(2000).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ customerName, lineItems, notes, confirmed }) => {
        const found = await oneCustomer(customerName); if ('error' in found) return found.error;
        const parsed = lineItemsFrom(lineItems); if ('error' in parsed) return { ok: false, message: parsed.error };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Create an invoice for ${found.person.name}`, [...parsed.items.map((item) => `${item.description}: ${Number(item.quantity)} × ${money(item.unitPrice)}`), `Total: ${money(parsed.total)}${Number(parsed.taxTotal) ? ` (includes ${money(parsed.taxTotal)} tax)` : ''}`, 'Saved as a draft. Nothing is emailed.'], 'Create invoice', 'Creating the invoice…', { label: 'Open invoices', href: '/finance' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(financeRoute, request, { recordType: 'invoices', customerId: found.person.id, lineItems, notes, status: 'draft', clientRequestId: randomUUID() });
        if (!succeeded(result)) return { ok: false, message: `The invoice was NOT created. ${errorText(result, 'Something went wrong.')}` };
        return { ok: true, created: true, total: money(parsed.total), message: `A draft invoice for ${found.person.name} (${money(parsed.total)}) was created. It has not been sent.`, link: { label: 'Open invoices', href: '/finance' } };
      },
    }),

    sendQuote: tool({
      description: 'Email an existing quote to the customer. Identify one customer and one quote (use quoteDescription for words like "pool opening"). This only prepares the action: the owner confirms with a button, and Pilot only says it was sent if the email really was.',
      inputSchema: z.object({ customerName: z.string().min(1).max(120), quoteDescription: z.string().max(200).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ customerName, quoteDescription, confirmed }) => {
        const found = await oneCustomer(customerName); if ('error' in found) return found.error;
        const person = found.person;
        const rows = await db.select({ id: estimate.id, status: estimate.status, total: estimate.total, createdAt: estimate.createdAt }).from(estimate)
          .where(and(eq(estimate.businessProfileId, tenantId), eq(estimate.customerId, person.id))).orderBy(desc(estimate.createdAt)).limit(10);
        if (!rows.length) return { ok: false, message: `${person.name} has no quote to send.` };
        const lines = await db.select({ estimateId: financeLineItem.estimateId, description: financeLineItem.description }).from(financeLineItem).where(inArray(financeLineItem.estimateId, rows.map((row) => row.id)));
        const wanted = (quoteDescription ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !['the', 'for', 'quote', 'estimate'].includes(word));
        const describe = (row: (typeof rows)[number]) => ({ quoteId: row.id, quoteNumber: quoteNumber(row.id), total: money(row.total), status: row.status, for: lines.find((line) => line.estimateId === row.id)?.description ?? 'No description' });
        const matches = wanted.length ? rows.filter((row) => wanted.every((word) => lines.filter((line) => line.estimateId === row.id).map((line) => line.description).join(' ').toLowerCase().includes(word))) : rows;
        if (!matches.length) return { ok: false, message: `None of ${person.name}'s quotes match “${quoteDescription}”. Show these and ask which one.`, quotes: rows.map(describe) };
        if (matches.length > 1) return { ok: false, message: `${person.name} has more than one matching quote. Ask the owner which one to send.`, quotes: matches.map(describe) };
        const chosen = matches[0]; const email = person.email?.trim();
        if (!email) return { ok: false, message: `${person.name} has no email address on file, so the quote cannot be sent. The owner can add one on the customer's profile.` };
        const summary = describe(chosen);
        if (!confirmed) return { ok: false, needsConfirmation: true, ...summary, sendTo: email, card: card(`Email quote to ${person.name}`, [`${summary.quoteNumber}: ${summary.for}`, `Total: ${summary.total}`, `Sent to: ${email}`, chosen.status !== 'draft' ? `This quote is already marked “${chosen.status}”` : ''], 'Send quote', 'Sending the quote…', { label: 'Open quotes', href: '/finance' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(sendQuoteRoute, request, { requestId: randomUUID() }, { estimateId: chosen.id });
        if (!succeeded(result)) return { ok: false, sent: false, message: `The quote was NOT sent. ${errorText(result, 'The email could not be sent.')}` };
        return { ok: true, sent: true, message: `Quote ${summary.quoteNumber} was emailed to ${email}.`, link: { label: 'Open quotes', href: '/finance' } };
      },
    }),

    recordPayment: tool({
      description: 'Record a payment the owner says was received against an unpaid invoice. Needs the customer and the amount from the owner; never guess an amount. This only prepares the action: the owner confirms with a button.',
      inputSchema: z.object({ customerName: z.string().min(1).max(120), amount: z.number().positive().max(10000000), invoiceDescription: z.string().max(200).optional(), method: z.string().max(50).optional(), confirmed: z.boolean().default(false) }),
      execute: async ({ customerName, amount, invoiceDescription, method, confirmed }) => {
        const found = await oneCustomer(customerName); if ('error' in found) return found.error;
        const person = found.person;
        const rows = await db.select({ id: invoice.id, status: invoice.status, total: invoice.total, jobService: job.service }).from(invoice).leftJoin(job, eq(invoice.jobId, job.id))
          .where(and(eq(invoice.businessProfileId, tenantId), eq(invoice.customerId, person.id), inArray(invoice.status, ['sent', 'open', 'overdue', 'draft']))).orderBy(desc(invoice.createdAt)).limit(10);
        if (!rows.length) return { ok: false, message: `${person.name} has no unpaid invoice to record a payment against.` };
        const wanted = (invoiceDescription ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
        const matches = wanted.length ? rows.filter((row) => wanted.every((word) => (row.jobService ?? '').toLowerCase().includes(word))) : rows;
        const describe = (row: (typeof rows)[number]) => ({ invoiceId: row.id, invoiceNumber: invoiceNumber(row.id), total: money(row.total), status: row.status, for: row.jobService ?? 'No linked job' });
        if (matches.length !== 1) return { ok: false, message: matches.length ? `${person.name} has more than one matching unpaid invoice. Ask the owner which one.` : `None of ${person.name}'s unpaid invoices match that description.`, invoices: (matches.length ? matches : rows).map(describe) };
        const chosen = matches[0];
        if (amount > Number(chosen.total) + 0.005) return { ok: false, message: `${money(amount)} is more than the invoice total of ${money(chosen.total)}. Ask the owner to confirm the amount.` };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Record a payment from ${person.name}`, [`${money(amount)}${method ? ` by ${method}` : ''}`, `Against ${invoiceNumber(chosen.id)} (${money(chosen.total)})`, amount >= Number(chosen.total) - 0.005 ? 'This pays the invoice in full' : 'A partial payment: the invoice stays open'], 'Record payment', 'Recording the payment…', { label: 'Open payments', href: '/finance' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(financeRoute, request, { recordType: 'payment', customerId: person.id, invoiceId: chosen.id, amount, method, status: 'completed' });
        if (!succeeded(result)) return { ok: false, message: `The payment was NOT recorded. ${errorText(result, 'Something went wrong.')}` };
        return { ok: true, recorded: true, message: `A ${money(amount)} payment from ${person.name} was recorded against ${invoiceNumber(chosen.id)}.`, link: { label: 'Open payments', href: '/finance' } };
      },
    }),

    publishSchedule: tool({
      description: 'Publish a week\'s draft schedule so it becomes the official schedule. It does NOT email employees. Use for "publish next week\'s schedule". This only prepares the action: the owner confirms with a button.',
      inputSchema: z.object({ week: z.string().min(1).max(20).describe('"this", "next", or a date (YYYY-MM-DD) inside the week.'), confirmed: z.boolean().default(false) }),
      execute: async ({ week, confirmed }) => {
        const located = await locateSchedule(week); if ('error' in located) return located.error;
        const { schedule, label, count } = located;
        if (schedule.status === 'published') return { ok: false, message: `The schedule for ${label} is already published.`, link: { label: 'Open scheduling', href: '/scheduling' } };
        if (!count) return { ok: false, message: `The draft for ${label} has no shifts yet, so there is nothing to publish.` };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Publish the schedule for ${label}`, [`${count} shift${count === 1 ? '' : 's'} will become the official schedule`, 'Employees are not emailed. You can send it next.'], 'Publish schedule', 'Publishing the schedule…', { label: 'Open scheduling', href: '/scheduling' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(publishScheduleRoute, request, { status: 'published' }, { scheduleId: schedule.id });
        if (!succeeded(result)) return { ok: false, message: `The schedule was NOT published. ${errorText(result, 'Something went wrong.')}` };
        return { ok: true, published: true, message: `The schedule for ${label} is published. Employees have not been emailed yet.`, link: { label: 'Open scheduling', href: '/scheduling' } };
      },
    }),

    sendSchedule: tool({
      description: 'Email each employee their own shifts for a PUBLISHED week. Pilot only says it was sent if the email really was. This only prepares the action: the owner confirms with a button.',
      inputSchema: z.object({ week: z.string().min(1).max(20), confirmed: z.boolean().default(false) }),
      execute: async ({ week, confirmed }) => {
        const located = await locateSchedule(week); if ('error' in located) return located.error;
        const { schedule, label } = located;
        if (schedule.status !== 'published') return { ok: false, message: `The schedule for ${label} is still a draft. Publish it first, then it can be emailed.` };
        const recipients = await db.select({ id: employee.id, name: employee.name, email: employee.email }).from(employeeShift).innerJoin(employee, eq(employeeShift.employeeId, employee.id))
          .where(and(eq(employeeShift.businessProfileId, tenantId), eq(employeeShift.weeklyScheduleId, schedule.id)));
        const people = new Map(recipients.filter((row) => row.email?.includes('@')).map((row) => [row.id, row.name]));
        if (!people.size) return { ok: false, message: `No employee with shifts that week has an email address, so there is nobody to send it to.` };
        if (!confirmed) return { ok: false, needsConfirmation: true, card: card(`Email the schedule for ${label}`, [`Each person gets only their own shifts`, `To: ${[...people.values()].join(', ')}`], 'Send schedule', 'Sending the schedule…', { label: 'Open scheduling', href: '/scheduling' }), message: 'Waiting for the owner to confirm.' };
        const result = await callRoute(emailScheduleRoute, request, {}, { scheduleId: schedule.id });
        if (!succeeded(result)) return { ok: false, sent: false, message: `The schedule was NOT sent. ${errorText(result, 'The email could not be sent.')}` };
        return { ok: true, sent: true, message: typeof result.body.message === 'string' ? result.body.message : `The schedule for ${label} was emailed to ${people.size} ${people.size === 1 ? 'person' : 'people'}.`, link: { label: 'Open scheduling', href: '/scheduling' } };
      },
    }),
  };

  async function locateSchedule(week: string) {
    const { timezone } = await getCalendarSettings(tenantId);
    const target = resolveScheduleWeek(week, now(), timezone);
    if (!target) return { error: { ok: false as const, message: 'Which week? Use “this”, “next”, or a date.' } };
    const start = new Date(target.weekStartIso); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 7);
    const schedule = (await db.select().from(weeklySchedule).where(and(eq(weeklySchedule.businessProfileId, tenantId), gte(weeklySchedule.weekStartsAt, start), lt(weeklySchedule.weekStartsAt, end))).limit(1))[0];
    if (!schedule) return { error: { ok: false as const, message: `There is no schedule for ${target.label}. Offer to build a draft first.` } };
    const shifts = await db.select({ id: employeeShift.id }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenantId), eq(employeeShift.weeklyScheduleId, schedule.id)));
    return { schedule, label: target.label, count: shifts.length };
  }
}
