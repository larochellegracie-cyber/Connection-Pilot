import type { Request, Response } from 'express';
import { getTenant } from '../customers/tenant.js';
import { getCustomerMessagingStatus } from '@/server/customer-messaging.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    res.json({ messaging: await getCustomerMessagingStatus(tenant.id) });
  } catch {
    res.status(500).json({ error: 'Unable to load AI Customer Messaging status.' });
  }
}
