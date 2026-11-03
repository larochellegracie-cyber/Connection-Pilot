import { classifyFollowUp, lastAssistantInMode } from '@/lib/marketing-followup.js';
import type { CreativeDetection } from '@/lib/marketing-creative-mode.js';
import { selectAssets, type AssetSelection } from './asset-selection.js';
import { describeChanges, extractBrief, mergeBrief, type CreativeBrief } from './creative-brief.js';
import { confirmedReply, creativeModeReply, loadCreativeContext, subjectQuestion, type CreativeContext } from './creative-context.js';
import type { Complete } from './generate.js';
import { describePlan, planIteration } from './iteration.js';
import { confirmMarketingJob, createMarketingJob, latestActiveJob, saveJobSelection, type MarketingJob } from './marketing-jobs.js';
import { ANIMATED_STARTING, engineFor, isAmbiguous, runwayStarting, runwayWarning, type VideoEngine } from './video-engine.js';
import { engineAvailable, engineForJob, engineOf, startVideoGeneration } from './video-generation.js';

export { lastAssistantInMode };

/**
 * Marketing Creative Mode, once a request is understood. The owner is not asked to confirm by default:
 *
 *  - a clear request for a video STARTS AT ONCE, the free way (Pilot's own animation: the owner's photos where they fit, brand colours,
 *    text and motion, original music). No outside service, no credits.
 *  - a request for the premium look (cinematic, AI video, Runway, realistic...) uses Runway, which costs credits. That is the one case
 *    that waits: the cost is shown first and Pilot asks for a "yes". ("Make it animated" switches to the free way.)
 *  - a request with no subject at all gets ONE question (what is it about?). Length, platform and style all have defaults.
 *
 * After the first video, a change ("make it darker", "change the ending") redoes only what it needs. A free video is always changed for
 * free, straight away. Anything else (a different request, or an ordinary question) returns null and is left to the normal flow. The
 * business comes from the session and every job is looked up for that business only.
 */
export type FollowUpResult = {
  reply: string; job: MarketingJob; outcome: 'confirmed' | 'already_confirmed' | 'adjusted' | 'started' | 'asked';
  /** True when a video is being made (the owner's chat can then show its progress and the finished video). */
  showJob: boolean;
};
type Tenant = { id: string; businessName: string; businessType: string };
const NOTICED: CreativeDetection = { isCreative: true, formats: [], platform: null, matched: [] };

/**
 * Asset-first selection: once a job is going ahead, look at the business's own uploaded media and pick what fits the brief's subject,
 * before anything new is made. The result is saved on the job. If it cannot be made, the job stays confirmed and the reply says so.
 */
async function selectForJob(tenant: Tenant, job: MarketingJob): Promise<{ job: MarketingJob; selection: AssetSelection | null; failed: boolean }> {
  try {
    const context = await loadCreativeContext(tenant.id);
    // artwork or images Pilot generated earlier are not the owner's own photos, so they are never offered as a match
    const selection = selectAssets({ brief: job.brief, media: context.media.all.filter((media) => !media.tags.includes('generated')), business: { businessName: context.business.businessName || tenant.businessName, businessType: context.business.businessType || tenant.businessType } });
    await saveJobSelection(tenant.id, job.id, selection);
    console.info(JSON.stringify({ event: 'marketing-creative-mode.assets-selected', tenantId: tenant.id, jobId: job.id, considered: context.media.photos.length, selected: selection.selected_assets.length, hasGoodMatch: selection.has_good_match, fallbackNeeded: selection.fallback_needed }));
    return { job: { ...job, selection }, selection, failed: false };
  } catch (error) {
    console.error('asset selection failed', error instanceof Error ? error.name : 'unknown');
    return { job, selection: null, failed: true };
  }
}

const NOT_CONNECTED_RUNWAY = 'Runway isn’t connected on this server right now, so I haven’t made it. Say “make it animated” and I’ll make the free animated version instead.';
const NOT_CONNECTED_ANIMATED = 'Making videos isn’t available on this server right now, so I haven’t made it. Your brief and media choices are saved.';
const startingLine = (engine: VideoEngine, brief: CreativeBrief) => (engine === 'animated' ? ANIMATED_STARTING : runwayStarting(brief));

/** Starts the video for a job that has its selection, the way the owner asked for it. Returns the line for the reply and whether it started. */
async function startIfPossible(tenant: Tenant, job: MarketingJob, engine: VideoEngine): Promise<{ closing?: string; started: boolean }> {
  if (!job.selection) return { started: false };
  if (!engineAvailable(engine)) return { closing: engine === 'animated' ? NOT_CONNECTED_ANIMATED : NOT_CONNECTED_RUNWAY, started: false };
  const result = await startVideoGeneration({ tenant, job }).catch((error) => { console.error('video could not be started', error instanceof Error ? error.name : 'unknown'); return { started: false }; });
  return result.started ? { closing: startingLine(engine, job.brief), started: true } : { started: false };
}

/** Confirms a job, picks the owner's media, and starts it. The common steps of "go ahead". */
async function confirmAndStart(tenant: Tenant, job: MarketingJob, engine: VideoEngine) {
  const confirmed = (await confirmMarketingJob(tenant.id, job.id)) ?? { ...job, status: 'confirmed' as const };
  console.info(JSON.stringify({ event: 'marketing-creative-mode.confirmed', tenantId: tenant.id, jobId: confirmed.id, engine }));
  const chosen = await selectForJob(tenant, confirmed);
  const next = chosen.failed ? { started: false } : await startIfPossible(tenant, chosen.job, engine);
  return { chosen, next: next as { closing?: string; started: boolean } };
}

/**
 * What happens as soon as a brief exists. Ask (no subject), start the free way (the default), or show the Runway cost and wait.
 * `changes` is set when the brief is a revision of an earlier one.
 */
export async function proceedWithBrief({ tenant, job, context, format, detection = NOTICED, changes }: { tenant: Tenant; job: MarketingJob; context: CreativeContext; format: 'markdown' | 'plain'; detection?: CreativeDetection; changes?: string[] }): Promise<FollowUpResult> {
  const brief = job.brief;
  if (isAmbiguous(brief)) return { reply: subjectQuestion(brief, context, detection, { format }), job, outcome: 'asked', showJob: false };
  const engine = await engineForJob(tenant.id, job);

  if (engine === 'runway') {
    // the premium path: the cost first, then a yes
    return { reply: creativeModeReply(detection, context, { format, brief, jobSaved: true, changes, costNote: runwayWarning(brief) }), job, outcome: changes ? 'adjusted' : 'asked', showJob: false };
  }
  const { chosen, next } = await confirmAndStart(tenant, job, 'animated');
  const reply = creativeModeReply(detection, context, { format, brief, jobSaved: true, changes, selection: chosen.selection, closing: next.closing ?? (chosen.failed ? 'I couldn’t check your photos just now, so I haven’t started. Say “go ahead” to try again.' : undefined) });
  return { reply, job: next.started ? { ...chosen.job, status: 'generating' } : chosen.job, outcome: next.started ? 'started' : 'asked', showJob: next.started };
}

export async function handleModeFollowUp({ tenant, message, format, complete }: { tenant: Tenant; message: string; format: 'markdown' | 'plain'; complete: Complete }): Promise<FollowUpResult | null> {
  const kind = classifyFollowUp(message);
  if (kind === 'new_request') return null;
  const mayAnswer = kind === 'other' && message.trim().split(/\s+/).length <= 12 && !message.includes('?'); // a short reply could be the answer to "what is it about?"
  if (kind === 'other' && !mayAnswer) return null;
  const active = await latestActiveJob(tenant.id);
  if (!active) return null;

  // Pilot asked what the video is about: whatever they say next is the answer (unless they are asking something else)
  if (active.status === 'brief_ready' && isAmbiguous(active.brief) && !(kind === 'confirm')) {
    const combined = `${active.userMessage.replace(/[.\s]+$/, '')}. It should be about: ${message}`;
    const [context, extracted] = await Promise.all([loadCreativeContext(tenant.id), extractBrief({ message: combined, detection: NOTICED, businessName: tenant.businessName, businessType: tenant.businessType, complete })]);
    const brief: CreativeBrief = { ...extracted.brief, iteration_of: active.id };
    let job: MarketingJob | null = null;
    try { job = await createMarketingJob(tenant.id, { userMessage: combined, brief }); } catch (error) { console.error('marketing job could not be saved', error instanceof Error ? error.name : 'unknown'); }
    if (!job) return null;
    console.info(JSON.stringify({ event: 'marketing-creative-mode.subject-answered', tenantId: tenant.id, jobId: job.id, briefSource: extracted.source }));
    return proceedWithBrief({ tenant, job, context, format });
  }
  if (kind === 'other') return null;

  if (kind === 'confirm') {
    if (active.status === 'generating') return { reply: 'I’m already making this video. It will show up here as soon as it’s ready.', job: active, outcome: 'already_confirmed', showJob: true };
    if (active.status === 'ready') return { reply: 'This video is already made. It’s shown here, and it’s saved in your Marketing Library.', job: active, outcome: 'already_confirmed', showJob: true };
    if (isAmbiguous(active.brief)) { const context = await loadCreativeContext(tenant.id); return { reply: subjectQuestion(active.brief, context, NOTICED, { format }), job: active, outcome: 'asked', showJob: false }; }
    const engine = await engineForJob(tenant.id, active);
    if (active.status === 'confirmed' || active.status === 'failed') {
      // confirmed again: show the saved selection (or make it, if the job was confirmed before selection existed), and make the video if it has not been made
      const chosen = active.selection ? { job: active, selection: active.selection, failed: false } : await selectForJob(tenant, active);
      const next = chosen.failed ? { started: false } as { closing?: string; started: boolean } : await startIfPossible(tenant, chosen.job, engine);
      return { reply: confirmedReply(active.brief, { format, already: active.status === 'confirmed', selection: chosen.selection, selectionFailed: chosen.failed, closing: next.closing }), job: next.started ? { ...chosen.job, status: 'generating' } : chosen.job, outcome: 'already_confirmed', showJob: next.started };
    }
    const { chosen, next } = await confirmAndStart(tenant, active, engine);
    return { reply: confirmedReply(chosen.job.brief, { format, selection: chosen.selection, selectionFailed: chosen.failed, closing: next.closing }), job: next.started ? { ...chosen.job, status: 'generating' } : chosen.job, outcome: 'confirmed', showJob: next.started };
  }

  // a change
  const [context, merged] = await Promise.all([
    loadCreativeContext(tenant.id),
    mergeBrief({ previous: active.brief, previousJobId: active.id, message, businessName: tenant.businessName, businessType: tenant.businessType, complete }),
  ]);
  let job: MarketingJob | null = null;
  try { job = await createMarketingJob(tenant.id, { userMessage: message, brief: merged.brief }); } catch (error) { console.error('marketing job could not be saved', error instanceof Error ? error.name : 'unknown'); }
  console.info(JSON.stringify({ event: 'marketing-creative-mode.adjusted', tenantId: tenant.id, jobId: job?.id ?? null, iterationOf: active.id, briefSource: merged.source }));
  const changes = describeChanges(active.brief, merged.brief);

  if (!job) {
    return { reply: creativeModeReply(NOTICED, context, { format, brief: merged.brief, jobSaved: false, changes }), job: { id: '', status: 'brief_ready', userMessage: message, brief: merged.brief, selection: null, storyboard: null, result: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, outcome: 'adjusted', showJob: false };
  }

  // The video is already made: work out how little has to be redone. A free video is always changed for free, straight away. A Runway video
  // changes for free when the change needs no new footage; otherwise the cost is shown and Pilot waits for a yes.
  if (active.status === 'ready' && active.storyboard && active.result?.video_url) {
    const earlierEngine = engineOf(active) ?? 'runway';
    const engine = engineFor({ message, style: merged.brief.style, earlier: earlierEngine });
    const switched = engine !== earlierEngine;
    const plan = planIteration({ previousBrief: active.brief, storyboard: active.storyboard, nextBrief: merged.brief, message, engine: switched ? 'runway' : engine });
    const planLines = switched
      ? (engine === 'animated' ? ['I’ll make the whole video again as a free animated video. That’s free: no credits.'] : [runwayWarning(merged.brief)])
      : describePlan(plan, active.storyboard, engine);
    console.info(JSON.stringify({ event: 'marketing-creative-mode.iteration-planned', tenantId: tenant.id, jobId: job.id, iterationOf: active.id, engine, switched, kind: plan.kind, creditSeconds: switched ? -1 : plan.creditSeconds }));
    const free = engine === 'animated' || (!switched && plan.kind !== 'full' && plan.creditSeconds === 0);
    if (free && engineAvailable(engine)) {
      const confirmed = (await confirmMarketingJob(tenant.id, job.id)) ?? { ...job, status: 'confirmed' as const };
      if (active.selection) await saveJobSelection(tenant.id, job.id, active.selection);
      const ready = active.selection ? { ...confirmed, selection: active.selection } : (await selectForJob(tenant, confirmed)).job;
      const result = await startVideoGeneration({ tenant, job: ready }).catch((error) => { console.error('video change could not be started', error instanceof Error ? error.name : 'unknown'); return { started: false }; });
      if (result.started) return { reply: `Absolutely. ${planLines.join(' ')} I’m working on it now, and it will show here as soon as it’s ready.`, job: { ...ready, status: 'generating' }, outcome: 'adjusted', showJob: true };
    }
    return { reply: creativeModeReply(NOTICED, context, { format, brief: merged.brief, jobSaved: true, changes, planLines, closing: 'I haven’t made anything yet. Say yes and I’ll go ahead, or tell me what else to change.' }), job, outcome: 'adjusted', showJob: false };
  }

  // before the first video is made: the same decision as for a new request
  return proceedWithBrief({ tenant, job, context, format, changes });
}
