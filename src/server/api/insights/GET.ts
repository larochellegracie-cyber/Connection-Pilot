import type { Request, Response } from 'express';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment, invoice, job, payment } from '@/server/db/schema.js';
import { getTenant } from '@/server/api/customers/tenant.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { getProactiveBriefing } from '@/server/pilot/proactive-briefing.js';
import { buildInsights } from '@/server/insights/analytics.js';

const DAY_MS = 86_400_000;
const OPEN_INVOICE_STATUSES = ['sent', 'open', 'overdue'];

/**
 * GET /api/insights: trends and patterns for the Insights page, built from the business's own records,
 * plus Pilot's recommendations from the same proactive intelligence the Home page uses.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'basic_insights');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });

    const now = new Date();
    const since120 = new Date(now.getTime() - 120 * DAY_MS);
    const since90 = new Date(now.getTime() - 90 * DAY_MS);
    const activeCustomer = and(eq(customer.businessProfileId, tenant.id), sql`${customer.archivedAt} IS NULL`);
    const [{ timezone }, payments, customers, appointments, jobs, openInvoices, briefing] = await Promise.all([
      getCalendarSettings(tenant.id),
      db.select({ amount: payment.amount, receivedAt: payment.receivedAt, createdAt: payment.createdAt }).from(payment)
        .where(and(eq(payment.businessProfileId, tenant.id), eq(payment.status, 'completed'), gte(payment.createdAt, since120))).orderBy(desc(payment.createdAt)).limit(5000),
      db.select({ createdAt: customer.createdAt, lastContactedAt: customer.lastContactedAt }).from(customer).where(activeCustomer).limit(5000),
      db.select({ scheduledAt: customerAppointment.scheduledAt, status: customerAppointment.status }).from(customerAppointment)
        .innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(activeCustomer, gte(customerAppointment.scheduledAt, since120))).limit(5000),
      db.select({ service: job.service, createdAt: job.createdAt }).from(job).where(and(eq(job.businessProfileId, tenant.id), gte(job.createdAt, since90))).limit(5000),
      db.select({ id: invoice.id, total: invoice.total, dueAt: invoice.dueAt }).from(invoice).where(and(eq(invoice.businessProfileId, tenant.id), inArray(invoice.status, OPEN_INVOICE_STATUSES))).limit(1000),
      getProactiveBriefing(tenant, now),
    ]);

    // What has already been paid towards the open invoices, whenever it was paid.
    const received = new Map<string, number>();
    if (openInvoices.length) {
      const toward = await db.select({ invoiceId: payment.invoiceId, amount: payment.amount }).from(payment)
        .where(and(eq(payment.businessProfileId, tenant.id), eq(payment.status, 'completed'), inArray(payment.invoiceId, openInvoices.map((item) => item.id))));
      for (const row of toward) if (row.invoiceId) received.set(row.invoiceId, (received.get(row.invoiceId) ?? 0) + Number(row.amount || 0));
    }

    const analytics = buildInsights({
      now, timezone,
      payments: payments.map((row) => ({ amount: row.amount, occurredAt: row.receivedAt ?? row.createdAt ?? now })),
      customers, appointments, jobs, receivedByInvoice: received,
      openInvoices,
    });
    res.json({ analytics, recommendations: briefing.insights, updatedAt: briefing.updatedAt });
  } catch (error) {
    console.error('insights.failed', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    res.status(500).json({ error: 'Unable to load your insights right now.' });
  }
}
