import type { Request, Response } from 'express';
import { sendInvoiceEmail } from '@/server/finance/send-invoice.js';
import { getTenant, textValue } from '../../../../customers/tenant.js';

export { invoiceNumber } from '@/server/finance/send-invoice.js';

/** POST /api/finance/invoices/:invoiceId/send: emails the invoice to its customer (see sendInvoiceEmail). */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const result = await sendInvoiceEmail(tenant, textValue(req.params.invoiceId, 36));
    if (result.ok) return void res.json({ ok: true, messageId: result.messageId, sentTo: result.sentTo, invoiceNumber: result.invoiceNumber });
    res.status(result.status).json({ error: result.error, ...(result.setupRequired && { setupRequired: true }) });
  } catch (error) {
    console.error('invoice.email.unexpected_failure', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    res.status(500).json({ error: 'We could not send this invoice. Please try again.' });
  }
}
