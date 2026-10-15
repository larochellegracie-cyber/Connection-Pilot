import type { Request, Response } from 'express';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { lead } from '@/server/db/schema.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { isLeadStatus } from './shared.js';

const PAGE_SIZE = 25;

function pageNumber(value: unknown): number {
  const parsed = Number(textValue(value, 8));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const query = textValue(req.query.q, 80);
    const status = textValue(req.query.status, 30);
    const page = pageNumber(req.query.page);
    const filters = [eq(lead.businessProfileId, tenant.id)];
    if (isLeadStatus(status)) filters.push(eq(lead.status, status));
    if (query) filters.push(or(
      like(lead.name, `%${query}%`),
      like(lead.phoneNumber, `%${query}%`),
      like(lead.email, `%${query}%`),
      like(lead.serviceRequested, `%${query}%`),
      like(lead.source, `%${query}%`),
    )!);
    const where = and(...filters);
    const count = await db.select({ count: sql<number>`count(*)` }).from(lead).where(where);
    const total = Number(count[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const leads = await db.select().from(lead).where(where).orderBy(desc(lead.createdAt)).limit(PAGE_SIZE).offset((safePage - 1) * PAGE_SIZE);
    const [newCount, followUpCount, wonCount] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(lead).where(and(eq(lead.businessProfileId, tenant.id), eq(lead.status, 'new'))),
      db.select({ count: sql<number>`count(*)` }).from(lead).where(and(eq(lead.businessProfileId, tenant.id), eq(lead.status, 'follow_up'))),
      db.select({ count: sql<number>`count(*)` }).from(lead).where(and(eq(lead.businessProfileId, tenant.id), eq(lead.status, 'won'))),
    ]);
    res.json({
      leads,
      pagination: { page: safePage, pageSize: PAGE_SIZE, total, totalPages },
      summary: { total, new: Number(newCount[0]?.count || 0), followUp: Number(followUpCount[0]?.count || 0), won: Number(wonCount[0]?.count || 0) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load leads.', message: String(error) });
  }
}
