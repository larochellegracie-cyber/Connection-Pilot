import type { Request, Response } from 'express';
import { and, asc, desc, eq, gte, like, or, sql } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { customer, customerAppointment, customerInteraction, customerTag, job } from '@/server/db/schema.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { getTenant, textValue } from './tenant.js';

const PAGE_SIZE = 25;
const sortableColumns = {
  name: customer.name,
  status: customer.status,
  lastActivity: customer.lastContactedAt,
} as const;

function pageNumber(value: unknown): number {
  const parsed = Number(textValue(value, 8));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;

    const foodBusiness = isFoodBusiness(tenant.businessType);
    const query = textValue(req.query.q, 80);
    const status = textValue(req.query.status, 30);
    const sort = textValue(req.query.sort, 30);
    const direction = textValue(req.query.direction, 4) === 'asc' ? 'asc' : 'desc';
    const page = pageNumber(req.query.page);
    const filters = [eq(customer.businessProfileId, tenant.id)];

    if (status === 'archived') filters.push(sql`${customer.archivedAt} IS NOT NULL`);
    else {
      filters.push(sql`${customer.archivedAt} IS NULL`);
      if (status && ['new', 'active', 'inactive', 'returning'].includes(status)) filters.push(eq(customer.status, status));
    }
    if (query) filters.push(or(like(customer.name, `%${query}%`), like(customer.phoneNumber, `%${query}%`), like(customer.email, `%${query}%`), like(customer.company, `%${query}%`))!);

    const where = and(...filters);
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(customer).where(where);
    const total = Number(countResult[0]?.count || 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const orderColumn = sortableColumns[sort as keyof typeof sortableColumns];
    const nextAppointmentOrder = sql`(SELECT MIN(${customerAppointment.scheduledAt}) FROM ${customerAppointment} WHERE ${customerAppointment.customerId} = ${customer.id} AND ${customerAppointment.scheduledAt} >= NOW() AND ${customerAppointment.status} NOT IN ('cancelled', 'completed'))`;
    const orderBy = sort === 'nextAppointment'
      ? (direction === 'asc' ? asc(nextAppointmentOrder) : desc(nextAppointmentOrder))
      : orderColumn
        ? (direction === 'asc' ? asc(orderColumn) : desc(orderColumn))
        : desc(customer.lastContactedAt);

    const customers = await db.select().from(customer).where(where).orderBy(orderBy, asc(customer.name)).limit(PAGE_SIZE).offset((safePage - 1) * PAGE_SIZE);
    const ids = customers.map((item) => item.id);
    const [tags, nextAppointments] = await Promise.all([
      ids.length ? db.select().from(customerTag).where(sql`${customerTag.customerId} IN ${ids}`) : Promise.resolve([]),
      ids.length
        ? foodBusiness
          ? db.select({ id: job.id, customerId: job.customerId, title: job.service, scheduledAt: job.scheduledAt, status: job.status })
            .from(job).where(and(eq(job.businessProfileId, tenant.id), sql`${job.customerId} IN ${ids}`, gte(job.scheduledAt, new Date()), sql`${job.status} NOT IN ('cancelled', 'completed')`)).orderBy(asc(job.scheduledAt))
          : db.select({ id: customerAppointment.id, customerId: customerAppointment.customerId, title: customerAppointment.title, scheduledAt: customerAppointment.scheduledAt, status: customerAppointment.status })
            .from(customerAppointment).where(and(sql`${customerAppointment.customerId} IN ${ids}`, gte(customerAppointment.scheduledAt, new Date()), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)).orderBy(asc(customerAppointment.scheduledAt))
        : Promise.resolve([]),
    ]);

    const activeFilter = and(eq(customer.businessProfileId, tenant.id), sql`${customer.archivedAt} IS NULL`);
    const newSince = new Date();
    newSince.setDate(newSince.getDate() - 30);
    const [summaryResult, newResult, returningResult, upcomingResult, interactionCount, callsResult, messagesResult] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(customer).where(activeFilter),
      db.select({ count: sql<number>`count(*)` }).from(customer).where(and(activeFilter, gte(customer.createdAt, newSince))),
      db.select({ count: sql<number>`count(*)` }).from(customer).where(and(activeFilter, eq(customer.status, 'returning'))),
      foodBusiness
        ? db.select({ count: sql<number>`count(*)` }).from(job).innerJoin(customer, eq(job.customerId, customer.id)).where(and(eq(job.businessProfileId, tenant.id), activeFilter, gte(job.scheduledAt, new Date()), sql`${job.status} NOT IN ('cancelled', 'completed')`))
        : db.select({ count: sql<number>`count(*)` }).from(customerAppointment).innerJoin(customer, eq(customerAppointment.customerId, customer.id)).where(and(activeFilter, gte(customerAppointment.scheduledAt, new Date()), sql`${customerAppointment.status} NOT IN ('cancelled', 'completed')`)),
      db.select({ count: sql<number>`count(*)` }).from(customerInteraction).innerJoin(customer, eq(customerInteraction.customerId, customer.id)).where(eq(customer.businessProfileId, tenant.id)),
      db.select({ count: sql<number>`coalesce(sum(${customer.callCount}), 0)` }).from(customer).where(activeFilter),
      db.select({ count: sql<number>`coalesce(sum(${customer.messageCount}), 0)` }).from(customer).where(activeFilter),
    ]);

    const appointmentByCustomer = new Map<string, (typeof nextAppointments)[number]>();
    nextAppointments.forEach((appointment) => {
      if (!appointmentByCustomer.has(appointment.customerId)) appointmentByCustomer.set(appointment.customerId, appointment);
    });

    res.json({
      businessName: tenant.businessName,
      businessType: tenant.businessType,
      customers: customers.map((item) => ({ ...item, tags: tags.filter((tag) => tag.customerId === item.id).map((tag) => tag.label), nextAppointment: appointmentByCustomer.get(item.id) || null })),
      pagination: { page: safePage, pageSize: PAGE_SIZE, total, totalPages },
      summary: { total: Number(summaryResult[0]?.count || 0), newCustomers: Number(newResult[0]?.count || 0), returningCustomers: Number(returningResult[0]?.count || 0), upcomingAppointments: Number(upcomingResult[0]?.count || 0), interactions: Number(interactionCount[0]?.count || 0), calls: Number(callsResult[0]?.count || 0), messages: Number(messagesResult[0]?.count || 0) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load customer profiles.', message: String(error) });
  }
}
