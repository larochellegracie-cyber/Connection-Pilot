import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { employee, employeeAvailability } from '@/server/db/schema.js';
import { requirePlanFeature } from '@/server/plan-access.js';
import { getTenant, normalizePhone, textValue } from '../customers/tenant.js';

type AvailabilityInput = { dayOfWeek?: unknown; startTime?: unknown; endTime?: unknown; isAvailable?: unknown };
function availabilityRows(value: unknown, employeeId: string, businessProfileId: string) {
  if (!Array.isArray(value)) return [];
  return value.map((slot: AvailabilityInput) => ({ id: randomUUID(), businessProfileId, employeeId, dayOfWeek: Number(slot.dayOfWeek), startTime: textValue(slot.startTime, 5), endTime: textValue(slot.endTime, 5), isAvailable: slot.isAvailable !== false })).filter((slot) => Number.isInteger(slot.dayOfWeek) && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6 && /^\d{2}:\d{2}$/.test(slot.startTime) && /^\d{2}:\d{2}$/.test(slot.endTime) && slot.endTime > slot.startTime);
}
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const access = await requirePlanFeature(tenant.id, 'scheduling');
    if (!access.allowed) return void res.status(403).json({ error: access.error, upgradeRequired: true });
    const name = textValue(req.body.name); const email = textValue(req.body.email); const phoneNumber = normalizePhone(textValue(req.body.phoneNumber, 40)); const role = textValue(req.body.role, 120);
    if (!name) return void res.status(400).json({ error: 'Employee name is required.' });
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(employee).values({ id, businessProfileId: tenant.id, name, email: email || null, phoneNumber: phoneNumber || null, role: role || null, status: 'active' });
      const slots = availabilityRows(req.body.availability, id, tenant.id); if (slots.length) await tx.insert(employeeAvailability).values(slots);
    });
    res.status(201).json({ id });
  } catch (error) { res.status(500).json({ error: 'Unable to create employee.', message: String(error) }); }
}
