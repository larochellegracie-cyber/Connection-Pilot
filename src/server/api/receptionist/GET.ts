import type { Request, Response } from 'express';
import { getTenant } from '../customers/tenant.js';

export default async function handler(req: Request, res: Response) {
  const tenant = await getTenant(req, res);
  if (!tenant) return;
  res.json({
    available: false,
    phoneNumber: null,
    receptionistEnabled: false,
    connectionComplete: false,
    message: 'AI Voice Receptionist is coming soon. Phone setup and activation are not available yet.',
  });
}
