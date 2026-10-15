import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/auth.js';
import { db } from '@/server/db/client.js';
import { weeklySchedule } from '@/server/db/schema.js';
import { getTenant, textValue } from '../../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const id = textValue(req.params.scheduleId, 36); const status = textValue(req.body.status, 30);
    if (status !== 'published' && status !== 'draft') return void res.status(400).json({ error: 'Choose Draft or Published.' });
    const session = await getAuth().api.getSession({ headers: new Headers(req.headers as Record<string, string>) });
    const update = status === 'published' ? { status, publishedAt: new Date(), publishedByUserId: session?.user?.id ?? null } : { status, publishedAt: null, publishedByUserId: null };
    await db.update(weeklySchedule).set(update).where(and(eq(weeklySchedule.id, id), eq(weeklySchedule.businessProfileId, tenant.id)));
    res.json({ id, status });
  } catch (error) { res.status(500).json({ error: 'Unable to update schedule.', message: String(error) }); }
}
