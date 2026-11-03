import type { Response } from 'express';
import { aiConfigured } from '@/server/marketing/service.js';

/** Writing needs the OpenAI key. When it is missing, say so plainly instead of pretending to write. */
export function requireAi(res: Response): boolean {
  if (aiConfigured()) return true;
  res.status(503).json({ error: 'Pilot Marketing cannot write content yet because the OpenAI connection is not set up. An OpenAI API key needs to be added to this app’s settings.', setupRequired: true });
  return false;
}

export const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
