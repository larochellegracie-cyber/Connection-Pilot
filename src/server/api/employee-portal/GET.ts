import type { Request, Response } from 'express';

// Employee self-service is intentionally disabled for the owner-managed scheduling release.
export default function handler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Employee self-service is not available.' });
}
