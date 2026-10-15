import type { Request, Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment, customerConversation, customerNote } from '@/server/db/schema.js';
import { logCustomerActivity } from '../../activity.js';
import { getTenant, textValue } from '../../tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const customerId = typeof req.params.customerId === 'string' ? req.params.customerId : '';
    const found = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
    if (!found[0]) {
      res.status(404).json({ error: 'Customer profile not found.' });
      return;
    }

    const type = textValue(req.body.type, 30);
    if (type === 'note') {
      const body = textValue(req.body.body, 5000);
      if (!body) return void res.status(400).json({ error: 'A note is required.' });
      await db.insert(customerNote).values({ id: randomUUID(), customerId, body });
      await logCustomerActivity(customerId, 'note_added', 'Private note added', body);
    } else if (type === 'conversation') {
      const content = textValue(req.body.content, 10000);
      const channel = textValue(req.body.channel, 30) || 'manual';
      const direction = textValue(req.body.direction, 20) || 'outbound';
      if (!content) return void res.status(400).json({ error: 'Conversation content is required.' });
      await db.insert(customerConversation).values({ id: randomUUID(), customerId, content, channel, direction });
      await db.update(customer).set({ messageCount: sql`${customer.messageCount} + 1`, lastContactedAt: new Date(), status: 'active' }).where(eq(customer.id, customerId));
      await logCustomerActivity(customerId, 'message_sent', 'Customer message recorded', content);
    } else if (type === 'appointment') {
      const title = textValue(req.body.title);
      const scheduledAt = new Date(textValue(req.body.scheduledAt, 64));
      if (!title || Number.isNaN(scheduledAt.getTime())) return void res.status(400).json({ error: 'An appointment title and valid time are required.' });
      await db.insert(customerAppointment).values({ id: randomUUID(), customerId, title, scheduledAt, notes: textValue(req.body.notes, 5000) || null });
      await db.update(customer).set({ status: 'returning', lastContactedAt: new Date() }).where(eq(customer.id, customerId));
      await logCustomerActivity(customerId, 'appointment_booked', 'Appointment booked', title);
    } else {
      return void res.status(400).json({ error: 'Unsupported activity type.' });
    }
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Unable to save customer activity.', message: String(error) });
  }
}
