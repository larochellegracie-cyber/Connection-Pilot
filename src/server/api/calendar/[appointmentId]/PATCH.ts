import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment } from '@/server/db/schema.js';
import { createAppointmentChangeNotification } from '@/server/appointment-notifications.js';
import { logCustomerActivity } from '../../customers/activity.js';
import { getTenant, textValue } from '../../customers/tenant.js';
import { assertSchedulingAvailability } from '../shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    const appointmentId = textValue(req.params.appointmentId, 36);
    const records = await db.select({ appointment: customerAppointment, customerName: customer.name }).from(customerAppointment)
      .innerJoin(customer, eq(customerAppointment.customerId, customer.id))
      .where(and(eq(customerAppointment.id, appointmentId), eq(customer.businessProfileId, tenant.id))).limit(1);
    const record = records[0];
    if (!record) return void res.status(404).json({ error: 'Appointment not found.' });
    const before = record.appointment;
    const title = textValue(req.body.title) || before.title;
    const notes = req.body.notes === undefined ? before.notes : textValue(req.body.notes, 5000) || null;
    const requestedStatus = textValue(req.body.status, 40);
    const status = requestedStatus === 'scheduled' || requestedStatus === 'cancelled' || requestedStatus === 'completed' ? requestedStatus : before.status;
    const scheduledAt = req.body.scheduledAt ? new Date(textValue(req.body.scheduledAt, 64)) : before.scheduledAt;
    const requestedDuration = Number(req.body.durationMinutes);
    const durationMinutes = req.body.durationMinutes === undefined ? before.durationMinutes : requestedDuration;
    if (Number.isNaN(scheduledAt.getTime())) return void res.status(400).json({ error: 'Choose a valid date and time.' });
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480 || durationMinutes % 15 !== 0) return void res.status(400).json({ error: 'Appointment duration must be between 15 and 480 minutes in 15-minute increments.' });
    const requiresAvailabilityValidation = status === 'scheduled' && (before.status !== 'scheduled' || before.scheduledAt.getTime() !== scheduledAt.getTime() || before.durationMinutes !== durationMinutes);
    if (requiresAvailabilityValidation) await assertSchedulingAvailability(tenant.id, scheduledAt, durationMinutes, appointmentId);
    await db.update(customerAppointment).set({ title, notes, status, scheduledAt, durationMinutes }).where(eq(customerAppointment.id, appointmentId));
    const after = { ...before, title, notes, status, scheduledAt, durationMinutes };
    const changeDetail = status === 'cancelled' ? `Cancelled: ${title}` : before.scheduledAt.getTime() !== scheduledAt.getTime() ? `Rescheduled from ${before.scheduledAt.toLocaleString('en-US')} to ${scheduledAt.toLocaleString('en-US')}: ${title}` : `Updated: ${title}`;
    const activityTitle = status === 'cancelled' ? 'Appointment cancelled' : status === 'completed' ? 'Appointment completed' : before.scheduledAt.getTime() !== scheduledAt.getTime() ? 'Appointment rescheduled' : 'Appointment updated';
    await logCustomerActivity(before.customerId, status === 'cancelled' ? 'appointment_cancelled' : status === 'completed' ? 'appointment_completed' : before.scheduledAt.getTime() !== scheduledAt.getTime() ? 'appointment_rescheduled' : 'appointment_updated', activityTitle, changeDetail);
    await createAppointmentChangeNotification({ businessProfileId: tenant.id, customerId: before.customerId, customerName: record.customerName, appointmentId, before, after });
    res.json({ appointment: after });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'Unable to update the appointment.' });
  }
}
