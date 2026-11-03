import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { goals, platforms, type ContentKind, type PlatformId } from '@/lib/marketing-content.js';
import { generatePiece } from '@/server/marketing/generate.js';
import { aiComplete, cachedIdeas, generationFailure, loadMarketingInput, NEEDS_BUSINESS_INFORMATION } from '@/server/marketing/service.js';
import { createContent } from '@/server/marketing/store.js';
import { requireAi, text } from '../shared.js';

/** POST /api/marketing/content: Pilot writes one post or video concept as a DRAFT. Nothing is approved or published. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const kind: ContentKind = req.body?.kind === 'video' ? 'video' : 'post';
    const platform = req.body?.platform as PlatformId;
    if (!(platforms as readonly string[]).includes(platform)) return void res.status(400).json({ error: 'Choose a platform: Instagram, Facebook, TikTok or LinkedIn.' });
    if (!requireAi(res)) return;

    let topic = text(req.body?.topic, 200); let goal = text(req.body?.goal, 80); let cta = text(req.body?.cta, 200);
    const idea = req.body?.ideaId ? (await cachedIdeas(tenant))?.ideas.find((candidate) => candidate.id === req.body.ideaId) : undefined;
    if (idea) { topic = topic || idea.title; goal = goal || idea.goal; cta = cta || idea.cta; }
    if (!topic) return void res.status(400).json({ error: 'Tell Pilot what the content should be about, or start from one of its ideas.' });
    if (goal && !(goals as readonly string[]).includes(goal)) goal = '';

    const { input, hasRealData } = await loadMarketingInput(tenant);
    if (!hasRealData) return void res.status(409).json({ error: NEEDS_BUSINESS_INFORMATION, needsBusinessInformation: true });
    const piece = await generatePiece({ kind, platform, topic, tone: text(req.body?.tone, 80) || undefined, goal: goal || undefined, cta: cta || undefined, why: idea?.why }, input, aiComplete);
    const item = await createContent(tenant.id, { ...piece, evidence: idea?.evidence.length ? idea.evidence : piece.evidence, status: 'draft', scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null });
    res.status(201).json({ item });
  } catch (error) {
    const failure = generationFailure(error);
    res.status(failure.status).json(failure.body);
  }
}
