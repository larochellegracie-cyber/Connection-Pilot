import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { employee, employeeAvailability } from '@/server/db/schema.js';
import { getTenant, normalizePhone, textValue } from '../../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = textValue(req.params.employeeId, 36);
    const existing = await db.select({ id: employee.id }).from(employee).where(and(eq(employee.id, id), eq(employee.businessProfileId, tenant.id))).limit(1);
    if (!existing[0]) return void res.status(404).json({ error: 'Employee not found.' });
    const status = textValue(req.body.status, 30);
    await db.update(employee).set({ name: textValue(req.body.name) || undefined, email: textValue(req.body.email) || null, phoneNumber: normalizePhone(textValue(req.body.phoneNumber, 40)) || null, role: textValue(req.body.role, 120) || null, status: status === 'inactive' ? 'inactive' : 'active' }).where(and(eq(employee.id, id), eq(employee.businessProfileId, tenant.id)));
    if (Array.isArray(req.body.availability)) {
      await db.delete(employeeAvailability).where(and(eq(employeeAvailability.employeeId, id), eq(employeeAvailability.businessProfileId, tenant.id)));
      const slots = req.body.availability.map((slot: { dayOfWeek?: unknown; startTime?: unknown; endTime?: unknown; isAvailable?: unknown }) => ({ id: crypto.randomUUID(), businessProfileId: tenant.id, employeeId: id, dayOfWeek: Number(slot.dayOfWeek), startTime: textValue(slot.startTime, 5), endTime: textValue(slot.endTime, 5), isAvailable: slot.isAvailable !== false })).filter((slot: { dayOfWeek: number; startTime: string; endTime: string }) => Number.isInteger(slot.dayOfWeek) && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6 && /^\d{2}:\d{2}$/.test(slot.startTime) && /^\d{2}:\d{2}$/.test(slot.endTime) && slot.endTime > slot.startTime);
      if (slots.length) await db.insert(employeeAvailability).values(slots);
    }
    res.json({ id });
  } catch (error) { res.status(500).json({ error: 'Unable to update employee.', message: String(error) }); }
}
