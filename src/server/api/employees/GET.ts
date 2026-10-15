import type { Request, Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { employee, employeeAvailability } from '@/server/db/schema.js';
import { getTenant } from '../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const employees = await db.select().from(employee).where(eq(employee.businessProfileId, tenant.id)).orderBy(asc(employee.name));
    const availability = await db.select().from(employeeAvailability).where(eq(employeeAvailability.businessProfileId, tenant.id)).orderBy(asc(employeeAvailability.dayOfWeek), asc(employeeAvailability.startTime));
    res.json({ employees: employees.map((item) => ({ ...item, availability: availability.filter((slot) => slot.employeeId === item.id) })) });
  } catch (error) { res.status(500).json({ error: 'Unable to load employees.', message: String(error) }); }
}
