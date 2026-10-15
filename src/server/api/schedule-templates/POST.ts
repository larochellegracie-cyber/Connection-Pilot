import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { employeeShift, scheduleTemplate, scheduleTemplateShift } from '@/server/db/schema.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { findSchedule, parseWeekStart } from '../schedules/drafts.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const name = textValue(req.body.name, 120); const sourceWeek = parseWeekStart(req.body.weekStart);
    if (!name || !sourceWeek) return void res.status(400).json({ error: 'Add a template name and choose a schedule week.' });
    const source = await findSchedule(tenant.id, sourceWeek);
    if (!source) return void res.status(404).json({ error: 'Create at least one shift before saving a template.' });
    const shifts = await db.select({ employeeId: employeeShift.employeeId, startsAt: employeeShift.startsAt, endsAt: employeeShift.endsAt, location: employeeShift.location, notes: employeeShift.notes }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.weeklyScheduleId, source.id)));
    if (!shifts.length) return void res.status(400).json({ error: 'Create at least one shift before saving a template.' });
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(scheduleTemplate).values({ id, businessProfileId: tenant.id, name, sourceWeekStartsAt: sourceWeek });
      await tx.insert(scheduleTemplateShift).values(shifts.map((shift) => ({ id: randomUUID(), scheduleTemplateId: id, ...shift })));
    });
    res.status(201).json({ id, name, shiftCount: shifts.length });
  } catch (error) { res.status(409).json({ error: 'A template with that name already exists, or it could not be saved.' }); }
}
