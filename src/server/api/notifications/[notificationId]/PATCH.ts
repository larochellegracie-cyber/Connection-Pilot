import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessNotification } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const notificationId = textValue(req.params.notificationId, 36);
    const found = await db.select({ id: businessNotification.id }).from(businessNotification)
      .where(and(eq(businessNotification.id, notificationId), eq(businessNotification.businessProfileId, tenant.id))).limit(1);
    if (!found[0]) return void res.status(404).json({ error: 'Notification not found.' });
    await db.update(businessNotification).set({ readAt: new Date() }).where(and(eq(businessNotification.id, notificationId), eq(businessNotification.businessProfileId, tenant.id)));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update notification.', message: String(error) });
  }
}
