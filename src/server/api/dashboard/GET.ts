import type { Request, Response } from 'express';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessNotification, customer, customerActivity, customerAppointment, customerInteraction, estimate, invoice, job, jobActivity, lead, leadActivity, payment } from '@/server/db/schema.js';
import { getTenant } from '@/server/api/customers/tenant.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { getProactiveBriefing } from '@/server/pilot/proactive-briefing.js';

function number(value: unknown): number { return Number(value || 0); }

function zonedDayRange(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  const year = part('year'); const month = part('month'); const day = part('day');
  const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(new Date(`${year}-${month}-${day}T12:00:00Z`)).find((item) => item.type === 'timeZoneName')?.value || 'GMT';
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0;
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) - offsetMinutes * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return { start, end };
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const { start: today, end: tomorrow } = zonedDayRange('America/Toronto');
    const foodBusiness = isFoodBusiness(tenant.businessType);
    const activeCustomer = and(eq(customer.businessProfileId, tenant.id), sql`${customer.archivedAt} IS NULL`);
    const openLeadStatuses = ['new', 'contacted', 'qualified'];
    const activeJobStatuses = ['booked', 'in_progress'];
    const openInvoiceStatuses = ['sent', 'overdue', 'open'];

    const [todaySchedule, counts, finance, attentionRows, unreadNotifications, customerActivityRows, leadActivityRows, jobActivityRows, appointmentRows, proactiveBriefing] = await Promise.all([
      foodBusiness
        ? db.select({ id: job.id, customerId: customer.id, customerName: customer.name, title: job.service, status: job.status, scheduledAt: job.scheduledAt }).from(job).innerJoin(customer, eq(job.customerId, customer.id)).where(and(eq(job.businessProfileId, tenant.id), activeCustomer, gte(job.scheduledAt, today), lt(job.scheduledAt, tomorrow), sql`${job.status} NOT IN ('cancelled', 'completed')`)).orderBy(job.scheduledAt)
        : db.select({ id: customerAppointment.id, customerId: customer.id, customerName: customer.name, title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt }).from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(activeCustomer, gte(customerAppointment.scheduledAt, today), lt(customerAppointment.scheduledAt, tomorrow), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)).orderBy(customerAppointment.scheduledAt),
      Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(lead).where(and(eq(lead.businessProfileId, tenant.id), inArray(lead.status, openLeadStatuses))),
        db.select({ count: sql<number>`count(*)` }).from(job).where(and(eq(job.businessProfileId, tenant.id), inArray(job.status, activeJobStatuses))),
        db.select({ count: sql<number>`count(*)` }).from(estimate).where(and(eq(estimate.businessProfileId, tenant.id), inArray(estimate.status, ['draft', 'sent']))),
        db.select({ count: sql<number>`count(*)` }).from(invoice).where(and(eq(invoice.businessProfileId, tenant.id), inArray(invoice.status, openInvoiceStatuses))),
      ]),
      Promise.all([
        db.select({ id: invoice.id, total: invoice.total, status: invoice.status }).from(invoice).where(eq(invoice.businessProfileId, tenant.id)),
        db.select({ invoiceId: payment.invoiceId, amount: payment.amount, status: payment.status }).from(payment).where(eq(payment.businessProfileId, tenant.id)),
      ]),
      db.select({ id: customerInteraction.id, customerId: customer.id, customerName: customer.name, title: customerInteraction.summary, occurredAt: customerInteraction.occurredAt }).from(customerInteraction).innerJoin(customer, eq(customerInteraction.customerId, customer.id)).where(and(activeCustomer, eq(customerInteraction.followUpNeeded, true))).orderBy(desc(customerInteraction.occurredAt)).limit(8),
      db.select({ id: businessNotification.id, customerId: businessNotification.customerId, customerName: customer.name, title: businessNotification.title, createdAt: businessNotification.createdAt }).from(businessNotification).innerJoin(customer, eq(businessNotification.customerId, customer.id)).where(and(eq(businessNotification.businessProfileId, tenant.id), sql`${businessNotification.readAt} IS NULL`)).orderBy(desc(businessNotification.createdAt)).limit(8),
      db.select({ id: customerActivity.id, customerId: customer.id, customerName: customer.name, title: customerActivity.title, detail: customerActivity.detail, occurredAt: customerActivity.occurredAt, type: customerActivity.activityType }).from(customerActivity).innerJoin(customer, eq(customerActivity.customerId, customer.id)).where(activeCustomer).orderBy(desc(customerActivity.occurredAt)).limit(8),
      db.select({ id: leadActivity.id, title: leadActivity.title, detail: leadActivity.detail, occurredAt: leadActivity.occurredAt, type: leadActivity.activityType }).from(leadActivity).innerJoin(lead, eq(leadActivity.leadId, lead.id)).where(eq(lead.businessProfileId, tenant.id)).orderBy(desc(leadActivity.occurredAt)).limit(8),
      db.select({ id: jobActivity.id, title: jobActivity.title, detail: jobActivity.detail, occurredAt: jobActivity.occurredAt, type: jobActivity.activityType }).from(jobActivity).innerJoin(job, eq(jobActivity.jobId, job.id)).where(eq(job.businessProfileId, tenant.id)).orderBy(desc(jobActivity.occurredAt)).limit(8),
      db.select({ id: customerAppointment.id, customerId: customer.id, customerName: customer.name, title: customerAppointment.title, occurredAt: customerAppointment.updatedAt, status: customerAppointment.status }).from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(activeCustomer).orderBy(desc(customerAppointment.updatedAt)).limit(8),
      getProactiveBriefing(tenant),
    ]);

    const openLeads = number(counts[0][0]?.count);
    const activeJobs = number(counts[1][0]?.count);
    const estimates = number(counts[2][0]?.count);
    const invoices = number(counts[3][0]?.count);
    const receivedByInvoice = new Map<string, number>();
    for (const record of finance[1]) if (record.status === 'completed' && record.invoiceId) receivedByInvoice.set(record.invoiceId, (receivedByInvoice.get(record.invoiceId) || 0) + number(record.amount));
    const unpaidBalance = finance[0].filter((record) => openInvoiceStatuses.includes(record.status)).reduce((sum, record) => sum + Math.max(0, number(record.total) - (receivedByInvoice.get(record.id) || 0)), 0);
    const revenue = finance[1].filter((record) => record.status === 'completed').reduce((sum, record) => sum + number(record.amount), 0);
    const cancelledRows = appointmentRows.filter((item) => item.status === 'cancelled').slice(0, 6);
    const attention = [
      ...attentionRows.map((item) => ({ id: item.id, customerId: item.customerId, customerName: item.customerName, title: item.title || 'Customer follow-up', kind: 'follow_up' as const, occurredAt: item.occurredAt })),
      ...unreadNotifications.map((item) => ({ id: item.id, customerId: item.customerId, customerName: item.customerName, title: item.title, kind: 'unread' as const, occurredAt: item.createdAt })),
      ...cancelledRows.map((item) => ({ id: item.id, customerId: item.customerId, customerName: item.customerName, title: item.title, kind: 'cancelled' as const, occurredAt: item.occurredAt })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 10);

    const recentActivity = [
      ...customerActivityRows.map((item) => ({ id: `customer-${item.id}`, customerId: item.customerId, customerName: item.customerName, title: item.title, detail: item.detail, type: item.type, occurredAt: item.occurredAt })),
      ...leadActivityRows.map((item) => ({ id: `lead-${item.id}`, customerId: null, customerName: 'Lead pipeline', title: item.title, detail: item.detail, type: item.type, occurredAt: item.occurredAt })),
      ...jobActivityRows.map((item) => ({ id: `job-${item.id}`, customerId: null, customerName: 'Jobs', title: item.title, detail: item.detail, type: item.type, occurredAt: item.occurredAt })),
      ...appointmentRows.map((item) => ({ id: `appointment-${item.id}`, customerId: item.customerId, customerName: item.customerName, title: item.title, detail: item.status, type: 'appointment', occurredAt: item.occurredAt })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 10);

    res.json({ businessName: tenant.businessName, businessType: tenant.businessType, todaySchedule, summary: { openLeads, activeJobs, estimates, invoices, unpaidBalance, revenue }, attention, recentActivity, briefing: { todayAppointments: todaySchedule.length, attentionItems: attention.length, openLeads, activeJobs }, proactiveBriefing });
  } catch (error) { res.status(500).json({ error: 'Unable to load dashboard data.', message: String(error) }); }
}
