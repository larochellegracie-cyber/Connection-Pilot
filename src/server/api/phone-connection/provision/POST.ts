import type { Request, Response } from 'express';

export default function handler(_req: Request, res: Response) {
  res.status(503).json({ error: 'Phone connection is coming soon. New phone number provisioning is not available.' });
}
