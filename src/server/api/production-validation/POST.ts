import type { Request, Response } from 'express';

// This endpoint previously ran a mutation-based SMS regression workflow with
// fixed phone numbers. Production verification must never create test customer
// or appointment data, so live validation now happens only through a real
// signed Twilio webhook for an assigned business number.
export default async function handler(_req: Request, res: Response) {
  res.status(410).json({ error: 'Automated production SMS validation is disabled. Use a real signed SMS to an assigned business number.' });
}
