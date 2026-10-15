import type { Request, Response } from 'express';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, estimate, financeLineItem, invoice, job, jobFile, payment } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';
import { invoiceReceivableStatuses } from './shared.js';

function invoicePaymentStatus(total: number, received: number, storedStatus: string) { if (storedStatus === 'void' || storedStatus === 'draft') return storedStatus; if (received >= total && total > 0) return 'paid'; if (received > 0) return 'partially_paid'; return storedStatus === 'overdue' ? 'overdue' : 'unpaid'; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const [estimates, invoiceRows, paymentRows] = await Promise.all([
      db.select({ id: estimate.id, customerId: estimate.customerId, customerName: customer.name, jobId: estimate.jobId, jobService: job.service, status: estimate.status, subtotal: estimate.subtotal, taxTotal: estimate.taxTotal, total: estimate.total, notes: estimate.notes, expiresAt: estimate.expiresAt, createdAt: estimate.createdAt }).from(estimate).innerJoin(customer, eq(estimate.customerId, customer.id)).leftJoin(job, eq(estimate.jobId, job.id)).where(and(eq(estimate.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).orderBy(desc(estimate.createdAt)),
      db.select({ id: invoice.id, customerId: invoice.customerId, customerName: customer.name, jobId: invoice.jobId, jobService: job.service, status: invoice.status, subtotal: invoice.subtotal, taxTotal: invoice.taxTotal, total: invoice.total, notes: invoice.notes, dueAt: invoice.dueAt, createdAt: invoice.createdAt }).from(invoice).innerJoin(customer, eq(invoice.customerId, customer.id)).leftJoin(job, eq(invoice.jobId, job.id)).where(and(eq(invoice.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).orderBy(desc(invoice.createdAt)),
      db.select({ id: payment.id, customerId: payment.customerId, customerName: customer.name, invoiceId: payment.invoiceId, invoiceTotal: invoice.total, invoiceJobId: invoice.jobId, invoiceJobService: job.service, status: payment.status, amount: payment.amount, method: payment.method, notes: payment.notes, receivedAt: payment.receivedAt, createdAt: payment.createdAt }).from(payment).innerJoin(customer, eq(payment.customerId, customer.id)).leftJoin(invoice, eq(payment.invoiceId, invoice.id)).leftJoin(job, eq(invoice.jobId, job.id)).where(and(eq(payment.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).orderBy(desc(payment.receivedAt), desc(payment.createdAt)),
    ]);
    const estimateIds = estimates.map((record) => record.id); const invoiceIds = invoiceRows.map((record) => record.id);
    const itemRows = estimateIds.length || invoiceIds.length ? await db.select().from(financeLineItem).where(or(estimateIds.length ? inArray(financeLineItem.estimateId, estimateIds) : undefined, invoiceIds.length ? inArray(financeLineItem.invoiceId, invoiceIds) : undefined)) : [];
    const itemsByEstimate = new Map<string, typeof itemRows>(); const itemsByInvoice = new Map<string, typeof itemRows>();
    itemRows.forEach((item) => { if (item.estimateId) itemsByEstimate.set(item.estimateId, [...(itemsByEstimate.get(item.estimateId) || []), item]); if (item.invoiceId) itemsByInvoice.set(item.invoiceId, [...(itemsByInvoice.get(item.invoiceId) || []), item]); });
    const jobFiles = await db.select({ id: jobFile.id, jobId: job.id, customerId: customer.id, customerName: customer.name, jobService: job.service, fileName: jobFile.fileName, fileUrl: jobFile.fileUrl, fileType: jobFile.fileType, createdAt: jobFile.createdAt }).from(jobFile).innerJoin(job, eq(jobFile.jobId, job.id)).innerJoin(customer, eq(job.customerId, customer.id)).where(and(eq(job.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).orderBy(desc(jobFile.createdAt));
    const receivedByInvoice = new Map<string, number>(); paymentRows.forEach((record) => { if (record.status === 'completed' && record.invoiceId) receivedByInvoice.set(record.invoiceId, (receivedByInvoice.get(record.invoiceId) || 0) + Number(record.amount)); });
    const invoiceRecords = invoiceRows.map((record) => { const received = receivedByInvoice.get(record.id) || 0; const total = Number(record.total); return { ...record, lineItems: itemsByInvoice.get(record.id) || [], received, balance: Math.max(0, total - received), paymentStatus: invoicePaymentStatus(total, received, record.status) }; });
    const estimateRecords = estimates.map((record) => ({ ...record, lineItems: itemsByEstimate.get(record.id) || [] }));
    const estimated = estimates.filter((record) => !['declined', 'expired'].includes(record.status)).reduce((sum, record) => sum + Number(record.total), 0);
    const invoiced = invoiceRows.filter((record) => !['void', 'draft'].includes(record.status)).reduce((sum, record) => sum + Number(record.total), 0);
    const received = paymentRows.filter((record) => record.status === 'completed').reduce((sum, record) => sum + Number(record.amount), 0);
    const outstanding = invoiceRecords.filter((record) => invoiceReceivableStatuses.includes(record.status as (typeof invoiceReceivableStatuses)[number]) || ['partially_paid', 'unpaid'].includes(record.paymentStatus)).reduce((sum, record) => sum + record.balance, 0);
    res.json({ estimates: estimateRecords, invoices: invoiceRecords, payments: paymentRows, jobFiles, summary: { estimated, invoiced, received, outstanding } });
  } catch (error) { res.status(500).json({ error: 'Unable to load finance records.', message: String(error) }); }
}
