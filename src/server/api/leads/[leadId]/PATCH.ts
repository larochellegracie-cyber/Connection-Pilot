import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { lead } from '@/server/db/schema.js';
import { getTenant, normalizePhone, textValue } from '../../customers/tenant.js';
import { isLeadStatus, logLeadActivity } from '../shared.js';

function optionalMoney(value: unknown): string | null {
  const amount = Number(textValue(value, 40));
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const leadId = textValue(req.params.leadId, 36);
    const records = await db.select().from(lead).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id))).limit(1);
    const existing = records[0];
    if (!existing) return void res.status(404).json({ error: 'Lead not found.' });

    const values: Partial<typeof lead.$inferInsert> = {};
    if (typeof req.body.name === 'string' && textValue(req.body.name)) values.name = textValue(req.body.name);
    if (typeof req.body.phoneNumber === 'string') values.phoneNumber = normalizePhone(textValue(req.body.phoneNumber, 40)) || null;
    if (typeof req.body.email === 'string') values.email = textValue(req.body.email) || null;
    if (typeof req.body.address === 'string') values.address = textValue(req.body.address, 5000) || null;
    if (typeof req.body.serviceRequested === 'string' && textValue(req.body.serviceRequested)) values.serviceRequested = textValue(req.body.serviceRequested);
    if (typeof req.body.source === 'string') values.source = textValue(req.body.source, 120) || null;
    if (typeof req.body.estimatedValue === 'string' || typeof req.body.estimatedValue === 'number') values.estimatedValue = optionalMoney(req.body.estimatedValue);
    if (typeof req.body.assignedEmployee === 'string') values.assignedEmployee = textValue(req.body.assignedEmployee) || null;
    if (typeof req.body.notes === 'string') values.notes = textValue(req.body.notes, 10000) || null;

    const requestedStatus = textValue(req.body.status, 30);
    if (requestedStatus) {
      if (!isLeadStatus(requestedStatus)) return void res.status(400).json({ error: 'Choose a valid lead status.' });
      values.status = requestedStatus;
      if (requestedStatus !== existing.status) {
        values.lastContactedAt = requestedStatus === 'new' ? existing.lastContactedAt : new Date();
        values.wonAt = requestedStatus === 'won' ? new Date() : null;
        values.lostAt = requestedStatus === 'lost' ? new Date() : null;
      }
    }
    if (!Object.keys(values).length) return void res.status(400).json({ error: 'No lead changes were provided.' });
    await db.update(lead).set(values).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id)));
    if (values.status && values.status !== existing.status) await logLeadActivity(leadId, 'status_changed', 'Lead status changed', `${existing.status} to ${values.status}`);
    else await logLeadActivity(leadId, 'lead_updated', 'Lead details updated');
    const updated = await db.select().from(lead).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id))).limit(1);
    res.json({ lead: updated[0] });
  } catch (error) {
    res.status(500).json({ error: 'Unable to update the lead.', message: String(error) });
  }
}
