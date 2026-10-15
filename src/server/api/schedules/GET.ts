import type { Request, Response } from 'express';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { employee, employeeShift, scheduleEmailDelivery, weeklySchedule } from '@/server/db/schema.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { getCalendarSettings } from '../calendar/shared.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const week = new Date(textValue(req.query.weekStart));
    const weekStart = Number.isNaN(week.getTime()) ? new Date() : week;
    weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const schedule = await db.select().from(weeklySchedule).where(and(eq(weeklySchedule.businessProfileId, tenant.id), gte(weeklySchedule.weekStartsAt, weekStart), lt(weeklySchedule.weekStartsAt, weekEnd))).limit(1);
    const active = schedule[0] ?? null;
    const { timezone } = await getCalendarSettings(tenant.id);
    const shifts = active ? await db.select({ id: employeeShift.id, employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes, employeeName: employee.name }).from(employeeShift).innerJoin(employee, eq(employeeShift.employeeId, employee.id)).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, active.id))).orderBy(asc(employeeShift.startsAt)) : [];
    const deliveries = active ? await db.select({ id: scheduleEmailDelivery.id, recipientEmail: scheduleEmailDelivery.recipientEmail, sentAt: scheduleEmailDelivery.sentAt }).from(scheduleEmailDelivery).where(and(eq(scheduleEmailDelivery.businessProfileId, tenant.id), eq(scheduleEmailDelivery.weeklyScheduleId, active.id))).orderBy(asc(scheduleEmailDelivery.sentAt)) : [];
    res.json({ schedule: active, shifts, deliveries, weekStart: weekStart.toISOString(), timezone });
  } catch (error) { res.status(500).json({ error: 'Unable to load schedule.', message: String(error) }); }
}
