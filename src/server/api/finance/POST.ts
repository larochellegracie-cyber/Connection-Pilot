import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { estimate, invoice, job, jobFile, payment } from '@/server/db/schema.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { findTenantCustomer, findTenantJob, isEstimateStatus, isInvoiceStatus, isPaymentStatus, lineItemsFrom, logFinanceActivity, replaceLineItems, syncInvoicePaymentStatus } from './shared.js';

function moneyValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : null; }
function dateValue(value: unknown) { if (!value) return null; const date = new Date(textValue(value, 64)); return Number.isNaN(date.getTime()) ? null : date; }
function recordTypeFrom(value: unknown) { const type = textValue(value, 20); return type === 'estimates' ? 'estimate' : type === 'invoices' ? 'invoice' : type === 'payments' ? 'payment' : type === 'jobFiles' ? 'jobFile' : type; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const recordType = recordTypeFrom(req.body.recordType);
    const customerId = textValue(req.body.customerId, 36); const jobId = textValue(req.body.jobId, 36) || null;
    const linkedCustomer = await findTenantCustomer(customerId, tenant.id);
    if (!linkedCustomer) return void res.status(400).json({ error: 'Choose a customer from this business.' });
    const linkedJob = jobId ? await findTenantJob(jobId, tenant.id, customerId) : null;
    if (jobId && !linkedJob) return void res.status(400).json({ error: 'Choose a linked job for the selected customer.' });
    const clientRequestId = textValue(req.body.clientRequestId, 36) || null;

    if (recordType === 'estimate' || recordType === 'invoice') {
      const parsedItems = lineItemsFrom(req.body.lineItems); if ('error' in parsedItems) return void res.status(400).json({ error: parsedItems.error });
      const requestedStatus = textValue(req.body.status, 30);
      if (recordType === 'estimate' && requestedStatus && (!isEstimateStatus(requestedStatus) || requestedStatus === 'sent')) return void res.status(400).json({ error: 'Use Send Quote to email the customer and mark a quote as sent.' });
      if (recordType === 'invoice' && requestedStatus && (!isInvoiceStatus(requestedStatus) || requestedStatus === 'paid')) return void res.status(400).json({ error: 'Record a completed payment to mark an invoice as paid.' });
      const status = recordType === 'estimate' ? (isEstimateStatus(requestedStatus) ? requestedStatus : 'draft') : (isInvoiceStatus(requestedStatus) ? requestedStatus : 'draft');
      const table = recordType === 'estimate' ? estimate : invoice;
      if (clientRequestId) {
        const existing = (await db.select({ id: table.id }).from(table).where(and(eq(table.businessProfileId, tenant.id), eq(table.clientRequestId, clientRequestId))).limit(1))[0];
        if (existing) return void res.status(200).json({ id: existing.id, duplicate: true });
      }
      const id = randomUUID();
      await db.transaction(async (tx) => {
        if (recordType === 'estimate') {
          let finalJobId = jobId;
          if (status === 'accepted' && !finalJobId) {
            const service = parsedItems.items.map((item) => item.description).join(', ').slice(0, 255);
            const createdJobId = randomUUID();
            const notes = isFoodBusiness(tenant.businessType) ? JSON.stringify({ items: parsedItems.items.map((item) => ({ name: item.description, quantity: Number(item.quantity) })), fulfillment: 'pickup', total: parsedItems.total, notes: 'Created from accepted quote.' }) : `Created from accepted quote. ${parsedItems.items.map((item) => `${item.quantity} × ${item.description}`).join('; ')}`;
            await tx.insert(job).values({ id: createdJobId, businessProfileId: tenant.id, customerId, service, status: 'booked', notes });
            finalJobId = createdJobId;
          }
          await tx.insert(estimate).values({ id, businessProfileId: tenant.id, customerId, jobId: finalJobId, status, subtotal: parsedItems.subtotal, taxTotal: parsedItems.taxTotal, total: parsedItems.total, clientRequestId, notes: textValue(req.body.notes, 5000) || null, expiresAt: dateValue(req.body.expiresAt) });
          await replaceLineItems(tx, { estimateId: id }, parsedItems.items);
          await logFinanceActivity(tx, customerId, finalJobId, 'Quote created', `$${parsedItems.total} · ${status}`);
        } else {
          await tx.insert(invoice).values({ id, businessProfileId: tenant.id, customerId, jobId, status, subtotal: parsedItems.subtotal, taxTotal: parsedItems.taxTotal, total: parsedItems.total, clientRequestId, notes: textValue(req.body.notes, 5000) || null, dueAt: dateValue(req.body.dueAt) });
          await replaceLineItems(tx, { invoiceId: id }, parsedItems.items);
          await logFinanceActivity(tx, customerId, jobId, 'Invoice created', `$${parsedItems.total} · ${status}`);
        }
      });
      return void res.status(201).json({ id });
    }

    const id = randomUUID();
    if (recordType === 'payment') {
      const invoiceId = textValue(req.body.invoiceId, 36) || null;
      const linkedInvoice = invoiceId ? (await db.select({ id: invoice.id, jobId: invoice.jobId }).from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.businessProfileId, tenant.id), eq(invoice.customerId, customerId))).limit(1))[0] : null;
      if (invoiceId && !linkedInvoice) return void res.status(400).json({ error: 'Choose an invoice for the selected customer.' });
      const amount = moneyValue(req.body.amount); if (!amount || Number(amount) === 0) return void res.status(400).json({ error: 'Enter a payment amount greater than zero.' });
      const statusValue = textValue(req.body.status, 30); const status = isPaymentStatus(statusValue) ? statusValue : 'completed';
      await db.transaction(async (tx) => { await tx.insert(payment).values({ id, businessProfileId: tenant.id, customerId, invoiceId, amount, method: textValue(req.body.method, 50) || null, notes: textValue(req.body.notes, 5000) || null, status, receivedAt: dateValue(req.body.receivedAt) || new Date() }); if (invoiceId) await syncInvoicePaymentStatus(tx, invoiceId, tenant.id); await logFinanceActivity(tx, customerId, linkedInvoice?.jobId || null, 'Payment recorded', `$${amount} · ${status}`); });
    } else if (recordType === 'jobFile') {
      if (!linkedJob) return void res.status(400).json({ error: 'Choose a job before adding an external attachment.' });
      const fileName = textValue(req.body.fileName, 255); const fileUrl = textValue(req.body.fileUrl, 2000);
      if (!fileName || !fileUrl) return void res.status(400).json({ error: 'Add an attachment name and secure URL.' });
      if (!fileUrl.startsWith('/airo-assets/uploads/') && !fileUrl.startsWith('https://')) return void res.status(400).json({ error: 'Use an asset link or secure HTTPS URL.' });
      await db.transaction(async (tx) => { await tx.insert(jobFile).values({ id, jobId: linkedJob.id, fileName, fileUrl, fileType: textValue(req.body.fileType, 120) || null }); await logFinanceActivity(tx, customerId, linkedJob.id, 'Job attachment added', fileName); });
    } else return void res.status(400).json({ error: 'Choose a valid finance record type.' });
    res.status(201).json({ id });
  } catch (error) { res.status(500).json({ error: 'Unable to create finance record.', message: String(error) }); }
}
