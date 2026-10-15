import type { Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessNotification, customer } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const notifications = await db.select({
      id: businessNotification.id, type: businessNotification.type, title: businessNotification.title, detail: businessNotification.detail,
      beforeDetails: businessNotification.beforeDetails, afterDetails: businessNotification.afterDetails, readAt: businessNotification.readAt,
      createdAt: businessNotification.createdAt, customerId: customer.id, customerName: customer.name,
    }).from(businessNotification).innerJoin(customer, eq(businessNotification.customerId, customer.id))
      .where(and(eq(businessNotification.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).orderBy(desc(businessNotification.createdAt)).limit(100);
    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load notifications.', message: String(error) });
  }
}
