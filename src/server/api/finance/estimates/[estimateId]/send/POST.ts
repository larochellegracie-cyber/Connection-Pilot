import type { Request, Response } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { businessProfile, customer, estimate, financeLineItem, marketingProfile, quoteEmailDelivery } from '@/server/db/schema.js';
import { emailFailure, sendEmailOrThrow } from '@/server/email';
import { quoteEmailTemplate } from '@/server/email-templates';
import { getTenant, textValue } from '../../../../customers/tenant.js';
import { logFinanceActivity } from '../../../shared.js';

function quoteNumber(id: string) { return `Q-${id.slice(0, 8).toUpperCase()}`; }
function failureMessage(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : 'Unknown email gateway error'; }
function firstBrandColour(value: string | null) { return value?.match(/#[0-9a-f]{6}/i)?.[0] || null; }

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const estimateId = textValue(req.params.estimateId, 36); const requestId = textValue(req.body.requestId, 36);
    if (!requestId) return void res.status(400).json({ error: 'A send request id is required.' });
    const record = (await db.select({ id: estimate.id, customerId: estimate.customerId, customerName: customer.name, customerEmail: customer.email, subtotal: estimate.subtotal, taxTotal: estimate.taxTotal, total: estimate.total, notes: estimate.notes, createdAt: estimate.createdAt, expiresAt: estimate.expiresAt, status: estimate.status }).from(estimate).innerJoin(customer, eq(estimate.customerId, customer.id)).where(and(eq(estimate.id, estimateId), eq(estimate.businessProfileId, tenant.id), eq(customer.businessProfileId, tenant.id))).limit(1))[0];
    if (!record) return void res.status(404).json({ error: 'Quote not found.' });
    const recipient = record.customerEmail?.trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return void res.status(400).json({ error: 'This customer needs a valid email address before the quote can be sent.' });
    const existing = (await db.select().from(quoteEmailDelivery).where(and(eq(quoteEmailDelivery.estimateId, estimateId), eq(quoteEmailDelivery.requestId, requestId))).limit(1))[0];
    if (existing?.status === 'accepted') return void res.json({ ok: true, duplicate: true, messageId: existing.providerMessageId });
    if (existing?.status === 'sending') return void res.status(409).json({ error: 'This quote email is already being sent. Please wait before trying again.' });
    const deliveryId = existing?.id || randomUUID();
    if (existing) await db.update(quoteEmailDelivery).set({ status: 'sending', failureReason: null, providerMessageId: null, providerStatus: null, acceptedAt: null }).where(eq(quoteEmailDelivery.id, deliveryId));
    else {
      try { await db.insert(quoteEmailDelivery).values({ id: deliveryId, businessProfileId: tenant.id, estimateId, requestId, recipientEmail: recipient, status: 'sending' }); }
      catch { return void res.status(409).json({ error: 'This quote email is already being processed. Please refresh before trying again.' }); }
    }
    const lineItems = await db.select().from(financeLineItem).where(eq(financeLineItem.estimateId, estimateId)).orderBy(asc(financeLineItem.position));
    const branding = (await db.select({ businessName: businessProfile.businessName, businessEmail: businessProfile.businessEmail, phoneNumber: businessProfile.phoneNumber, logoUrl: marketingProfile.logoUrl, brandColors: marketingProfile.brandColors }).from(businessProfile).leftJoin(marketingProfile, eq(marketingProfile.businessProfileId, businessProfile.id)).where(eq(businessProfile.id, tenant.id)).limit(1))[0];
    const number = quoteNumber(record.id);
    const subject = `${tenant.businessName} quote ${number}`;
    const message = quoteEmailTemplate({ brand: { businessName: branding?.businessName || tenant.businessName, businessEmail: branding?.businessEmail, phoneNumber: branding?.phoneNumber, logoUrl: branding?.logoUrl, brandColour: firstBrandColour(branding?.brandColors || null) }, customerName: record.customerName, quoteNumber: number, createdAt: record.createdAt, expiresAt: record.expiresAt, lineItems: lineItems.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, subtotal: item.subtotal })), subtotal: record.subtotal, taxTotal: record.taxTotal, total: record.total, notes: record.notes });
    try {
      const result = await sendEmailOrThrow({ fromName: branding?.businessName || tenant.businessName, to: recipient, subject, text: message.text, html: message.html });
      await db.transaction(async (tx) => { await tx.update(quoteEmailDelivery).set({ status: 'accepted', providerMessageId: result.messageId, providerStatus: 'accepted', acceptedAt: new Date() }).where(and(eq(quoteEmailDelivery.id, deliveryId), eq(quoteEmailDelivery.businessProfileId, tenant.id))); await tx.update(estimate).set({ status: 'sent' }).where(and(eq(estimate.id, estimateId), eq(estimate.businessProfileId, tenant.id))); await logFinanceActivity(tx, record.customerId, null, 'Quote email accepted', `Quote ${number} accepted by the email provider.`); });
      console.info('quote.email.accepted', { tenantId: tenant.id, estimateId, deliveryId, providerMessageId: result.messageId, providerStatus: 'accepted' });
      return void res.json({ ok: true, messageId: result.messageId });
    } catch (error) {
      const reason = failureMessage(error); await db.update(quoteEmailDelivery).set({ status: 'failed', providerStatus: 'failed', failureReason: reason }).where(and(eq(quoteEmailDelivery.id, deliveryId), eq(quoteEmailDelivery.businessProfileId, tenant.id)));
      console.error('quote.email.failed', { tenantId: tenant.id, estimateId, deliveryId, providerStatus: 'failed', reason });
      const failure = emailFailure(error);
      return void res.status(failure.status).json({ error: failure.error, setupRequired: failure.setupRequired });
    }
  } catch (error) { console.error('quote.email.unexpected_failure', { reason: failureMessage(error) }); res.status(500).json({ error: 'We could not send this quote email. Please try again.' }); }
}
