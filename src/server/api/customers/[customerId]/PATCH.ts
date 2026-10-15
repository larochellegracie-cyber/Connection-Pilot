import type { Request, Response } from 'express';
import { and, eq, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, customerTag } from '@/server/db/schema.js';
import { logCustomerActivity } from '../activity.js';
import { getTenant, normalizePhone, textValue } from '../tenant.js';

function tagsFrom(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((item) => textValue(item, 80)).filter(Boolean))].slice(0, 20) : [];
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const customerId = textValue(req.params.customerId, 36);
    const found = await db.select().from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
    const existing = found[0];
    if (!existing) return void res.status(404).json({ error: 'Customer profile not found.' });
    const name = textValue(req.body.name);
    const phoneNumber = normalizePhone(textValue(req.body.phoneNumber, 40));
    const email = textValue(req.body.email);
    const address = textValue(req.body.address, 1000);
    const company = textValue(req.body.company, 255);
    const requestedStatus = textValue(req.body.status, 30);
    const status = ['new', 'active', 'inactive', 'returning'].includes(requestedStatus) ? requestedStatus : existing.status;
    const values: Partial<typeof customer.$inferInsert> = { status };
    if (name) values.name = name;
    if (phoneNumber) values.phoneNumber = phoneNumber;
    if (typeof req.body.email === 'string') values.email = email || null;
    if (typeof req.body.address === 'string') values.address = address || null;
    if (typeof req.body.company === 'string') values.company = company || null;
    const nextPhone = phoneNumber || existing.phoneNumber;
    const nextEmail = typeof req.body.email === 'string' ? email : existing.email;
    const duplicateMatch = nextEmail ? or(eq(customer.phoneNumber, nextPhone), eq(customer.email, nextEmail)) : eq(customer.phoneNumber, nextPhone);
    const duplicate = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.businessProfileId, tenant.id), sql`${customer.id} <> ${customerId}`, duplicateMatch)).limit(1);
    if (duplicate[0]) return void res.status(409).json({ error: 'Another customer in this business already uses that phone number or email.' });
    await db.update(customer).set(values).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id)));
    if (Array.isArray(req.body.tags)) {
      const tags = tagsFrom(req.body.tags);
      await db.delete(customerTag).where(eq(customerTag.customerId, customerId));
      if (tags.length) await db.insert(customerTag).values(tags.map((label) => ({ id: randomUUID(), customerId, label })));
    }
    await logCustomerActivity(customerId, 'customer_updated', 'Customer information updated');
    const updated = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
    const tags = await db.select().from(customerTag).where(eq(customerTag.customerId, customerId));
    res.json({ customer: { ...updated[0], tags: tags.map((tag) => tag.label) } });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update the customer profile.', message: String(error) });
  }
}
