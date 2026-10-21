import type { Request, Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { businessProfile, employee, employeeShift, marketingProfile, scheduleEmailDelivery, weeklySchedule } from '@/server/db/schema.js';
import { emailFailure, sendEmailOrThrow } from '@/server/email';
import { scheduleEmailTemplate } from '@/server/email-templates';
import { getTenant, textValue } from '../../../customers/tenant.js';
import { getCalendarSettings } from '../../../calendar/shared.js';

type RecipientSchedule = { employeeId: string; employeeName: string; email: string; shifts: { startsAt: Date; endsAt: Date; location: string | null; notes: string | null }[] };

function safeText(value: string) { return value.replace(/[\r\n]+/g, ' ').trim(); }
function firstBrandColour(value: string | null) { return value?.match(/#[0-9a-f]{6}/i)?.[0] || null; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const scheduleId = textValue(req.params.scheduleId, 36);
    const schedules = await db.select().from(weeklySchedule).where(and(eq(weeklySchedule.id, scheduleId), eq(weeklySchedule.businessProfileId, tenant.id))).limit(1);
    const schedule = schedules[0];
    if (!schedule) return void res.status(404).json({ error: 'Schedule not found.' });
    if (schedule.status !== 'published') return void res.status(400).json({ error: 'Publish the schedule before emailing it to employees.' });
    const branding = (await db.select({ businessName: businessProfile.businessName, businessEmail: businessProfile.businessEmail, phoneNumber: businessProfile.phoneNumber, logoUrl: marketingProfile.logoUrl, brandColors: marketingProfile.brandColors }).from(businessProfile).leftJoin(marketingProfile, eq(marketingProfile.businessProfileId, businessProfile.id)).where(eq(businessProfile.id, tenant.id)).limit(1))[0];
    const { timezone } = await getCalendarSettings(tenant.id);
    const rows = await db.select({ employeeId: employee.id, employeeName: employee.name, email: employee.email, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes }).from(employeeShift).innerJoin(employee, eq(employeeShift.employeeId, employee.id)).where(and(eq(employeeShift.weeklyScheduleId, schedule.id), eq(employeeShift.businessProfileId, tenant.id))).orderBy(asc(employee.name), asc(employeeShift.startsAt));
    const recipients = new Map<string, RecipientSchedule>();
    for (const row of rows) {
      const email = safeText(row.email || '').toLowerCase();
      if (!email || !email.includes('@')) continue;
      const existing = recipients.get(row.employeeId) ?? { employeeId: row.employeeId, employeeName: safeText(row.employeeName), email, shifts: [] };
      existing.shifts.push({ startsAt: row.startsAt, endsAt: row.endsAt, location: row.location, notes: row.notes }); recipients.set(row.employeeId, existing);
    }
    if (recipients.size === 0) return void res.status(400).json({ error: 'Add an email address to at least one employee with a shift before sending this schedule.' });
    const delivered: string[] = []; const failed: string[] = []; let firstError: unknown = null;
    for (const recipient of recipients.values()) {
      const subject = `Your schedule for the week of ${new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'long', day: 'numeric' }).format(schedule.weekStartsAt)}`;
      const message = scheduleEmailTemplate({ brand: { businessName: branding?.businessName || tenant.businessName, businessEmail: branding?.businessEmail, phoneNumber: branding?.phoneNumber, logoUrl: branding?.logoUrl, brandColour: firstBrandColour(branding?.brandColors || null) }, employeeName: recipient.employeeName, weekStartsAt: schedule.weekStartsAt, shifts: recipient.shifts, timezone });
      try {
        const result = await sendEmailOrThrow({ fromName: branding?.businessName || tenant.businessName, to: recipient.email, subject, text: message.text, html: message.html });
        await db.insert(scheduleEmailDelivery).values({ id: randomUUID(), businessProfileId: tenant.id, weeklyScheduleId: schedule.id, employeeId: recipient.employeeId, recipientEmail: recipient.email, gatewayMessageId: result.messageId }); delivered.push(recipient.employeeName);
      } catch (error) { firstError ??= error; console.error('schedule_email.send_failed', { scheduleId: schedule.id, employeeId: recipient.employeeId, error: String(error) }); failed.push(recipient.employeeName); }
    }
    if (delivered.length === 0) { const failure = emailFailure(firstError); return void res.status(failure.status).json({ error: `${failure.error} No employee emails were delivered.`, setupRequired: failure.setupRequired, failed }); }
    res.json({ sent: delivered.length, delivered, failed, message: failed.length ? `Sent to ${delivered.length} employee(s). ${failed.length} delivery attempt(s) failed.` : `Sent schedules to ${delivered.length} employee(s).` });
  } catch (error) { console.error('schedule_email.unexpected_error', error); res.status(500).json({ error: 'Unable to send the schedule email.' }); }
}
