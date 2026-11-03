import type { Request, Response } from 'express';
import { getTenant } from '@/server/api/customers/tenant.js';
import { applyAction, cleanVideoConcept, fitToPlatform, needsReviewAfterEdit, platforms, stripUnsupportedClaims, type ContentAction, type ContentItem, type PlatformId } from '@/lib/marketing-content.js';
import { getContent, saveContent } from '@/server/marketing/store.js';
import { text } from '../../shared.js';

const copyFields = ['hook', 'caption', 'cta', 'hashtags', 'suggestedVisual', 'postingFormat', 'topic', 'platform', 'video'] as const;

function actionFrom(value: unknown): ContentAction | null {
  const input = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null;
  switch (input?.type) {
    case 'approve': return { type: 'approve' };
    case 'back_to_draft': return { type: 'back_to_draft' };
    case 'mark_published': return { type: 'mark_published' };
    case 'schedule': return { type: 'schedule', date: text(input.date, 10), time: text(input.time, 5) || null };
    case 'move': return { type: 'move', date: input.date === null ? null : text(input.date, 10), ...('time' in input ? { time: text(input.time, 5) || null } : {}) };
    default: return null;
  }
}

/**
 * PATCH /api/marketing/content/:contentId { ...edits, action? }
 * The owner edits the words and moves content through approval. "mark_published" only records that the owner posted it:
 * no platform is ever contacted. Editing reviewed content sends it back to draft so it is reviewed again.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    const current = await getContent(tenant.id, text(req.params.contentId, 36));
    if (!current) return void res.status(404).json({ error: 'That content was not found.' });
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    let item: ContentItem = { ...current };
    const edited = copyFields.some((field) => field in body);
    if (edited) {
      if ('platform' in body) { if (!(platforms as readonly string[]).includes(body.platform as string)) return void res.status(400).json({ error: 'Choose a valid platform.' }); item.platform = body.platform as PlatformId; }
      if ('hook' in body) item.hook = stripUnsupportedClaims(text(body.hook, 300));
      if ('caption' in body) item.caption = stripUnsupportedClaims(text(body.caption, 5000));
      if ('cta' in body) item.cta = stripUnsupportedClaims(text(body.cta, 200));
      if ('suggestedVisual' in body) item.suggestedVisual = text(body.suggestedVisual, 500);
      if ('postingFormat' in body) item.postingFormat = text(body.postingFormat, 160);
      if ('topic' in body) item.topic = text(body.topic, 200);
      if ('hashtags' in body) item.hashtags = (Array.isArray(body.hashtags) ? body.hashtags : []).filter((tag): tag is string => typeof tag === 'string');
      if ('video' in body && item.kind === 'video') {
        const video = cleanVideoConcept(body.video);
        if (video) {
          // an edit to the scenes means the saved designed plan no longer matches, so the video is rebuilt from the edited scenes
          const edited = JSON.stringify(video.scenes) !== JSON.stringify(current.video?.scenes);
          const { plan, ...rest } = video;
          item.video = { ...(edited ? rest : video), plan: edited ? undefined : (plan ?? current.video?.plan), render: current.video?.render ?? { status: 'not_generated' } }; // a made video file can only come from a provider, never from an edit
          if (!item.video.plan) delete item.video.plan;
        }
      }
      if (!item.hook || !item.caption || !item.cta) return void res.status(400).json({ error: 'A post needs a hook, a caption and a call to action.' });
      const fitted = fitToPlatform(item.platform, { caption: item.caption, hashtags: item.hashtags });
      item = { ...item, caption: fitted.caption, hashtags: fitted.hashtags };
      if (needsReviewAfterEdit(current.status)) item = { ...item, status: 'draft', approvedAt: null, publishedAt: null };
    }
    if (body.action !== undefined) {
      const action = actionFrom(body.action);
      if (!action) return void res.status(400).json({ error: 'That action is not recognised.' });
      const result = applyAction(item, action, new Date().toISOString());
      if ('error' in result) return void res.status(409).json({ error: result.error });
      item = result.item;
    }
    item = { ...item, updatedAt: new Date().toISOString() };
    await saveContent(tenant.id, item);
    res.json({ item, ...(edited && current.status !== item.status && current.status !== 'draft' ? { note: 'You changed reviewed content, so it is a draft again and needs approving.' } : {}) });
  } catch (error) {
    res.status(500).json({ error: 'Unable to save that change.', message: error instanceof Error ? error.message.slice(0, 200) : undefined });
  }
}
