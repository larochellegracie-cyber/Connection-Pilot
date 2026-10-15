import type { Request, Response } from 'express';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment } from '@/server/db/schema.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { getCalendarSettings } from './shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const from = new Date(textValue(req.query.from, 64));
    const to = new Date(textValue(req.query.to, 64));
    const rangeStart = Number.isNaN(from.getTime()) ? new Date(Date.now() - 31 * 86400000) : from;
    const rangeEnd = Number.isNaN(to.getTime()) ? new Date(Date.now() + 62 * 86400000) : to;
    const [settings, appointments] = await Promise.all([
      getCalendarSettings(tenant.id),
      db.select({ id: customerAppointment.id, title: customerAppointment.title, status: customerAppointment.status, scheduledAt: customerAppointment.scheduledAt, durationMinutes: customerAppointment.durationMinutes, notes: customerAppointment.notes, sourceExternalId: customerAppointment.sourceExternalId, customerId: customer.id, customerName: customer.name, customerPhoneNumber: customer.phoneNumber, customerEmail: customer.email })
        .from(customerAppointment)
        .innerJoin(customer, eq(customerAppointment.customerId, customer.id))
        .where(and(eq(customer.businessProfileId, tenant.id), gte(customerAppointment.scheduledAt, rangeStart), lt(customerAppointment.scheduledAt, rangeEnd)))
        .orderBy(asc(customerAppointment.scheduledAt)),
    ]);
    res.json({ businessType: tenant.businessType, settings: { timezone: settings.timezone, weeklyHours: settings.weeklyHours, defaultDurationMinutes: settings.defaultDurationMinutes }, appointments });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load the calendar.', message: String(error) });
  }
}
