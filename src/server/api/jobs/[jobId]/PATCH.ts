import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { job } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { jobDetailsToNotes, orderDetailsToNotes, orderTitle, type OrderItem } from '@/lib/order-record.js';
import { isJobStatus, logJobActivity } from '../shared.js';

function orderItems(value: unknown): OrderItem[] { return Array.isArray(value) ? value.map((item) => ({ name: textValue(item?.name, 255), quantity: Number(item?.quantity) })).filter((item) => item.name && Number.isInteger(item.quantity) && item.quantity > 0) : []; }
function money(value: unknown) { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : ''; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = textValue(req.params.jobId, 36); const existing = (await db.select().from(job).where(and(eq(job.id, id), eq(job.businessProfileId, tenant.id))).limit(1))[0];
    if (!existing) return void res.status(404).json({ error: 'Record not found.' });
    const foodBusiness = isFoodBusiness(tenant.businessType); const values: Partial<typeof job.$inferInsert> = {};
    if (foodBusiness) {
      const items = orderItems(req.body.items); if (!items.length) return void res.status(400).json({ error: 'Add at least one order item.' });
      values.service = orderTitle(items); values.notes = orderDetailsToNotes({ items, fulfillment: textValue(req.body.fulfillment) === 'delivery' ? 'delivery' : 'pickup', total: money(req.body.total), notes: textValue(req.body.notes, 10000) }); values.address = null; values.assignedEmployee = null; values.durationMinutes = null;
    } else {
      if (typeof req.body.service === 'string' && textValue(req.body.service)) values.service = textValue(req.body.service);
      if (typeof req.body.address === 'string') values.address = textValue(req.body.address, 5000) || null;
      if (typeof req.body.assignedEmployee === 'string') values.assignedEmployee = textValue(req.body.assignedEmployee) || null;
      if (typeof req.body.notes === 'string' || typeof req.body.price === 'string' || typeof req.body.price === 'number') values.notes = jobDetailsToNotes(money(req.body.price), textValue(req.body.notes, 10000));
      const duration = Number(req.body.durationMinutes); if (Number.isInteger(duration) && duration > 0) values.durationMinutes = duration;
    }
    if (typeof req.body.scheduledAt === 'string') { const date = new Date(req.body.scheduledAt); if (!Number.isNaN(date.getTime())) values.scheduledAt = date; }
    const nextStatus = textValue(req.body.status, 30); if (nextStatus) { if (!isJobStatus(nextStatus)) return void res.status(400).json({ error: 'Choose a valid status.' }); values.status = nextStatus; }
    await db.update(job).set(values).where(and(eq(job.id, id), eq(job.businessProfileId, tenant.id)));
    const changedStatus = values.status && values.status !== existing.status;
    await logJobActivity(id, existing.customerId, changedStatus ? (foodBusiness ? 'Order status changed' : 'Job status changed') : (foodBusiness ? 'Order updated' : 'Job updated'), changedStatus ? `${existing.status} to ${values.status}` : values.service || existing.service);
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: 'Unable to update the record.', message: String(error) }); }
}
