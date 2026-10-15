import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, customerActivity, financeLineItem, invoice, job, jobActivity, payment } from '@/server/db/schema.js';

export type FinanceLineItemInput = { description: string; quantity: string; unitPrice: string; subtotal: string; taxRate: string; taxAmount: string; total: string; position: number };
export const estimateStatuses = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export const invoiceStatuses = ['draft', 'sent', 'open', 'paid', 'overdue', 'void'] as const;
export const invoiceReceivableStatuses = ['sent', 'open', 'overdue'] as const;
export const paymentStatuses = ['pending', 'completed', 'refunded'] as const;

export function isEstimateStatus(value: string): value is (typeof estimateStatuses)[number] { return estimateStatuses.includes(value as (typeof estimateStatuses)[number]); }
export function isInvoiceStatus(value: string): value is (typeof invoiceStatuses)[number] { return invoiceStatuses.includes(value as (typeof invoiceStatuses)[number]); }
export function isPaymentStatus(value: string): value is (typeof paymentStatuses)[number] { return paymentStatuses.includes(value as (typeof paymentStatuses)[number]); }

function numberValue(value: unknown, minimum: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= minimum ? parsed : null; }
function rounded(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function lineItemsFrom(value: unknown): { items: FinanceLineItemInput[]; subtotal: string; taxTotal: string; total: string } | { error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return { error: 'Add at least one valid line item.' };
  const items: FinanceLineItemInput[] = [];
  for (const [position, raw] of value.entries()) {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const description = typeof item?.description === 'string' ? item.description.trim().slice(0, 1000) : '';
    const quantity = numberValue(item?.quantity, 0.01);
    const unitPrice = numberValue(item?.unitPrice, 0);
    const taxRate = numberValue(item?.taxRate ?? 0, 0);
    if (!description || quantity === null || unitPrice === null || taxRate === null || taxRate > 100) return { error: 'Every line item needs a description, positive quantity, valid price, and tax rate from 0 to 100.' };
    const subtotal = rounded(quantity * unitPrice);
    const taxAmount = rounded(subtotal * taxRate / 100);
    const total = rounded(subtotal + taxAmount);
    items.push({ description, quantity: quantity.toFixed(2), unitPrice: unitPrice.toFixed(2), subtotal: subtotal.toFixed(2), taxRate: taxRate.toFixed(4), taxAmount: taxAmount.toFixed(2), total: total.toFixed(2), position });
  }
  const subtotal = rounded(items.reduce((sum, item) => sum + Number(item.subtotal), 0));
  const taxTotal = rounded(items.reduce((sum, item) => sum + Number(item.taxAmount), 0));
  return { items, subtotal: subtotal.toFixed(2), taxTotal: taxTotal.toFixed(2), total: rounded(subtotal + taxTotal).toFixed(2) };
}

export async function replaceLineItems(writer: Pick<typeof db, 'delete' | 'insert'>, parent: { estimateId?: string; invoiceId?: string }, items: FinanceLineItemInput[]) {
  if (parent.estimateId) await writer.delete(financeLineItem).where(eq(financeLineItem.estimateId, parent.estimateId));
  if (parent.invoiceId) await writer.delete(financeLineItem).where(eq(financeLineItem.invoiceId, parent.invoiceId));
  await writer.insert(financeLineItem).values(items.map((item) => ({ id: randomUUID(), ...parent, ...item })));
}

export async function findTenantCustomer(customerId: string, tenantId: string) {
  return (await db.select({ id: customer.id, name: customer.name }).from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenantId))).limit(1))[0] || null;
}
export async function findTenantJob(jobId: string, tenantId: string, customerId?: string) {
  const predicates = [eq(job.id, jobId), eq(job.businessProfileId, tenantId)];
  if (customerId) predicates.push(eq(job.customerId, customerId));
  return (await db.select({ id: job.id, service: job.service, customerId: job.customerId }).from(job).where(and(...predicates)).limit(1))[0] || null;
}
export async function logFinanceActivity(writer: Pick<typeof db, 'insert'>, customerId: string, jobId: string | null | undefined, title: string, detail: string) {
  await writer.insert(customerActivity).values({ id: randomUUID(), customerId, activityType: 'finance', title, detail });
  if (jobId) await writer.insert(jobActivity).values({ id: randomUUID(), jobId, activityType: 'finance', title, detail });
}
export async function syncInvoicePaymentStatus(writer: Pick<typeof db, 'select' | 'update'>, invoiceId: string, tenantId: string) {
  const record = (await writer.select({ id: invoice.id, total: invoice.total, status: invoice.status }).from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.businessProfileId, tenantId))).limit(1))[0];
  if (!record || record.status === 'void') return;
  const paymentRows = await writer.select({ total: sql<string>`COALESCE(SUM(${payment.amount}), 0)` }).from(payment).where(and(eq(payment.invoiceId, invoiceId), eq(payment.businessProfileId, tenantId), eq(payment.status, 'completed')));
  const received = Number(paymentRows[0]?.total || 0); const total = Number(record.total);
  const nextStatus = received >= total && total > 0 ? 'paid' : received > 0 || record.status === 'paid' ? 'open' : record.status;
  if (nextStatus !== record.status) await writer.update(invoice).set({ status: nextStatus }).where(and(eq(invoice.id, invoiceId), eq(invoice.businessProfileId, tenantId)));
}
