import { detectCreativeRequest, type CreativeDetection } from '@/lib/marketing-creative-mode.js';
import { creativeModeReply, loadCreativeContext, type CreativeContext } from './creative-context.js';
import { extractBrief, type CreativeBrief } from './creative-brief.js';
import { isAmbiguous } from './video-engine.js';
import { proceedWithBrief } from './creative-followup.js';
import type { Complete } from './generate.js';
import { createMarketingJob, type MarketingJob } from './marketing-jobs.js';

/**
 * Marketing Creative Mode, the start of every request (used by both the Pilot chat and the Marketing page chat):
 *  1. load this business's profile and its full list of media,
 *  2. read the owner's request into the structured creative brief,
 *  3. save the request and brief as a Marketing Job,
 *  4. go ahead: a clear request starts at once as a free animated video; a request for the premium look (Runway) shows its cost and
 *     waits for a yes; a request with no subject gets one question. See creative-followup.ts.
 * Nothing is asked to be confirmed by default, and Runway is never used unless the owner asked for it.
 */
export type CreativeModeResult = { reply: string; job: MarketingJob | null; brief: CreativeBrief; context: CreativeContext; detection: CreativeDetection; /** True when a video is being made. */ showJob: boolean };

/**
 * A request that names no subject ("make me a video for Somerset") is not worth a question when Pilot already knows the business: it picks
 * the current promotion, else the first of the business's services. Returns null only when it knows nothing to pick from, and then (and
 * only then) the owner is asked one question.
 */
export function defaultSubject(context: CreativeContext): string | null {
  const { promotions, services } = context.business;
  const promotion = promotions.replace(/\s+/g, ' ').trim();
  if (promotion && promotion.length <= 80) return promotion;
  return services.find((service) => service.trim().length > 2)?.trim() ?? null;
}

export async function enterCreativeMode({ tenant, message, detection, format, complete, referenceId }: { tenant: { id: string; businessName: string; businessType: string }; message: string; detection?: CreativeDetection; format: 'markdown' | 'plain'; complete: Complete; /** a reference video the owner attached: the new video copies its style */ referenceId?: string }): Promise<CreativeModeResult> {
  const seen = detection?.isCreative ? detection : detectCreativeRequest(message);
  const noticed: CreativeDetection = seen.isCreative ? seen : { isCreative: true, formats: ['something_creative'], platform: null, matched: [] };
  const [context, extracted] = await Promise.all([
    loadCreativeContext(tenant.id),
    extractBrief({ message, detection: noticed, businessName: tenant.businessName, businessType: tenant.businessType, complete }),
  ]);
  // no subject named: use what Pilot knows about the business instead of asking
  let brief = referenceId ? { ...extracted.brief, reference_id: referenceId } : extracted.brief; let chosen: string | null = null;
  if (isAmbiguous(brief)) { chosen = defaultSubject(context); if (chosen) brief = { ...brief, main_subject: chosen }; }
  if (referenceId) brief = { ...brief, content_type: 'video' };
  let job: MarketingJob | null = null;
  try { job = await createMarketingJob(tenant.id, { userMessage: message, brief }); } catch (error) { console.error('marketing job could not be saved', error instanceof Error ? error.name : 'unknown'); }
  console.info(JSON.stringify({ event: 'marketing-creative-mode', tenantId: tenant.id, jobId: job?.id ?? null, briefSource: extracted.source, formats: noticed.formats, platform: extracted.brief.platform, contentType: extracted.brief.content_type, photos: context.media.photos.length, logos: context.media.logos.length, videos: context.media.videos.length }));
  if (!job) {
    return { reply: creativeModeReply(noticed, context, { format, brief, jobSaved: false }), job: null, brief, context, detection: noticed, showJob: false };
  }
  const result = await proceedWithBrief({ tenant, job, context, format, detection: noticed });
  const note = chosen && result.showJob ? `\n\nYou didn’t name a subject, so I chose “${chosen}” from what I know about your business. Tell me if you’d like something else and I’ll redo it.` : '';
  return { reply: result.reply + note, job: result.job, brief, context, detection: noticed, showJob: result.showJob };
}
