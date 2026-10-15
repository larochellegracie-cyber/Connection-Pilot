import type { Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { lead, leadActivity } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const leadId = textValue(req.params.leadId, 36);
    const records = await db.select().from(lead).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id))).limit(1);
    const profile = records[0];
    if (!profile) return void res.status(404).json({ error: 'Lead not found.' });
    const activities = await db.select().from(leadActivity).where(eq(leadActivity.leadId, leadId)).orderBy(desc(leadActivity.occurredAt));
    res.json({ lead: profile, activities });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load the lead.', message: String(error) });
  }
}
