import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customerActivity, job } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = textValue(req.params.jobId, 36); const existing = (await db.select().from(job).where(and(eq(job.id, id), eq(job.businessProfileId, tenant.id))).limit(1))[0];
    if (!existing) return void res.status(404).json({ error: 'Record not found.' });
    await db.transaction(async (tx) => {
      await tx.delete(job).where(and(eq(job.id, id), eq(job.businessProfileId, tenant.id)));
      await tx.insert(customerActivity).values({ id: randomUUID(), customerId: existing.customerId, activityType: 'job', title: isFoodBusiness(tenant.businessType) ? 'Order deleted' : 'Job deleted', detail: existing.service, occurredAt: new Date() });
    });
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: 'Unable to delete the record.', message: String(error) }); }
}
