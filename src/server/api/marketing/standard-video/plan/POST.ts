import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { requireAi, text } from '../../shared.js';
import { NeedsBusinessInformation, planForBusiness, PlannerError } from '@/server/marketing/standard-video/orchestrate.js';
import { platforms, type PlatformId } from '@/lib/marketing-content.js';

/**
 * POST /api/marketing/standard-video/plan { request, platform?, durationSeconds? }
 * Pilot plans a Standard Video from the owner's words and the business's own information and pictures, and shows the plan.
 * Nothing is saved and nothing is rendered. It uses one AI text call and no video service.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    if (!requireAi(res)) return;
    const request = text(req.body?.request, 600);
    if (!request) return void res.status(400).json({ error: 'Tell Pilot what the video is for, for example “a 20-second Instagram ad for my chocolate cake”.' });
    const platform = (platforms as readonly string[]).includes(req.body?.platform) ? req.body.platform as PlatformId : undefined;
    const plan = await planForBusiness(tenant, { request, platform, durationSeconds: Number(req.body?.durationSeconds) || undefined });
    res.json({ plan: plan.summary, copy: plan.copy, notes: plan.notes, reasoning: plan.reasoning, usage: plan.usage, spec: plan.spec });
  } catch (error) {
    if (error instanceof NeedsBusinessInformation) return void res.status(409).json({ error: error.message, needsBusinessInformation: true });
    if (error instanceof PlannerError) return void res.status(422).json({ error: error.publicMessage });
    res.status(502).json({ error: 'Pilot could not plan that video just now. Please try again in a moment.' });
  }
}
