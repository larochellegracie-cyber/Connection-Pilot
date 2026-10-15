import type { Request, Response } from 'express';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, job, lead } from '@/server/db/schema.js';
import { logCustomerActivity } from '../../../customers/activity.js';
import { getTenant, textValue } from '../../../customers/tenant.js';
import { logLeadActivity } from '../../shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const leadId = textValue(req.params.leadId, 36);
    const leadRows = await db.select().from(lead).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id))).limit(1);
    const record = leadRows[0];
    if (!record) return void res.status(404).json({ error: 'Lead not found.' });

    const requestedCustomerId = textValue(req.body.customerId, 36);
    let customerRecord: typeof customer.$inferSelect | undefined;
    if (requestedCustomerId) {
      const matches = await db.select().from(customer).where(and(eq(customer.id, requestedCustomerId), eq(customer.businessProfileId, tenant.id))).limit(1);
      customerRecord = matches[0];
      if (!customerRecord) return void res.status(404).json({ error: 'Selected customer was not found in this workspace.' });
    } else if (record.customerId) {
      const matches = await db.select().from(customer).where(and(eq(customer.id, record.customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
      customerRecord = matches[0];
    } else {
      const contacts = [];
      if (record.phoneNumber) contacts.push(eq(customer.phoneNumber, record.phoneNumber));
      if (record.email) contacts.push(eq(customer.email, record.email));
      if (contacts.length) {
        const matches = await db.select().from(customer).where(and(eq(customer.businessProfileId, tenant.id), or(...contacts)!)).limit(1);
        customerRecord = matches[0];
      }
    }

    if (!customerRecord) {
      if (!record.phoneNumber) return void res.status(400).json({ error: 'Add a phone number to this lead or choose an existing customer before converting.' });
      const customerId = randomUUID();
      await db.insert(customer).values({
        id: customerId,
        businessProfileId: tenant.id,
        name: record.name,
        phoneNumber: record.phoneNumber,
        email: record.email,
        address: record.address,
        status: 'new',
      });
      await logCustomerActivity(customerId, 'customer_created', 'Customer profile created', 'Created from a converted lead.');
      const created = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
      customerRecord = created[0];
    }

    const createJob = req.body.createJob === true;
    let createdJobId: string | null = null;
    if (createJob) {
      createdJobId = randomUUID();
      await db.insert(job).values({
        id: createdJobId,
        businessProfileId: tenant.id,
        customerId: customerRecord.id,
        leadId: record.id,
        service: record.serviceRequested,
        address: record.address,
        assignedEmployee: record.assignedEmployee,
        status: 'booked',
        notes: record.notes,
      });
    }
    await db.update(lead).set({ customerId: customerRecord.id, status: 'won', wonAt: record.wonAt || new Date(), lostAt: null, lastContactedAt: new Date() }).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id)));
    await logLeadActivity(leadId, 'lead_converted', createdJobId ? 'Lead converted to customer and job' : 'Lead converted to customer', customerRecord.name);
    res.json({ customerId: customerRecord.id, jobId: createdJobId });
  } catch (error) {
    res.status(500).json({ error: 'Unable to convert the lead.', message: String(error) });
  }
}
