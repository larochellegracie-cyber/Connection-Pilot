import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer } from '@/server/db/schema.js';
import { logCustomerActivity } from '../activity.js';
import { getTenant, textValue } from '../tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const customerId = textValue(req.params.customerId, 36);
    const found = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
    if (!found[0]) return void res.status(404).json({ error: 'Customer profile not found.' });
    await db.update(customer).set({ archivedAt: new Date(), status: 'inactive' }).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id)));
    await logCustomerActivity(customerId, 'customer_archived', 'Customer archived');
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: 'Unable to archive the customer.', message: String(error) });
  }
}
