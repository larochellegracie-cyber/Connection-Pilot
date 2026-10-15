import type { Request, Response } from 'express';
import { and, eq, gte, lt, ne } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { employeeShift } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';
function toDate(value: unknown) { const result = new Date(textValue(value)); return Number.isNaN(result.getTime()) ? null : result; }
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = textValue(req.params.shiftId, 36); const found = await db.select().from(employeeShift).where(and(eq(employeeShift.id, id), eq(employeeShift.businessProfileId, tenant.id))).limit(1);
    const shift = found[0]; if (!shift) return void res.status(404).json({ error: 'Shift not found.' });
    const startsAt = req.body.startsAt ? toDate(req.body.startsAt) : shift.startsAt; const endsAt = req.body.endsAt ? toDate(req.body.endsAt) : shift.endsAt;
    if (!startsAt || !endsAt || endsAt <= startsAt) return void res.status(400).json({ error: 'Choose valid shift times.' });
    const clash = await db.select({ id: employeeShift.id }).from(employeeShift).where(and(eq(employeeShift.businessProfileId, tenant.id), eq(employeeShift.employeeId, shift.employeeId), ne(employeeShift.id, id), lt(employeeShift.startsAt, endsAt), gte(employeeShift.endsAt, startsAt))).limit(1);
    if (clash[0]) return void res.status(409).json({ error: 'This employee already has an overlapping shift.' });
    await db.update(employeeShift).set({ startsAt, endsAt, location: req.body.location === undefined ? shift.location : textValue(req.body.location) || null, notes: req.body.notes === undefined ? shift.notes : textValue(req.body.notes, 10000) || null }).where(and(eq(employeeShift.id, id), eq(employeeShift.businessProfileId, tenant.id)));
    res.json({ id });
  } catch (error) { res.status(500).json({ error: 'Unable to update shift.', message: String(error) }); }
}
