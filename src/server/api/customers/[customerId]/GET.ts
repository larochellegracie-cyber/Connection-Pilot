import type { Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerActivity, customerAppointment, customerConversation, customerInteraction, customerNote, customerTag, estimate, invoice, job, payment } from '@/server/db/schema.js';
import { getTenant, textValue } from '../tenant.js';
import { jobDetailsFromNotes, orderDetailsFromNotes } from '@/lib/order-record.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const customerId = textValue(req.params.customerId, 36);
    const found = await db.select().from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
    const profile = found[0];
    if (!profile) return void res.status(404).json({ error: 'Customer profile not found.' });
    const [conversations, interactions, appointments, notes, tags, activities, jobs, estimates, invoices, payments] = await Promise.all([
      db.select().from(customerConversation).where(eq(customerConversation.customerId, profile.id)).orderBy(desc(customerConversation.occurredAt)),
      db.select().from(customerInteraction).where(eq(customerInteraction.customerId, profile.id)).orderBy(desc(customerInteraction.occurredAt)),
      db.select().from(customerAppointment).where(eq(customerAppointment.customerId, profile.id)).orderBy(desc(customerAppointment.scheduledAt)),
      db.select().from(customerNote).where(eq(customerNote.customerId, profile.id)).orderBy(desc(customerNote.createdAt)),
      db.select().from(customerTag).where(eq(customerTag.customerId, profile.id)),
      db.select().from(customerActivity).where(eq(customerActivity.customerId, profile.id)).orderBy(desc(customerActivity.occurredAt)),
      db.select().from(job).where(and(eq(job.customerId, profile.id), eq(job.businessProfileId, tenant.id))).orderBy(desc(job.scheduledAt)),
      db.select().from(estimate).where(and(eq(estimate.customerId, profile.id), eq(estimate.businessProfileId, tenant.id))).orderBy(desc(estimate.createdAt)),
      db.select().from(invoice).where(and(eq(invoice.customerId, profile.id), eq(invoice.businessProfileId, tenant.id))).orderBy(desc(invoice.createdAt)),
      db.select().from(payment).where(and(eq(payment.customerId, profile.id), eq(payment.businessProfileId, tenant.id))).orderBy(desc(payment.receivedAt)),
    ]);
    const foodBusiness = isFoodBusiness(tenant.businessType);
    const customerJobs = jobs.map((record) => foodBusiness ? { ...record, ...orderDetailsFromNotes(record.notes) } : { ...record, ...jobDetailsFromNotes(record.notes) });
    res.json({ businessType: tenant.businessType, customer: profile, conversations, interactions, appointments, notes, activities, jobs: customerJobs, estimates, invoices, payments, tags: tags.map((tag) => tag.label) });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load the customer profile.', message: String(error) });
  }
}
