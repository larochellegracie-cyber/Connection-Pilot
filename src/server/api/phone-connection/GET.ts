import type { Request, Response } from 'express';
import { getTenant } from '../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  const tenant = await getTenant(req, res);
  if (!tenant) return;
  res.json({ connection: null, available: false, message: 'Phone connection is coming soon. No business phone numbers are connected.' });
}
