import type { Request, Response } from 'express';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { scheduleTemplate, scheduleTemplateShift } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const templates = await db.select().from(scheduleTemplate).where(eq(scheduleTemplate.businessProfileId, tenant.id)).orderBy(asc(scheduleTemplate.name));
    const shifts = templates.length ? await db.select().from(scheduleTemplateShift).where(inArray(scheduleTemplateShift.scheduleTemplateId, templates.map((template) => template.id))) : [];
    res.json({ templates: templates.map((template) => ({ ...template, shiftCount: shifts.filter((shift) => shift.scheduleTemplateId === template.id).length })) });
  } catch (error) { res.status(500).json({ error: 'Unable to load schedule templates.', message: String(error) }); }
}
