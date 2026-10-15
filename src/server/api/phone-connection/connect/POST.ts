import type { Request, Response } from 'express';
import { getTenant } from '../../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  const tenant = await getTenant(req, res);
  if (!tenant) return;
  res.status(503).json({ error: 'Phone connection is coming soon. Business phone numbers cannot be connected yet.' });
}
