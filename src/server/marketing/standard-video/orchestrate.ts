import type { VideoConcept } from '@/lib/marketing-content.js';
import type { ContentItem } from '@/lib/marketing-content.js';
import { startVideo } from '../providers.js';
import { createContent, saveContent } from '../store.js';
import { aiCompleteWithUsage, loadMarketingInput, NEEDS_BUSINESS_INFORMATION, type Tenant } from '../service.js';
import { loadBrandKit } from '../store.js';
import { pickLogo } from './business-assets.js';
import { planStandardVideo, PlannerError, type PlanResult } from './planner.js';
import { getMediaStorage } from './storage.js';

export class NeedsBusinessInformation extends Error { constructor() { super(NEEDS_BUSINESS_INFORMATION); this.name = 'NeedsBusinessInformation'; } }

/** Plans a Standard Video for one business from the information, pictures and insights Pilot already has about it. */
export async function planForBusiness(tenant: Tenant, body: { request: string; platform?: ContentItem['platform']; durationSeconds?: number }): Promise<PlanResult> {
  const { input, hasRealData } = await loadMarketingInput(tenant);
  if (!hasRealData) throw new NeedsBusinessInformation();
  const storage = getMediaStorage();
  const [kit, assets] = await Promise.all([loadBrandKit(tenant.id), storage.listAssets(tenant.id)]);
  return planStandardVideo({ request: body.request, brief: input.brief, kit, assets, logoId: pickLogo(assets, kit.logoUrl), context: { signals: input.signals, insights: input.insights }, platform: body.platform, durationSeconds: body.durationSeconds }, aiCompleteWithUsage);
}

/** The video plan as a video concept, so it appears in the Marketing library and goes through the same editing and approval as any other video. */
export function conceptFromPlan(result: PlanResult): VideoConcept {
  return {
    mode: 'standard', plan: result.spec as unknown as Record<string, unknown>, durationSeconds: result.summary.durationSeconds,
    scenes: result.summary.scenes.map((scene) => ({ seconds: scene.seconds, visual: scene.photo ? `Your photo “${scene.photo}” with the text` : 'Brand background with the text', onScreenText: scene.headline, ...(scene.subtext ? { voiceover: scene.subtext } : {}) })),
    transitions: [...new Set(result.summary.scenes.map((scene) => scene.transition))].join(', '),
    audioDirection: 'Silent video. Add music or sound in the platform’s own app.',
    render: { status: 'not_generated' },
  };
}

export { PlannerError };

/**
 * Plans a Standard Video for the owner's request and saves it to the Marketing library as a DRAFT video. With startRender it
 * also starts making the MP4. This is Standard Video only: it never calls Runway.
 */
export async function createStandardVideo(tenant: Tenant, body: { request: string; platform?: ContentItem['platform']; durationSeconds?: number; startRender?: boolean }) {
  const plan = await planForBusiness(tenant, body);
  const photos = plan.summary.photosUsed.map((photo) => photo.label);
  let item: ContentItem = await createContent(tenant.id, {
    kind: 'video', platform: plan.platform, status: 'draft', hook: plan.copy.hook, caption: plan.copy.caption, cta: plan.copy.cta, hashtags: plan.copy.hashtags,
    suggestedVisual: photos.length ? `Uses your photo${photos.length > 1 ? 's' : ''}: ${photos.join(', ')}.` : 'Text and branding only. No photo was used.',
    postingFormat: `Standard Video, ${plan.summary.size}, ${plan.summary.durationSeconds} seconds`, topic: body.request.slice(0, 200), goal: '', tone: '', why: plan.reasoning,
    evidence: [{ label: 'Your request', source: 'business', detail: body.request.slice(0, 300) }], scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null, video: conceptFromPlan(plan),
  });
  let render: { started: boolean; taskId?: string; provider?: string; message?: string; statusUrl?: string } = { started: false };
  if (body.startRender) {
    const outcome = await startVideo(item, { tenantId: tenant.id, contentId: item.id }, undefined, 'standard');
    if (outcome.ok) {
      item = { ...item, video: { ...item.video!, render: { status: 'processing', taskId: outcome.taskId, provider: outcome.provider } }, updatedAt: new Date().toISOString() };
      await saveContent(tenant.id, item);
      render = { started: true, taskId: outcome.taskId, provider: outcome.provider, statusUrl: `/api/marketing/content/${item.id}/video` };
    } else render = { started: false, message: outcome.message };
  }
  return { item, plan: plan.summary, notes: plan.notes, usage: plan.usage, render };
}

/** Plans a Standard Video again with a change the owner asked for. The old file no longer matches, so it is cleared. */
export async function replanStandardVideo(tenant: Tenant, current: ContentItem, instruction: string): Promise<Partial<ContentItem>> {
  const plan = await planForBusiness(tenant, { request: `${current.topic || current.hook}. Change: ${instruction}`.slice(0, 600), platform: current.platform });
  const photos = plan.summary.photosUsed.map((photo) => photo.label);
  return {
    platform: plan.platform, hook: plan.copy.hook, caption: plan.copy.caption, cta: plan.copy.cta, hashtags: plan.copy.hashtags,
    suggestedVisual: photos.length ? `Uses your photo${photos.length > 1 ? 's' : ''}: ${photos.join(', ')}.` : 'Text and branding only. No photo was used.',
    postingFormat: `Standard Video, ${plan.summary.size}, ${plan.summary.durationSeconds} seconds`, why: plan.reasoning, video: conceptFromPlan(plan),
  };
}
