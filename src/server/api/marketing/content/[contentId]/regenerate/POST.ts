import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { generatePiece } from '@/server/marketing/generate.js';
import { aiComplete, generationFailure, loadMarketingInput } from '@/server/marketing/service.js';
import { getContent, saveContent } from '@/server/marketing/store.js';
import { choosePostImage, pictureFailure, removePostMedia } from '@/server/marketing/image.js';
import { replanStandardVideo } from '@/server/marketing/standard-video/orchestrate.js';
import { requireAi, text } from '../../../shared.js';

/** POST /api/marketing/content/:contentId/regenerate: Pilot rewrites the piece from the same brief. It returns to draft for review. */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const current = await getContent(tenant.id, text(req.params.contentId, 36));
    if (!current) return void res.status(404).json({ error: 'That content was not found.' });
    if (!requireAi(res)) return;
    const instruction = text(req.body?.instruction, 300);
    const reset = { status: current.status === 'proposed' ? 'proposed' as const : 'draft' as const, approvedAt: null, publishedAt: null, updatedAt: new Date().toISOString() };
    if (instruction && current.kind === 'video' && current.video?.plan) {
      // a Standard Video planned by Pilot: plan it again with the owner's change, and make the file again
      const replanned = await replanStandardVideo(tenant, current, instruction);
      const item = { ...current, ...replanned, ...reset };
      await saveContent(tenant.id, item);
      return void res.json({ item });
    }
    const { input } = await loadMarketingInput(tenant);
    const topic = instruction ? `${current.topic || current.hook}. The owner asked for this change, so make it clearly different in that way: ${instruction}` : current.topic || current.hook;
    const piece = await generatePiece({ kind: current.kind, platform: current.platform, topic, tone: current.tone || undefined, goal: current.goal || undefined, why: current.why }, { ...input, existing: input.existing.filter((other) => other.id !== current.id) }, aiComplete);
    if (instruction) piece.topic = current.topic;
    if (piece.video && current.video?.mode) piece.video = { ...piece.video, mode: current.video.mode };
    const { imagePrompt: _unused, ...words } = piece;
    // a rewritten post gets a picture to match its new words: a suitable photo of the owner's, else a branded animated graphic (best effort: the old one is kept if a new one can't be made)
    let image = current.image ?? null;
    // a picture the owner explicitly asked for with AI is kept as it is (a rewrite never spends on a new one)
    if (current.kind === 'post' && current.image?.source !== 'generated') {
      try { image = await choosePostImage({ tenantId: tenant.id, brief: input.brief, complete: aiComplete, topic: current.topic || words.hook, hook: words.hook, cta: words.cta }); await removePostMedia(tenant.id, current.image); } catch (error) { console.error('post picture failed', pictureFailure(error)); }
    }
    const item = { ...current, ...words, image, evidence: current.evidence.length ? current.evidence : words.evidence, ...reset };
    await saveContent(tenant.id, item);
    res.json({ item });
  } catch (error) {
    const failure = generationFailure(error);
    res.status(failure.status).json(failure.body);
  }
}
