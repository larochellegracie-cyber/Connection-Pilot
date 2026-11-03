import type { Request, Response } from 'express';
import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment, employee, employeeShift, estimate, invoice, job, lead, payment } from '@/server/db/schema.js';
import { getTenant, textValue } from '@/server/api/customers/tenant.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { getProactiveBriefing } from '@/server/pilot/proactive-briefing.js';
import { buildOverview, resolveRange } from '@/server/insights/overview.js';

const OPEN_INVOICE_STATUSES = ['sent', 'open', 'overdue'];
const LIMIT = 20000;

/**
 * GET /api/insights/overview?range=this_month|this_week|last_month|last_3_months|last_12_months|custom&from=&to=
 * Business performance for the Insights dashboard. Every query is scoped to the signed-in business.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'basic_insights');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });

    const now = new Date();
    const { timezone } = await getCalendarSettings(tenant.id);
    const range = resolveRange(textValue(req.query.range, 30), now, timezone, textValue(req.query.from, 10), textValue(req.query.to, 10));
    const since = range.previousStart;
    const activeCustomer = and(eq(customer.businessProfileId, tenant.id), sql`${customer.archivedAt} IS NULL`);

    const [payments, invoices, openInvoices, jobs, quotes, leads, customers, appointments, shifts, briefing] = await Promise.all([
      db.select({ amount: payment.amount, receivedAt: payment.receivedAt, createdAt: payment.createdAt }).from(payment)
        .where(and(eq(payment.businessProfileId, tenant.id), eq(payment.status, 'completed'), or(gte(payment.receivedAt, since), and(isNull(payment.receivedAt), gte(payment.createdAt, since))))).limit(LIMIT),
      db.select({ id: invoice.id, total: invoice.total, status: invoice.status, dueAt: invoice.dueAt, createdAt: invoice.createdAt }).from(invoice)
        .where(and(eq(invoice.businessProfileId, tenant.id), gte(invoice.createdAt, since))).limit(LIMIT),
      db.select({ id: invoice.id, total: invoice.total, status: invoice.status, dueAt: invoice.dueAt }).from(invoice)
        .where(and(eq(invoice.businessProfileId, tenant.id), inArray(invoice.status, OPEN_INVOICE_STATUSES))).limit(LIMIT),
      db.select({ status: job.status, scheduledAt: job.scheduledAt, createdAt: job.createdAt, customerId: job.customerId }).from(job)
        .where(and(eq(job.businessProfileId, tenant.id), or(gte(job.scheduledAt, since), and(isNull(job.scheduledAt), gte(job.createdAt, since))))).limit(LIMIT),
      db.select({ status: estimate.status, total: estimate.total, createdAt: estimate.createdAt }).from(estimate)
        .where(and(eq(estimate.businessProfileId, tenant.id), gte(estimate.createdAt, since))).limit(LIMIT),
      db.select({ status: lead.status, estimatedValue: lead.estimatedValue, createdAt: lead.createdAt }).from(lead).where(eq(lead.businessProfileId, tenant.id)).limit(LIMIT),
      db.select({ id: customer.id, createdAt: customer.createdAt }).from(customer).where(activeCustomer).limit(LIMIT),
      db.select({ status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, customerId: customerAppointment.customerId }).from(customerAppointment)
        .innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(activeCustomer, gte(customerAppointment.scheduledAt, since))).limit(LIMIT),
      db.select({ employeeId: employeeShift.employeeId, employeeName: employee.name, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt }).from(employeeShift)
        .innerJoin(employee, eq(employeeShift.employeeId, employee.id)).where(and(eq(employeeShift.businessProfileId, tenant.id), gte(employeeShift.startsAt, range.start), lt(employeeShift.startsAt, range.end))).limit(LIMIT),
      getProactiveBriefing(tenant, now),
    ]);

    // What has already been paid towards the unpaid invoices, whenever it was paid.
    const receivedByInvoice = new Map<string, number>();
    if (openInvoices.length) {
      const toward = await db.select({ invoiceId: payment.invoiceId, amount: payment.amount }).from(payment)
        .where(and(eq(payment.businessProfileId, tenant.id), eq(payment.status, 'completed'), inArray(payment.invoiceId, openInvoices.map((row) => row.id))));
      for (const row of toward) if (row.invoiceId) receivedByInvoice.set(row.invoiceId, (receivedByInvoice.get(row.invoiceId) ?? 0) + Number(row.amount || 0));
    }

    const overview = buildOverview({
      now, timezone, range,
      payments: payments.map((row) => ({ amount: row.amount, occurredAt: row.receivedAt ?? row.createdAt ?? now })),
      invoices, openInvoices, receivedByInvoice,
      jobs: jobs.map((row) => ({ status: row.status, date: row.scheduledAt ?? row.createdAt, customerId: row.customerId })),
      quotes, leads, customers, appointments, shifts,
    });
    res.json({ ...overview, timezone, recommendations: briefing.insights, updatedAt: briefing.updatedAt });
  } catch (error) {
    console.error('insights.overview.failed', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    res.status(500).json({ error: 'Unable to load your insights right now.' });
  }
}
