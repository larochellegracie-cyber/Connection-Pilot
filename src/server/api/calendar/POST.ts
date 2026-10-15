import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment } from '@/server/db/schema.js';
import { createAppointmentBookedNotification } from '@/server/appointment-notifications.js';
import { logCustomerActivity } from '../customers/activity.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { assertSchedulingAvailability, getCalendarSettings, tenantCustomer } from './shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    if (isFoodBusiness(tenant.businessType)) return void res.status(400).json({ error: 'Food businesses create customer orders instead of appointments.' });
    const customerId = textValue(req.body.customerId, 36);
    const title = textValue(req.body.title);
    const scheduledAt = new Date(textValue(req.body.scheduledAt, 64));
    const settings = await getCalendarSettings(tenant.id);
    const requestedDuration = Number(req.body.durationMinutes);
    const durationMinutes = Number.isInteger(requestedDuration) && requestedDuration >= 15 && requestedDuration <= 480 && requestedDuration % 15 === 0 ? requestedDuration : settings.defaultDurationMinutes;
    const notes = textValue(req.body.notes, 5000) || null;
    if (!customerId || !title || Number.isNaN(scheduledAt.getTime())) return void res.status(400).json({ error: 'Customer, service, date, and time are required.' });
    const customerRecord = await tenantCustomer(customerId, tenant.id);
    if (!customerRecord) return void res.status(404).json({ error: 'Customer not found.' });
    await assertSchedulingAvailability(tenant.id, scheduledAt, durationMinutes);
    const id = randomUUID();
    await db.insert(customerAppointment).values({ id, customerId, title, scheduledAt, durationMinutes, notes });
    await logCustomerActivity(customerId, 'appointment_booked', 'Appointment booked', title);
    const customerName = await db.select({ name: customer.name }).from(customer).where(eq(customer.id, customerId)).limit(1);
    await createAppointmentBookedNotification({ businessProfileId: tenant.id, customerId, customerName: customerName[0]?.name || 'Customer', appointmentId: id, appointment: { title, scheduledAt, durationMinutes, notes, status: 'scheduled' } });
    res.status(201).json({ appointment: { id, customerId, title, scheduledAt, durationMinutes, notes, status: 'scheduled' } });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Unable to create the appointment.' });
  }
}
