import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { aiConfigured } from '@/server/marketing/service.js';
import { handlePilotMessage } from '@/server/marketing/pilot.js';
import { NeedsBusinessInformation, PlannerError } from '@/server/marketing/standard-video/orchestrate.js';
import { GenerationError } from '@/server/marketing/generate.js';
import { loadReference } from '@/server/marketing/reference/index.js';
import { loadReferenceImage } from '@/server/marketing/reference-image/index.js';
import { text } from '../shared.js';

/**
 * POST /api/marketing/pilot { message, ideaId? }
 * The owner talks to Pilot in plain words ("make me a 20-second Instagram ad for our pool closing service", "give me ideas
 * for this week", "make #3"). Pilot works out what is wanted and makes it. It returns the finished draft, a list of ideas, or
 * a short reply. Nothing is approved or posted. Customers only ever see plain-language messages.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const message = text(req.body?.message, 600);
    if (!message) return void res.status(400).json({ error: 'Tell Pilot what you’d like.' });
    if (!aiConfigured()) return void res.status(503).json({ error: 'Pilot isn’t ready to create things yet. Please contact support.', setupRequired: true });
    const ideaId = text(req.body?.ideaId, 60) || undefined;
    const referenceId = text(req.body?.referenceId, 64);
    const isVideo = referenceId ? !!(await loadReference(tenant.id, referenceId)) : false;
    const isImage = referenceId && !isVideo ? !!(await loadReferenceImage(tenant.id, referenceId)) : false;
    if (referenceId && !isVideo && !isImage) return void res.status(404).json({ error: 'I can’t find that reference any more. Please attach it again.' });
    res.json({ reply: await handlePilotMessage(tenant, message, { ideaId, ...(isVideo ? { referenceId } : {}), ...(isImage ? { referenceImageId: referenceId } : {}) }) });
  } catch (error) {
    if (error instanceof NeedsBusinessInformation) return void res.status(409).json({ error: 'Pilot needs to know a little about your business first. Add your services or connect your website in Business.', needsBusinessInformation: true });
    if (error instanceof PlannerError) return void res.status(422).json({ error: error.publicMessage });
    if (error instanceof GenerationError) return void res.status(422).json({ error: error.publicMessage });
    console.error('pilot marketing request failed', error instanceof Error ? error.name : 'unknown');
    res.status(502).json({ error: 'Pilot couldn’t do that just now. Please try again in a moment.' });
  }
}
