import type { Request, Response } from 'express';
import { getTenant } from '../customers/tenant.js';
import { updateCustomerMessagingStatus } from '@/server/customer-messaging.js';

export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res);
    if (!tenant) return;
    if (typeof req.body?.enabled !== 'boolean') {
      res.status(400).json({ error: 'Specify whether AI Customer Messaging should be enabled.' });
      return;
    }
    res.json({ messaging: await updateCustomerMessagingStatus(tenant.id, req.body.enabled) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update AI Customer Messaging.';
    res.status(403).json({ error: message });
  }
}
