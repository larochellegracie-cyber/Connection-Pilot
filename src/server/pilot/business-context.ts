import { and, asc, desc, eq, gte, like, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessKnowledge, customer, customerAppointment, customerConversation, customerInteraction, employee, employeeShift, estimate, invoice, job, lead, payment } from '@/server/db/schema.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { isFoodBusiness, workflowLabels } from '@/lib/business-workflow.js';
import { orderDetailsFromNotes } from '@/lib/order-record.js';
import { pilotDateRange, pilotDateRangeSummary, type PilotDatePeriod, type PilotDateRange } from '@/server/pilot/time-context.js';
import { pilotLearningSummary, searchPilotLearning, structuredActivityObservations } from '@/server/pilot/learning.js';
import { getProactiveBriefing } from '@/server/pilot/proactive-briefing.js';

export type PilotTenant = { id: string; businessName: string; businessType: string };
export type PilotContextTopic =
  | 'today_schedule' | 'tomorrow_schedule' | 'yesterday_schedule' | 'this_week_schedule' | 'next_week_schedule'
  | 'past_schedule' | 'future_schedule' | 'upcoming_schedule' | 'overdue_schedule'
  | 'customer_overview' | 'customer_history' | 'employee_lookup' | 'jobs_orders' | 'leads'
  | 'finance' | 'unpaid_invoices' | 'payments' | 'accepted_quotes' | 'accepted_quotes_unscheduled'
  | 'inventory' | 'business_settings' | 'pilot_learning' | 'proactive_briefing';

export type PilotContextOptions = { customerName?: string; employeeName?: string; asOf?: Date };

function displayDate(date: Date | null, timezone: string) {
  if (!date) return null;
  const dateText = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(date);
  const timeText = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${dateText} at ${timeText}`;
}

function money(value: string | number) { return Number(value || 0); }

function dateFilters<T>(column: T, range: PilotDateRange) {
  return [range.start ? gte(column as never, range.start) : undefined, range.end ? lt(column as never, range.end) : undefined];
}

async function customerMatches(tenantId: string, name: string) {
  return db.select({ id: customer.id, name: customer.name, email: customer.email, phoneNumber: customer.phoneNumber, status: customer.status, lastContactedAt: customer.lastContactedAt })
    .from(customer)
    .where(and(eq(customer.businessProfileId, tenantId), sql`${customer.archivedAt} IS NULL`, like(customer.name, `%${name.trim()}%`)))
    .orderBy(desc(customer.lastContactedAt)).limit(5);
}

async function customerHistory(tenant: PilotTenant, customerName: string, timezone: string) {
  const matches = await customerMatches(tenant.id, customerName);
  if (matches.length !== 1) return { found: false, customerMatches: matches.map((record) => record.name), message: matches.length ? 'More than one customer matches. Ask the owner to choose one.' : 'No active customer matches that name.' };
  const record = matches[0];
  const [leads, appointments, jobs, quotes, invoices, payments, messages, interactions] = await Promise.all([
    db.select({ serviceRequested: lead.serviceRequested, status: lead.status, createdAt: lead.createdAt }).from(lead).where(and(eq(lead.businessProfileId, tenant.id), eq(lead.customerId, record.id))).orderBy(desc(lead.createdAt)).limit(12),
    db.select({ title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, notes: customerAppointment.notes }).from(customerAppointment).where(eq(customerAppointment.customerId, record.id)).orderBy(desc(customerAppointment.scheduledAt)).limit(12),
    db.select({ service: job.service, status: job.status, scheduledAt: job.scheduledAt, assignedEmployee: job.assignedEmployee, notes: job.notes }).from(job).where(and(eq(job.businessProfileId, tenant.id), eq(job.customerId, record.id))).orderBy(desc(job.scheduledAt)).limit(12),
    db.select({ status: estimate.status, total: estimate.total, createdAt: estimate.createdAt, jobId: estimate.jobId, notes: estimate.notes }).from(estimate).where(and(eq(estimate.businessProfileId, tenant.id), eq(estimate.customerId, record.id))).orderBy(desc(estimate.createdAt)).limit(12),
    db.select({ id: invoice.id, status: invoice.status, total: invoice.total, dueAt: invoice.dueAt, jobId: invoice.jobId, notes: invoice.notes }).from(invoice).where(and(eq(invoice.businessProfileId, tenant.id), eq(invoice.customerId, record.id))).orderBy(desc(invoice.createdAt)).limit(12),
    db.select({ invoiceId: payment.invoiceId, status: payment.status, amount: payment.amount, method: payment.method, receivedAt: payment.receivedAt }).from(payment).where(and(eq(payment.businessProfileId, tenant.id), eq(payment.customerId, record.id))).orderBy(desc(payment.receivedAt)).limit(20),
    db.select({ channel: customerConversation.channel, direction: customerConversation.direction, content: customerConversation.content, occurredAt: customerConversation.occurredAt }).from(customerConversation).where(eq(customerConversation.customerId, record.id)).orderBy(desc(customerConversation.occurredAt)).limit(12),
    db.select({ interactionType: customerInteraction.interactionType, direction: customerInteraction.direction, summary: customerInteraction.summary, outcome: customerInteraction.outcome, occurredAt: customerInteraction.occurredAt }).from(customerInteraction).where(eq(customerInteraction.customerId, record.id)).orderBy(desc(customerInteraction.occurredAt)).limit(12),
  ]);
  const paidByInvoice = new Map<string, number>();
  payments.filter((item) => item.invoiceId && item.status === 'completed').forEach((item) => paidByInvoice.set(item.invoiceId as string, (paidByInvoice.get(item.invoiceId as string) || 0) + money(item.amount)));
  return {
    found: true,
    labels: workflowLabels(tenant.businessType),
    customer: record,
    leads,
    appointments: appointments.map((item) => ({ ...item, scheduledAt: displayDate(item.scheduledAt, timezone) })),
    jobs: jobs.map((item) => ({ ...item, scheduledAt: displayDate(item.scheduledAt, timezone) })),
    quotes,
    invoices: invoices.map((item) => ({ ...item, dueAt: displayDate(item.dueAt, timezone), paid: paidByInvoice.get(item.id) || 0, balance: Math.max(0, money(item.total) - (paidByInvoice.get(item.id) || 0)) })),
    payments: payments.map((item) => ({ ...item, receivedAt: displayDate(item.receivedAt, timezone) })),
    messages: messages.map((item) => ({ ...item, occurredAt: displayDate(item.occurredAt, timezone) })),
    interactions: interactions.map((item) => ({ ...item, occurredAt: displayDate(item.occurredAt, timezone) })),
  };
}

async function scheduledWork(tenant: PilotTenant, period: PilotDatePeriod, timezone: string, asOf?: Date) {
  const range = pilotDateRange(period, timezone, asOf);
  const labels = workflowLabels(tenant.businessType);
  const [appointments, jobs, shifts] = await Promise.all([
    db.select({ customerName: customer.name, title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, notes: customerAppointment.notes })
      .from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id))
      .where(and(eq(customer.businessProfileId, tenant.id), ...dateFilters(customerAppointment.scheduledAt, range), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)).orderBy(asc(customerAppointment.scheduledAt)),
    db.select({ customerName: customer.name, title: job.service, status: job.status, scheduledAt: job.scheduledAt, assignedEmployee: job.assignedEmployee, notes: job.notes })
      .from(job).innerJoin(customer, eq(job.customerId, customer.id))
      .where(and(eq(job.businessProfileId, tenant.id), ...dateFilters(job.scheduledAt, range), sql`${job.status} NOT IN ('cancelled', 'completed')`)).orderBy(asc(job.scheduledAt)),
    db.select({ employeeName: employee.name, role: employee.role, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes })
      .from(employeeShift).innerJoin(employee, eq(employeeShift.employeeId, employee.id))
      .where(and(eq(employeeShift.businessProfileId, tenant.id), ...dateFilters(employeeShift.startsAt, range))).orderBy(asc(employeeShift.startsAt)),
  ]);
  return {
    labels,
    period,
    dateRange: pilotDateRangeSummary(range),
    appointments: appointments.map((item) => ({ ...item, scheduledAt: displayDate(item.scheduledAt, timezone) })),
    [labels.recordPlural]: jobs.map((item) => ({ ...item, scheduledAt: displayDate(item.scheduledAt, timezone) })),
    employeeShifts: shifts.map((item) => ({ ...item, startsAt: displayDate(item.startsAt, timezone), endsAt: displayDate(item.endsAt, timezone) })),
  };
}

async function employeeContext(tenant: PilotTenant, employeeName: string | undefined, timezone: string, asOf?: Date) {
  const range = pilotDateRange('upcoming', timezone, asOf);
  const employees = await db.select({ id: employee.id, name: employee.name, role: employee.role, email: employee.email, phoneNumber: employee.phoneNumber, status: employee.status })
    .from(employee)
    .where(and(eq(employee.businessProfileId, tenant.id), employeeName?.trim() ? like(employee.name, `%${employeeName.trim()}%`) : undefined))
    .orderBy(asc(employee.name)).limit(20);
  if (employeeName?.trim() && employees.length !== 1) return { found: false, employeeMatches: employees.map((item) => item.name), message: employees.length ? 'More than one employee matches. Ask the owner to choose one.' : 'No employee matches that name.' };
  const ids = employees.map((item) => item.id);
  const shifts = ids.length
    ? await db.select({ employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes })
      .from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), sql`${employeeShift.employeeId} IN ${ids}`, ...dateFilters(employeeShift.startsAt, range))).orderBy(asc(employeeShift.startsAt)).limit(100)
    : [];
  return {
    found: Boolean(employeeName?.trim()) ? true : undefined,
    dateRange: pilotDateRangeSummary(range),
    employees: employees.map((item) => ({ ...item, upcomingShifts: shifts.filter((shift) => shift.employeeId === item.id).map((shift) => ({ ...shift, startsAt: displayDate(shift.startsAt, timezone), endsAt: displayDate(shift.endsAt, timezone) })) })),
  };
}

async function recordsContext(tenant: PilotTenant, record: 'leads' | 'jobs_orders' | 'payments', timezone: string) {
  if (record === 'leads') {
    const rows = await db.select({ name: lead.name, serviceRequested: lead.serviceRequested, status: lead.status, estimatedValue: lead.estimatedValue, assignedEmployee: lead.assignedEmployee, createdAt: lead.createdAt }).from(lead).where(eq(lead.businessProfileId, tenant.id)).orderBy(desc(lead.createdAt)).limit(50);
    return { record, rows, count: rows.length };
  }
  if (record === 'payments') {
    const rows = await db.select({ customerName: customer.name, amount: payment.amount, status: payment.status, method: payment.method, receivedAt: payment.receivedAt, invoiceId: payment.invoiceId }).from(payment).innerJoin(customer, eq(payment.customerId, customer.id)).where(eq(payment.businessProfileId, tenant.id)).orderBy(desc(payment.receivedAt)).limit(50);
    return { record, rows: rows.map((item) => ({ ...item, receivedAt: displayDate(item.receivedAt, timezone) })), count: rows.length };
  }
  const rows = await db.select({ customerName: customer.name, service: job.service, status: job.status, assignedEmployee: job.assignedEmployee, scheduledAt: job.scheduledAt, notes: job.notes }).from(job).innerJoin(customer, eq(job.customerId, customer.id)).where(eq(job.businessProfileId, tenant.id)).orderBy(desc(job.createdAt)).limit(50);
  const foodBusiness = isFoodBusiness(tenant.businessType);
  return {
    record,
    labels: workflowLabels(tenant.businessType),
    rows: rows.map((item) => ({
      ...item,
      ...(foodBusiness ? orderDetailsFromNotes(item.notes) : {}),
      scheduledAt: displayDate(item.scheduledAt, timezone),
    })),
    count: rows.length,
  };
}

async function financeContext(tenant: PilotTenant, timezone: string) {
  const [openInvoices, completedPayments] = await Promise.all([
    db.select({ id: invoice.id, customerName: customer.name, total: invoice.total, status: invoice.status, dueAt: invoice.dueAt })
      .from(invoice).innerJoin(customer, eq(invoice.customerId, customer.id))
      .where(and(eq(invoice.businessProfileId, tenant.id), sql`${invoice.status} NOT IN ('paid', 'cancelled', 'void')`)).orderBy(asc(invoice.dueAt)).limit(50),
    db.select({ invoiceId: payment.invoiceId, amount: payment.amount }).from(payment).where(and(eq(payment.businessProfileId, tenant.id), eq(payment.status, 'completed'))),
  ]);
  const paidByInvoice = new Map<string, number>();
  completedPayments.filter((item) => item.invoiceId).forEach((item) => paidByInvoice.set(item.invoiceId as string, (paidByInvoice.get(item.invoiceId as string) || 0) + money(item.amount)));
  const unpaidInvoices = openInvoices.map((item) => ({ ...item, dueAt: displayDate(item.dueAt, timezone), paid: paidByInvoice.get(item.id) || 0, balance: Math.max(0, money(item.total) - (paidByInvoice.get(item.id) || 0)) })).filter((item) => item.balance > 0);
  return { unpaidInvoices, outstandingBalance: unpaidInvoices.reduce((sum, item) => sum + item.balance, 0) };
}

async function quotesContext(tenant: PilotTenant, unscheduledOnly: boolean) {
  const rows = await db.select({ id: estimate.id, customerName: customer.name, status: estimate.status, total: estimate.total, createdAt: estimate.createdAt, jobId: estimate.jobId, jobScheduledAt: job.scheduledAt, jobStatus: job.status, notes: estimate.notes })
    .from(estimate).innerJoin(customer, eq(estimate.customerId, customer.id)).leftJoin(job, eq(estimate.jobId, job.id))
    .where(and(eq(estimate.businessProfileId, tenant.id), eq(estimate.status, 'accepted'))).orderBy(desc(estimate.createdAt)).limit(50);
  const quotes = rows.filter((item) => !unscheduledOnly || !item.jobId || !item.jobScheduledAt);
  return { labels: workflowLabels(tenant.businessType), quotes, count: quotes.length, unscheduledOnly };
}

const periodTopics: Record<string, PilotDatePeriod> = {
  today_schedule: 'today', tomorrow_schedule: 'tomorrow', yesterday_schedule: 'yesterday', this_week_schedule: 'this_week', next_week_schedule: 'next_week', past_schedule: 'past', future_schedule: 'future', upcoming_schedule: 'upcoming', overdue_schedule: 'overdue',
};

export async function getPilotBusinessContext(tenant: PilotTenant, topic: PilotContextTopic, options: PilotContextOptions = {}) {
  const settings = await getCalendarSettings(tenant.id);
  const base = { businessName: tenant.businessName, businessType: tenant.businessType, labels: workflowLabels(tenant.businessType), timezone: settings.timezone };
  const period = periodTopics[topic];
  if (period) return { ...base, context: await scheduledWork(tenant, period, settings.timezone, options.asOf) };
  if (topic === 'customer_history') {
    if (!options.customerName?.trim()) return { ...base, context: { found: false, message: 'A customer name is required to retrieve customer history.' } };
    return { ...base, context: await customerHistory(tenant, options.customerName, settings.timezone) };
  }
  if (topic === 'employee_lookup') return { ...base, context: await employeeContext(tenant, options.employeeName, settings.timezone, options.asOf) };
  if (topic === 'jobs_orders' || topic === 'leads' || topic === 'payments') return { ...base, context: await recordsContext(tenant, topic, settings.timezone) };
  if (topic === 'customer_overview') {
    const [count] = await db.select({ count: sql<number>`count(*)` }).from(customer).where(and(eq(customer.businessProfileId, tenant.id), sql`${customer.archivedAt} IS NULL`));
    return { ...base, context: { activeCustomers: Number(count?.count || 0) } };
  }
  if (topic === 'finance' || topic === 'unpaid_invoices') return { ...base, context: await financeContext(tenant, settings.timezone) };
  if (topic === 'accepted_quotes') return { ...base, context: await quotesContext(tenant, false) };
  if (topic === 'accepted_quotes_unscheduled') return { ...base, context: await quotesContext(tenant, true) };
  if (topic === 'inventory') {
    const facts = await searchPilotLearning(tenant.id, 'inventory stock reorder supplier');
    return {
      ...base,
      context: {
        available: false,
        learnedFacts: facts,
        message: facts.length
          ? 'These are confirmed document-derived business facts, not current inventory records. Pilot cannot confirm live stock levels or purchasing needs from them.'
          : 'No current inventory records or confirmed inventory observations are available, so Pilot cannot confirm stock levels or purchasing needs.',
      },
    };
  }
  if (topic === 'pilot_learning') {
    const [summary, facts, observations] = await Promise.all([pilotLearningSummary(tenant.id), searchPilotLearning(tenant.id, ''), structuredActivityObservations(tenant.id)]);
    return { ...base, context: { summary, facts, observations } };
  }
  if (topic === 'proactive_briefing') return { ...base, context: await getProactiveBriefing(tenant, options.asOf) };
  const [knowledge] = await db.select({ serviceArea: businessKnowledge.serviceArea, businessHours: businessKnowledge.businessHours, servicesOffered: businessKnowledge.servicesOffered, policies: businessKnowledge.policies }).from(businessKnowledge).where(eq(businessKnowledge.businessProfileId, tenant.id)).limit(1);
  return { ...base, context: { knowledge: knowledge || null, learning: await pilotLearningSummary(tenant.id), booking: { weeklyHours: settings.weeklyHours, defaultDurationMinutes: settings.defaultDurationMinutes, minimumNoticeMinutes: settings.minimumNoticeMinutes } } };
}
