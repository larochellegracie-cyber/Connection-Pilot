import type { Request, Response } from 'express';

export default function handler(_req: Request, res: Response) {
  res.status(410).json({ error: 'New phone number provisioning is not available. Connection Pilot connects existing business numbers through porting only.' });
}
