import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { scheduleTemplate, scheduleTemplateShift } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../../customers/tenant.js';
import { createDraftFromSeeds, parseWeekStart, shiftWeek } from '../../../schedules/drafts.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const templateId = textValue(req.params.templateId, 36); const targetWeek = parseWeekStart(req.body.weekStart);
    if (!targetWeek) return void res.status(400).json({ error: 'Choose a future week for this template.' });
    const templates = await db.select().from(scheduleTemplate).where(and(eq(scheduleTemplate.id, templateId), eq(scheduleTemplate.businessProfileId, tenant.id))).limit(1);
    const template = templates[0]; if (!template) return void res.status(404).json({ error: 'Schedule template not found.' });
    const shifts = await db.select().from(scheduleTemplateShift).where(eq(scheduleTemplateShift.scheduleTemplateId, template.id));
    const difference = Math.round((targetWeek.getTime() - template.sourceWeekStartsAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const scheduleId = await createDraftFromSeeds(tenant.id, targetWeek, shifts.map((shift) => shiftWeek({ employeeId: shift.employeeId, startsAt: shift.startsAt, endsAt: shift.endsAt, location: shift.location, notes: shift.notes }, difference)));
    res.status(201).json({ scheduleId, applied: shifts.length, status: 'draft' });
  } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : 'Unable to apply this schedule template.' }); }
}
