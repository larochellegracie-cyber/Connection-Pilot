import type { Request, Response } from 'express';
import { and, eq, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, customerTag } from '@/server/db/schema.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { logCustomerActivity } from './activity.js';
import { getTenant, normalizePhone, textValue } from './tenant.js';

function tagsFrom(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((item) => textValue(item, 80)).filter(Boolean))].slice(0, 20) : [];
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'customers');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const name = textValue(req.body.name);
    const phoneNumber = normalizePhone(textValue(req.body.phoneNumber, 40));
    const email = textValue(req.body.email);
    const address = textValue(req.body.address, 1000);
    const company = textValue(req.body.company, 255);
    const tags = tagsFrom(req.body.tags);
    if (!name || !phoneNumber) return void res.status(400).json({ error: 'Customer name and phone number are required.' });
    const matchCondition = email ? or(eq(customer.phoneNumber, phoneNumber), eq(customer.email, email)) : eq(customer.phoneNumber, phoneNumber);
    const matches = await db.select().from(customer).where(and(eq(customer.businessProfileId, tenant.id), matchCondition)).limit(1);
    const existing = matches[0];
    if (existing) return void res.status(409).json({ error: 'A customer profile with this phone number or email already exists. Open that record to update it instead.' });
    const customerId = randomUUID();
    await db.insert(customer).values({ id: customerId, businessProfileId: tenant.id, name, phoneNumber, email: email || null, address: address || null, company: company || null, status: 'new' });
    if (tags.length) await db.insert(customerTag).values(tags.map((label) => ({ id: randomUUID(), customerId, label })));
    await logCustomerActivity(customerId, 'customer_created', 'Customer profile created', 'Added manually from the Customer Hub.');
    const created = await db.select().from(customer).where(eq(customer.id, customerId)).limit(1);
    res.status(201).json({ customer: { ...created[0], tags }, matchedExisting: false });
  } catch (error) {
    res.status(500).json({ error: 'Unable to create the customer profile.', message: String(error) });
  }
}
