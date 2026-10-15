import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, estimate, invoice, job, jobFile, payment } from '@/server/db/schema.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { getTenant, textValue } from '../../../customers/tenant.js';
import { isEstimateStatus, isInvoiceStatus, isPaymentStatus, lineItemsFrom, logFinanceActivity, replaceLineItems, syncInvoicePaymentStatus } from '../../shared.js';

function moneyValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : null; }
function dateValue(value: unknown) { if (!value) return null; const date = new Date(textValue(value, 64)); return Number.isNaN(date.getTime()) ? null : date; }
function recordTypeFrom(value: unknown) { const type = textValue(value, 20); return type === 'estimates' ? 'estimate' : type === 'invoices' ? 'invoice' : type === 'payments' ? 'payment' : type === 'jobFiles' ? 'jobFile' : type; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const recordType = recordTypeFrom(req.params.recordType); const recordId = textValue(req.params.recordId, 36);
    if (recordType === 'estimate') {
      const record = (await db.select().from(estimate).where(and(eq(estimate.id, recordId), eq(estimate.businessProfileId, tenant.id))).limit(1))[0]; if (!record) return void res.status(404).json({ error: 'Quote not found.' });
      const requestedStatus = textValue(req.body.status, 30); if (requestedStatus && (!isEstimateStatus(requestedStatus) || requestedStatus === 'sent')) return void res.status(400).json({ error: 'Use Send Quote to email the customer and mark a quote as sent.' });
      const parsedItems = req.body.lineItems === undefined ? null : lineItemsFrom(req.body.lineItems); if (parsedItems && 'error' in parsedItems) return void res.status(400).json({ error: parsedItems.error });
      await db.transaction(async (tx) => {
        let jobId = record.jobId;
        if (requestedStatus === 'accepted' && !jobId) {
          const items = parsedItems && !('error' in parsedItems) ? parsedItems.items : [];
          const createdJobId = randomUUID(); const service = (items.map((item) => item.description).join(', ') || 'Accepted quote').slice(0, 255);
          const notes = isFoodBusiness(tenant.businessType) ? JSON.stringify({ items: items.map((item) => ({ name: item.description, quantity: Number(item.quantity) })), fulfillment: 'pickup', total: parsedItems && !('error' in parsedItems) ? parsedItems.total : record.total, notes: 'Created from accepted quote.' }) : `Created from accepted quote. ${items.map((item) => `${item.quantity} × ${item.description}`).join('; ')}`;
          await tx.insert(job).values({ id: createdJobId, businessProfileId: tenant.id, customerId: record.customerId, service, status: 'booked', notes }); jobId = createdJobId;
        }
        const totals = parsedItems && !('error' in parsedItems) ? { subtotal: parsedItems.subtotal, taxTotal: parsedItems.taxTotal, total: parsedItems.total } : {};
        await tx.update(estimate).set({ ...totals, ...(jobId !== record.jobId ? { jobId } : {}), ...(requestedStatus ? { status: requestedStatus } : {}), ...(typeof req.body.notes === 'string' ? { notes: textValue(req.body.notes, 5000) || null } : {}), ...(req.body.expiresAt !== undefined ? { expiresAt: dateValue(req.body.expiresAt) } : {}) }).where(and(eq(estimate.id, recordId), eq(estimate.businessProfileId, tenant.id)));
        if (parsedItems && !('error' in parsedItems)) await replaceLineItems(tx, { estimateId: recordId }, parsedItems.items);
        await logFinanceActivity(tx, record.customerId, jobId, 'Quote updated', requestedStatus === 'accepted' ? 'Accepted and linked to a job/order.' : 'Details updated');
      });
    } else if (recordType === 'invoice') {
      const record = (await db.select().from(invoice).where(and(eq(invoice.id, recordId), eq(invoice.businessProfileId, tenant.id))).limit(1))[0]; if (!record) return void res.status(404).json({ error: 'Invoice not found.' });
      const requestedStatus = textValue(req.body.status, 30); if (requestedStatus && (!isInvoiceStatus(requestedStatus) || requestedStatus === 'paid')) return void res.status(400).json({ error: 'Record a completed payment to mark an invoice as paid.' });
      const parsedItems = req.body.lineItems === undefined ? null : lineItemsFrom(req.body.lineItems); if (parsedItems && 'error' in parsedItems) return void res.status(400).json({ error: parsedItems.error });
      await db.transaction(async (tx) => { const totals = parsedItems && !('error' in parsedItems) ? { subtotal: parsedItems.subtotal, taxTotal: parsedItems.taxTotal, total: parsedItems.total } : {}; await tx.update(invoice).set({ ...totals, ...(requestedStatus ? { status: requestedStatus } : {}), ...(typeof req.body.notes === 'string' ? { notes: textValue(req.body.notes, 5000) || null } : {}), ...(req.body.dueAt !== undefined ? { dueAt: dateValue(req.body.dueAt) } : {}) }).where(and(eq(invoice.id, recordId), eq(invoice.businessProfileId, tenant.id))); if (parsedItems && !('error' in parsedItems)) await replaceLineItems(tx, { invoiceId: recordId }, parsedItems.items); await syncInvoicePaymentStatus(tx, recordId, tenant.id); await logFinanceActivity(tx, record.customerId, record.jobId, 'Invoice updated', 'Details updated'); });
    } else if (recordType === 'payment') {
      const record = (await db.select().from(payment).where(and(eq(payment.id, recordId), eq(payment.businessProfileId, tenant.id))).limit(1))[0]; if (!record) return void res.status(404).json({ error: 'Payment not found.' });
      const amount = req.body.amount === undefined ? null : moneyValue(req.body.amount); if (req.body.amount !== undefined && (!amount || Number(amount) === 0)) return void res.status(400).json({ error: 'Enter a payment amount greater than zero.' }); const requestedStatus = textValue(req.body.status, 30); if (requestedStatus && !isPaymentStatus(requestedStatus)) return void res.status(400).json({ error: 'Choose a valid payment status.' });
      await db.transaction(async (tx) => { await tx.update(payment).set({ ...(amount ? { amount } : {}), ...(requestedStatus ? { status: requestedStatus } : {}), ...(typeof req.body.method === 'string' ? { method: textValue(req.body.method, 50) || null } : {}), ...(typeof req.body.notes === 'string' ? { notes: textValue(req.body.notes, 5000) || null } : {}), ...(req.body.receivedAt !== undefined ? { receivedAt: dateValue(req.body.receivedAt) } : {}) }).where(and(eq(payment.id, recordId), eq(payment.businessProfileId, tenant.id))); if (record.invoiceId) await syncInvoicePaymentStatus(tx, record.invoiceId, tenant.id); await logFinanceActivity(tx, record.customerId, null, 'Payment updated', 'Details updated'); });
    } else if (recordType === 'jobFile') {
      const record = (await db.select({ id: jobFile.id, jobId: jobFile.jobId, customerId: customer.id }).from(jobFile).innerJoin(job, eq(jobFile.jobId, job.id)).innerJoin(customer, eq(job.customerId, customer.id)).where(and(eq(jobFile.id, recordId), eq(job.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).limit(1))[0]; if (!record) return void res.status(404).json({ error: 'Job attachment not found.' }); const fileName = textValue(req.body.fileName, 255); if (!fileName) return void res.status(400).json({ error: 'Add an attachment name.' }); await db.transaction(async (tx) => { await tx.update(jobFile).set({ fileName, fileType: textValue(req.body.fileType, 120) || null }).where(and(eq(jobFile.id, recordId), eq(jobFile.jobId, record.jobId))); await logFinanceActivity(tx, record.customerId, record.jobId, 'Job attachment updated', fileName); });
    } else return void res.status(400).json({ error: 'Choose a valid finance record type.' });
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: 'Unable to update finance record.', message: String(error) }); }
}
