import type { Request, Response } from 'express';
import { and, eq, gte, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { employee, employeeAvailability, employeeShift, weeklySchedule } from '@/server/db/schema.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { getTenant, textValue } from '../customers/tenant.js';

function date(value: unknown) { const output = new Date(textValue(value)); return Number.isNaN(output.getTime()) ? null : output; }
function monday(value: Date) { const result = new Date(value); result.setHours(0, 0, 0, 0); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result; }
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'scheduling');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const employeeId = textValue(req.body.employeeId, 36); const startsAt = date(req.body.startsAt); const endsAt = date(req.body.endsAt);
    if (!employeeId || !startsAt || !endsAt || endsAt <= startsAt) return void res.status(400).json({ error: 'Choose an employee and valid shift start and end times.' });
    const member = await db.select({ id: employee.id, status: employee.status }).from(employee).where(and(eq(employee.id, employeeId), eq(employee.businessProfileId, tenant.id))).limit(1);
    if (!member[0] || member[0].status !== 'active') return void res.status(400).json({ error: 'Choose an active employee in this business.' });
    const clashes = await db.select({ id: employeeShift.id }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.employeeId, employeeId), lt(employeeShift.startsAt, endsAt), gte(employeeShift.endsAt, startsAt))).limit(1);
    if (clashes[0]) return void res.status(409).json({ error: 'This employee already has an overlapping shift.' });
    const day = startsAt.getDay(); const startTime = startsAt.toTimeString().slice(0, 5); const endTime = endsAt.toTimeString().slice(0, 5);
    const availability = await db.select().from(employeeAvailability).where(and(eq(employeeAvailability.employeeId, employeeId), eq(employeeAvailability.businessProfileId, tenant.id), eq(employeeAvailability.dayOfWeek, day)));
    const outsideAvailability = availability.length > 0 && !availability.some((slot) => slot.isAvailable && slot.startTime <= startTime && slot.endTime >= endTime);
    const weekStartsAt = monday(startsAt); const weekEndsAt = new Date(weekStartsAt); weekEndsAt.setDate(weekEndsAt.getDate() + 7);
    let schedule = await db.select().from(weeklySchedule).where(and(eq(weeklySchedule.businessProfileId, tenant.id), gte(weeklySchedule.weekStartsAt, weekStartsAt), lt(weeklySchedule.weekStartsAt, weekEndsAt))).limit(1);
    if (!schedule[0]) { const scheduleId = randomUUID(); await db.insert(weeklySchedule).values({ id: scheduleId, businessProfileId: tenant.id, weekStartsAt, status: 'draft' }); schedule = [{ id: scheduleId, businessProfileId: tenant.id, weekStartsAt, status: 'draft', publishedAt: null, publishedByUserId: null, createdAt: new Date(), updatedAt: new Date() }]; }
    const id = randomUUID(); await db.insert(employeeShift).values({ id, businessProfileId: tenant.id, weeklyScheduleId: schedule[0].id, employeeId, startsAt, endsAt, location: textValue(req.body.location) || null, notes: textValue(req.body.notes, 10000) || null });
    res.status(201).json({ id, scheduleId: schedule[0].id, outsideAvailability });
  } catch (error) { res.status(500).json({ error: 'Unable to create shift.', message: String(error) }); }
}
