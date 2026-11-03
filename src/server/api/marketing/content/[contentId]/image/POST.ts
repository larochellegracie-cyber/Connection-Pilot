import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { choosePostImage, createPostImage, pictureFailure, removePostMedia } from '@/server/marketing/image.js';
import { aiComplete, loadMarketingInput } from '@/server/marketing/service.js';
import { getContent, saveContent } from '@/server/marketing/store.js';
import { requireAi, text } from '../../../shared.js';

/**
 * POST /api/marketing/content/:contentId/image: gives a post a visual: the owner's own photo when one suits, otherwise a branded graphic
 * Pilot draws from the business's colours, logo and the post's words (no AI picture, no cost). A new one replaces the old one (a drawn one is removed; an uploaded photo is never deleted). The post goes back to review if it had been approved.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const current = await getContent(tenant.id, text(req.params.contentId, 36));
    if (!current) return void res.status(404).json({ error: 'That content was not found.' });
    if (current.kind !== 'post') return void res.status(400).json({ error: 'Pictures are made for posts. A video is made as a video.' });
    const { input } = await loadMarketingInput(tenant);
    // a new look: another of the owner's photos if one suits, otherwise a different layout of the branded graphic. Never an AI picture.
    const heldPhoto = current.image?.source === 'photo' ? current.image.url.split('/').pop() : undefined;
    const variant = current.image ? (Number(current.image.prompt.match(/#(\d)$/)?.[1] ?? 0) + 1) % 3 : 0;
    // a picture the owner explicitly asked Pilot to generate with AI stays an AI picture: a new one is another AI variation (the only case that calls an image service)
    if (current.image?.source === 'generated' && !requireAi(res)) return;
    const image = current.image?.source === 'generated'
      ? await createPostImage({ tenantId: tenant.id, brief: input.brief, platform: current.platform, topic: current.topic || current.hook, scene: current.image.prompt, hook: current.hook, variation: true, explicit: true })
      : await choosePostImage({ tenantId: tenant.id, brief: input.brief, complete: aiComplete, topic: current.topic || current.hook, hook: current.hook, cta: current.cta, exclude: current.image ? heldPhoto : undefined, variant });
    const item = { ...current, image, updatedAt: new Date().toISOString() };
    await saveContent(tenant.id, item);
    await removePostMedia(tenant.id, current.image);
    res.json({ item });
  } catch (error) {
    console.error('post picture failed', pictureFailure(error));
    res.status(502).json({ error: 'Pilot couldn’t make the picture just now. Please try again in a moment.' });
  }
}
