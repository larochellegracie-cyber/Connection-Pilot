import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { lead } from '@/server/db/schema.js';
import { getTenant, normalizePhone, textValue } from '../customers/tenant.js';
import { isLeadStatus, logLeadActivity } from './shared.js';

function optionalMoney(value: unknown): string | null {
  const amount = Number(textValue(value, 40));
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const name = textValue(req.body.name);
    const phoneNumber = normalizePhone(textValue(req.body.phoneNumber, 40));
    const email = textValue(req.body.email);
    const serviceRequested = textValue(req.body.serviceRequested);
    const requestedStatus = textValue(req.body.status, 30);
    const status = isLeadStatus(requestedStatus) ? requestedStatus : 'new';
    if (!name || !serviceRequested || (!phoneNumber && !email)) {
      return void res.status(400).json({ error: 'Name, service requested, and a phone number or email are required.' });
    }
    const id = randomUUID();
    await db.insert(lead).values({
      id,
      businessProfileId: tenant.id,
      name,
      phoneNumber: phoneNumber || null,
      email: email || null,
      address: textValue(req.body.address, 5000) || null,
      serviceRequested,
      source: textValue(req.body.source, 120) || null,
      estimatedValue: optionalMoney(req.body.estimatedValue),
      status,
      assignedEmployee: textValue(req.body.assignedEmployee) || null,
      notes: textValue(req.body.notes, 10000) || null,
      lastContactedAt: status === 'new' ? null : new Date(),
      wonAt: status === 'won' ? new Date() : null,
      lostAt: status === 'lost' ? new Date() : null,
    });
    await logLeadActivity(id, 'lead_created', 'Lead created', serviceRequested);
    const created = await db.select().from(lead).where(eq(lead.id, id)).limit(1);
    res.status(201).json({ lead: created[0] });
  } catch (error) {
    res.status(500).json({ error: 'Unable to create the lead.', message: String(error) });
  }
}
