import type { Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { customer, job } from '@/server/db/schema.js';
import { getTenant, textValue } from '../customers/tenant.js';
import { isFoodBusiness } from '@/lib/business-workflow.js';
import { jobDetailsToNotes, orderDetailsToNotes, orderTitle, type OrderItem } from '@/lib/order-record.js';
import { isJobStatus, logJobActivity } from './shared.js';

function dateValue(value: unknown) { const date = new Date(textValue(value)); return Number.isNaN(date.getTime()) ? null : date; }
function orderItems(value: unknown): OrderItem[] { return Array.isArray(value) ? value.map((item) => ({ name: textValue(item?.name, 255), quantity: Number(item?.quantity) })).filter((item) => item.name && Number.isInteger(item.quantity) && item.quantity > 0) : []; }
function money(value: unknown) { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : ''; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const customerId = textValue(req.body.customerId, 36); const foodBusiness = isFoodBusiness(tenant.businessType); const scheduledAt = dateValue(req.body.scheduledAt);
    const matchingCustomer = await db.select({ id: customer.id }).from(customer).where(and(eq(customer.id, customerId), eq(customer.businessProfileId, tenant.id))).limit(1);
    const items = orderItems(req.body.items); const service = foodBusiness ? orderTitle(items) : textValue(req.body.service);
    if (!matchingCustomer[0] || !service) return void res.status(400).json({ error: foodBusiness ? 'Choose a customer and add at least one order item.' : 'Choose a customer and add the service work.' });
    const duration = Number(req.body.durationMinutes); const requestedStatus = textValue(req.body.status, 30); const status = isJobStatus(requestedStatus) ? requestedStatus : 'booked';
    const notes = foodBusiness ? orderDetailsToNotes({ items, fulfillment: textValue(req.body.fulfillment) === 'delivery' ? 'delivery' : 'pickup', total: money(req.body.total), notes: textValue(req.body.notes, 10000) }) : jobDetailsToNotes(money(req.body.price), textValue(req.body.notes, 10000));
    const id = randomUUID();
    await db.insert(job).values({ id, businessProfileId: tenant.id, customerId, service, address: foodBusiness ? null : textValue(req.body.address, 5000) || null, assignedEmployee: foodBusiness ? null : textValue(req.body.assignedEmployee) || null, scheduledAt, durationMinutes: foodBusiness ? null : Number.isInteger(duration) && duration > 0 ? duration : null, status, notes });
    await logJobActivity(id, customerId, foodBusiness ? 'Order created' : 'Job created', service);
    res.status(201).json({ id });
  } catch (error) { res.status(500).json({ error: 'Unable to create the record.', message: String(error) }); }
}
