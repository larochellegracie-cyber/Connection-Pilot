import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { employeeShift } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';
export default async function handler(req: Request, res: Response) {
  try { const tenant = await getTenant(req, res); if (!tenant) return; const id = textValue(req.params.shiftId, 36); const result = await db.delete(employeeShift).where(and(eq(employeeShift.id, id), eq(employeeShift.businessProfileId, tenant.id))); if (!result[0].affectedRows) return void res.status(404).json({ error: 'Shift not found.' }); res.status(204).end(); } catch (error) { res.status(500).json({ error: 'Unable to delete shift.', message: String(error) }); }
}
