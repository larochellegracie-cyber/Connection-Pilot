import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment, customerInteraction, estimate, invoice, job, pilotKnowledgeFact } from '@/server/db/schema.js';
import { getCalendarSettings } from '@/server/api/calendar/shared.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { buildProactiveInsights, type PilotInsight } from '@/server/pilot/proactive-insights.js';
import type { PilotTenant } from '@/server/pilot/business-context.js';

function dateRange(now: Date) { return { end: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) }; }

export async function getProactiveBriefing(tenant: PilotTenant, now = new Date()): Promise<{ updatedAt: Date; insights: PilotInsight[] }> {
  const settings = await getCalendarSettings(tenant.id);
  const range = dateRange(now);
  const activeCustomer = and(eq(customer.businessProfileId, tenant.id), sql`${customer.archivedAt} IS NULL`);
  const foodBusiness = isFoodBusiness(tenant.businessType);
  const [appointments, jobs, followUps, invoices, quotes, facts] = await Promise.all([
    db.select({ id: customerAppointment.id, title: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, customerName: customer.name, durationMinutes: customerAppointment.durationMinutes })
      .from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id))
      .where(and(activeCustomer, gte(customerAppointment.scheduledAt, now), lt(customerAppointment.scheduledAt, range.end), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)).orderBy(asc(customerAppointment.scheduledAt)).limit(20),
    db.select({ id: job.id, title: job.service, scheduledAt: job.scheduledAt, customerName: customer.name })
      .from(job).innerJoin(customer, eq(job.customerId, customer.id))
      .where(and(eq(job.businessProfileId, tenant.id), activeCustomer, gte(job.scheduledAt, now), lt(job.scheduledAt, range.end), sql`${job.status} NOT IN ('cancelled', 'completed')`)).orderBy(asc(job.scheduledAt)).limit(20),
    db.select({ id: customerInteraction.id, customerName: customer.name, summary: customerInteraction.summary, occurredAt: customerInteraction.occurredAt })
      .from(customerInteraction).innerJoin(customer, eq(customerInteraction.customerId, customer.id))
      .where(and(activeCustomer, eq(customerInteraction.followUpNeeded, true))).orderBy(asc(customerInteraction.occurredAt)).limit(10),
    db.select({ id: invoice.id, customerName: customer.name, total: invoice.total, dueAt: invoice.dueAt, status: invoice.status })
      .from(invoice).innerJoin(customer, eq(invoice.customerId, customer.id))
      .where(and(eq(invoice.businessProfileId, tenant.id), inArray(invoice.status, ['sent', 'open', 'overdue']))).limit(20),
    db.select({ id: estimate.id, customerName: customer.name, total: estimate.total, createdAt: estimate.createdAt, status: estimate.status })
      .from(estimate).innerJoin(customer, eq(estimate.customerId, customer.id))
      .where(and(eq(estimate.businessProfileId, tenant.id), eq(estimate.status, 'sent'))).limit(20),
    db.select({ id: pilotKnowledgeFact.id, kind: pilotKnowledgeFact.kind, subject: pilotKnowledgeFact.subject, predicate: pilotKnowledgeFact.predicate, value: pilotKnowledgeFact.value, unit: pilotKnowledgeFact.unit, details: pilotKnowledgeFact.details })
      .from(pilotKnowledgeFact).where(and(eq(pilotKnowledgeFact.businessProfileId, tenant.id), eq(pilotKnowledgeFact.status, 'accepted'))).limit(100),
  ]);
  const relevantUpcoming = foodBusiness ? jobs.filter((record): record is typeof record & { scheduledAt: Date } => record.scheduledAt !== null) : appointments;
  const insights = buildProactiveInsights({
    businessType: tenant.businessType, now, upcoming: relevantUpcoming, appointments, followUps,
    invoices: invoices.map((item) => ({ ...item, total: Number(item.total) })), quotes: quotes.map((item) => ({ ...item, total: Number(item.total) })),
    facts, allowOverlaps: settings.allowOverlaps,
  });
  return { updatedAt: now, insights };
}
