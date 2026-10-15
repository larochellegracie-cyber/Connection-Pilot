import type { Request, Response } from 'express';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, job } from '@/server/db/schema.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { isJobStatus } from './shared.js';
import { jobDetailsFromNotes, orderDetailsFromNotes } from '@/lib/order-record.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const query = textValue(req.query.q, 80); const status = textValue(req.query.status, 30);
    const filters = [eq(job.businessProfileId, tenant.id)];
    if (isJobStatus(status)) filters.push(eq(job.status, status));
    if (query) filters.push(or(like(job.service, `%${query}%`), like(customer.name, `%${query}%`), like(job.assignedEmployee, `%${query}%`))!);
    const where = and(...filters);
    const [records, total, booked, inProgress, complete] = await Promise.all([
      db.select({ id: job.id, customerId: job.customerId, service: job.service, address: job.address, assignedEmployee: job.assignedEmployee, scheduledAt: job.scheduledAt, durationMinutes: job.durationMinutes, status: job.status, notes: job.notes, createdAt: job.createdAt, customerName: customer.name }).from(job).innerJoin(customer, eq(job.customerId, customer.id)).where(where).orderBy(desc(job.scheduledAt), desc(job.createdAt)),
      db.select({ count: sql<number>`count(*)` }).from(job).where(eq(job.businessProfileId, tenant.id)),
      db.select({ count: sql<number>`count(*)` }).from(job).where(and(eq(job.businessProfileId, tenant.id), eq(job.status, 'booked'))),
      db.select({ count: sql<number>`count(*)` }).from(job).where(and(eq(job.businessProfileId, tenant.id), eq(job.status, 'in_progress'))),
      db.select({ count: sql<number>`count(*)` }).from(job).where(and(eq(job.businessProfileId, tenant.id), eq(job.status, 'completed'))),
    ]);
    const foodBusiness = isFoodBusiness(tenant.businessType);
    const mappedRecords = records.map((record) => foodBusiness ? { ...record, ...orderDetailsFromNotes(record.notes) } : { ...record, ...jobDetailsFromNotes(record.notes) });
    res.json({ businessType: tenant.businessType, jobs: mappedRecords, summary: { total: Number(total[0]?.count || 0), booked: Number(booked[0]?.count || 0), inProgress: Number(inProgress[0]?.count || 0), complete: Number(complete[0]?.count || 0) } });
  } catch (error) { res.status(500).json({ error: 'Unable to load jobs.', message: String(error) }); }
}
