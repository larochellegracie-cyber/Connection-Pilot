import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, estimate, invoice, job, jobFile, payment } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../../customers/tenant.js';
import { logFinanceActivity, syncInvoicePaymentStatus } from '../../shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const recordType = textValue(req.params.recordType, 20);
    const recordId = textValue(req.params.recordId, 36);
    if (recordType === 'estimate') {
      const record = (await db.select().from(estimate).where(and(eq(estimate.id, recordId), eq(estimate.businessProfileId, tenant.id))).limit(1))[0];
      if (!record) return void res.status(404).json({ error: 'Estimate not found.' });
      await db.transaction(async (tx) => {
        await tx.delete(estimate).where(and(eq(estimate.id, recordId), eq(estimate.businessProfileId, tenant.id)));
        await logFinanceActivity(tx, record.customerId, record.jobId, 'Estimate deleted', `Estimate ${record.id} removed`);
      });
    } else if (recordType === 'invoice') {
      const record = (await db.select().from(invoice).where(and(eq(invoice.id, recordId), eq(invoice.businessProfileId, tenant.id))).limit(1))[0];
      if (!record) return void res.status(404).json({ error: 'Invoice not found.' });
      await db.transaction(async (tx) => {
        await tx.delete(invoice).where(and(eq(invoice.id, recordId), eq(invoice.businessProfileId, tenant.id)));
        await logFinanceActivity(tx, record.customerId, record.jobId, 'Invoice deleted', `Invoice ${record.id} removed`);
      });
    } else if (recordType === 'payment') {
      const record = (await db.select().from(payment).where(and(eq(payment.id, recordId), eq(payment.businessProfileId, tenant.id))).limit(1))[0];
      if (!record) return void res.status(404).json({ error: 'Payment not found.' });
      await db.transaction(async (tx) => {
        await tx.delete(payment).where(and(eq(payment.id, recordId), eq(payment.businessProfileId, tenant.id)));
        if (record.invoiceId) await syncInvoicePaymentStatus(tx, record.invoiceId, tenant.id);
        await logFinanceActivity(tx, record.customerId, null, 'Payment deleted', `Payment ${record.id} removed`);
      });
    } else if (recordType === 'jobFile') {
      const record = (await db.select({ id: jobFile.id, jobId: jobFile.jobId, customerId: customer.id, fileName: jobFile.fileName }).from(jobFile).innerJoin(job, eq(jobFile.jobId, job.id)).innerJoin(customer, eq(job.customerId, customer.id)).where(and(eq(jobFile.id, recordId), eq(job.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).limit(1))[0];
      if (!record) return void res.status(404).json({ error: 'Job attachment not found.' });
      await db.transaction(async (tx) => {
        await tx.delete(jobFile).where(and(eq(jobFile.id, recordId), eq(jobFile.jobId, record.jobId)));
        await logFinanceActivity(tx, record.customerId, record.jobId, 'Job attachment removed', record.fileName);
      });
    } else return void res.status(400).json({ error: 'Choose a valid finance record type.' });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to delete finance record.', message: String(error) });
  }
}
