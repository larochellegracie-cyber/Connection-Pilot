import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/server/db/client.js';
import { businessProfile, customer, financeLineItem, invoice, marketingProfile, payment } from '@/server/db/schema.js';
import { emailFailure, sendEmailOrThrow } from '@/server/email';
import { invoiceEmailTemplate } from '@/server/email-templates';
import { logFinanceActivity } from '@/server/api/finance/shared.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function invoiceNumber(id: string) { return `INV-${id.slice(0, 8).toUpperCase()}`; }
function firstBrandColour(value: string | null) { return value?.match(/#[0-9a-f]{6}/i)?.[0] || null; }
const failureReason = (error: unknown) => (error instanceof Error ? error.message.slice(0, 300) : 'unknown');

export type SendInvoiceResult =
  | { ok: true; messageId: string; sentTo: string; invoiceNumber: string }
  | { ok: false; status: number; error: string; setupRequired?: true };

/**
 * Emails one invoice to its customer through the shared email service (same template, branding and
 * provider as quotes). Used by the Finance page and by Pilot chat, so there is a single implementation.
 * Sending a draft marks it "sent"; sending again is a resend. It only reports success when the email
 * provider actually accepted the message.
 */
export async function sendInvoiceEmail(tenant: { id: string; businessName: string }, invoiceId: string): Promise<SendInvoiceResult> {
  const record = (await db.select({ id: invoice.id, customerId: invoice.customerId, customerName: customer.name, customerEmail: customer.email, jobId: invoice.jobId, subtotal: invoice.subtotal, taxTotal: invoice.taxTotal, total: invoice.total, notes: invoice.notes, createdAt: invoice.createdAt, dueAt: invoice.dueAt, status: invoice.status })
    .from(invoice).innerJoin(customer, eq(invoice.customerId, customer.id)).where(and(eq(invoice.id, invoiceId), eq(invoice.businessProfileId, tenant.id))).limit(1))[0];
  if (!record) return { ok: false, status: 404, error: 'Invoice not found.' };
  if (record.status === 'void') return { ok: false, status: 400, error: 'A void invoice cannot be sent.' };
  const recipient = record.customerEmail?.trim();
  if (!recipient || !EMAIL_PATTERN.test(recipient)) return { ok: false, status: 400, error: 'This customer needs a valid email address before the invoice can be sent.' };

  const lineItems = await db.select().from(financeLineItem).where(eq(financeLineItem.invoiceId, invoiceId)).orderBy(asc(financeLineItem.position));
  const payments = await db.select({ amount: payment.amount, status: payment.status }).from(payment).where(and(eq(payment.invoiceId, invoiceId), eq(payment.businessProfileId, tenant.id)));
  const paid = payments.filter((item) => item.status === 'completed').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const due = Math.max(0, Number(record.total) - paid);
  const branding = (await db.select({ businessName: businessProfile.businessName, businessEmail: businessProfile.businessEmail, phoneNumber: businessProfile.phoneNumber, logoUrl: marketingProfile.logoUrl, brandColors: marketingProfile.brandColors })
    .from(businessProfile).leftJoin(marketingProfile, eq(marketingProfile.businessProfileId, businessProfile.id)).where(eq(businessProfile.id, tenant.id)).limit(1))[0];

  const number = invoiceNumber(record.id);
  const businessName = branding?.businessName || tenant.businessName;
  const message = invoiceEmailTemplate({
    brand: { businessName, businessEmail: branding?.businessEmail, phoneNumber: branding?.phoneNumber, logoUrl: branding?.logoUrl, brandColour: firstBrandColour(branding?.brandColors || null) },
    customerName: record.customerName, invoiceNumber: number, createdAt: record.createdAt, dueAt: record.dueAt,
    lineItems: lineItems.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, subtotal: item.subtotal })),
    subtotal: record.subtotal, taxTotal: record.taxTotal, total: record.total, amountPaid: paid.toFixed(2), amountDue: due.toFixed(2),
    status: due === 0 && Number(record.total) > 0 ? 'Paid' : record.status === 'overdue' ? 'Overdue' : 'Due', notes: record.notes,
  });

  let messageId: string;
  try {
    ({ messageId } = await sendEmailOrThrow({ fromName: businessName, to: recipient, subject: `${businessName} invoice ${number}`, text: message.text, html: message.html }));
  } catch (error) {
    console.error('invoice.email.failed', { tenantId: tenant.id, invoiceId, reason: failureReason(error) });
    const failure = emailFailure(error);
    return { ok: false, status: failure.status, error: failure.error, ...(failure.setupRequired && { setupRequired: true as const }) };
  }
  // The email has gone out. Record it; a bookkeeping hiccup must not make the owner resend it.
  try {
    if (record.status === 'draft') await db.update(invoice).set({ status: 'sent' }).where(and(eq(invoice.id, invoiceId), eq(invoice.businessProfileId, tenant.id)));
    await logFinanceActivity(db, record.customerId, record.jobId, 'Invoice sent', `Invoice ${number} was emailed to ${recipient}.`);
  } catch (error) { console.error('invoice.email.record_failed', { tenantId: tenant.id, invoiceId, reason: failureReason(error) }); }
  console.info('invoice.email.accepted', { tenantId: tenant.id, invoiceId, providerMessageId: messageId });
  return { ok: true, messageId, sentTo: recipient, invoiceNumber: number };
}
