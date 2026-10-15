import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { lead } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../../customers/tenant.js';
import { logLeadActivity } from '../../shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const leadId = textValue(req.params.leadId, 36);
    const note = textValue(req.body.note, 10000);
    if (!note) return void res.status(400).json({ error: 'Add a note before saving.' });
    const found = await db.select({ id: lead.id }).from(lead).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id))).limit(1);
    if (!found[0]) return void res.status(404).json({ error: 'Lead not found.' });
    await logLeadActivity(leadId, 'note_added', 'Note added', note);
    await db.update(lead).set({ lastContactedAt: new Date() }).where(and(eq(lead.id, leadId), eq(lead.businessProfileId, tenant.id)));
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to add the lead note.', message: String(error) });
  }
}
