import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { employeeShift } from '@/server/db/schema.js';
import { getTenant } from '../../customers/tenant.js';
import { createDraftFromSeeds, findSchedule, parseWeekStart, shiftWeek } from '../drafts.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const targetWeek = parseWeekStart(req.body.weekStart);
    if (!targetWeek) return void res.status(400).json({ error: 'Choose a valid week to copy into.' });
    const previousWeek = new Date(targetWeek); previousWeek.setDate(previousWeek.getDate() - 7);
    const source = await findSchedule(tenant.id, previousWeek);
    if (!source) return void res.status(404).json({ error: 'No schedule was found for the previous week.' });
    const rows = await db.select({ employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, source.id)));
    if (!rows.length) return void res.status(400).json({ error: 'The previous week has no shifts to copy.' });
    const scheduleId = await createDraftFromSeeds(tenant.id, targetWeek, rows.map((row) => shiftWeek(row, 1)));
    res.status(201).json({ scheduleId, copied: rows.length, status: 'draft' });
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Unable to copy the previous week.' }); }
}
