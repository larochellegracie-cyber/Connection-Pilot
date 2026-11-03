import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { platforms, type PlatformId } from '@/lib/marketing-content.js';
import { createStandardVideo, NeedsBusinessInformation, PlannerError } from '@/server/marketing/standard-video/orchestrate.js';
import { requireAi, text } from '../shared.js';

/**
 * POST /api/marketing/standard-video { request, platform?, durationSeconds?, startRender? }
 * "Make me a 20-second Instagram ad for my chocolate cake." Pilot plans the video and saves it to the Marketing library as a
 * DRAFT video (so it can be edited, approved and scheduled like any other content). With startRender it also starts making
 * the MP4 right away. Standard Video only: this never calls Runway.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    if (!requireAi(res)) return;
    const request = text(req.body?.request, 600);
    if (!request) return void res.status(400).json({ error: 'Tell Pilot what the video is for, for example “a 20-second Instagram ad for my chocolate cake”.' });
    const platform = (platforms as readonly string[]).includes(req.body?.platform) ? req.body.platform as PlatformId : undefined;
    const result = await createStandardVideo(tenant, { request, platform, durationSeconds: Number(req.body?.durationSeconds) || undefined, startRender: req.body?.startRender === true });
    res.status(201).json({ item: result.item, plan: result.plan, notes: result.notes, usage: result.usage, render: result.render });
  } catch (error) {
    if (error instanceof NeedsBusinessInformation) return void res.status(409).json({ error: error.message, needsBusinessInformation: true });
    if (error instanceof PlannerError) return void res.status(422).json({ error: error.publicMessage });
    res.status(502).json({ error: 'Pilot could not plan that video just now. Please try again in a moment.' });
  }
}
