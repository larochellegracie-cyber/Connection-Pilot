import { platformSpecs, type ContentItem, type PlatformId } from '@/lib/marketing-content.js';
import { understand, type Medium } from '@/lib/marketing-request.js';
import { generateIdeas, generatePiece, type Idea } from './generate.js';
import { describeFacts, extractWebsiteFacts, saveWebsiteFacts, websiteUrlIn } from './website-knowledge.js';
import { describeImport, importWebsiteImages } from './website-images.js';
import { FirecrawlNotConfiguredError, MarketingRetrievalError } from './firecrawl-retrieval.js';
import { aiComplete, cachedIdeas, loadMarketingInput, saveIdeas, type Tenant } from './service.js';
import { createStandardVideo, NeedsBusinessInformation } from './standard-video/orchestrate.js';
import { choosePostImage, createPostImage, pictureFailure } from './image.js';
import { createContent } from './store.js';
import { enterCreativeMode } from './creative-mode.js';
import { createFromReferenceImage, refineLatestDesign, type Deps as DesignDeps } from './reference-image/create.js';
import { loadReferenceImage } from './reference-image/index.js';
import { latestActiveJob } from './marketing-jobs.js';
import { handleModeFollowUp } from './creative-followup.js';
import { creativeModePausesGeneration } from './creative-mode-config.js';
import { detectCreativeRequest, type CreativeDetection, type CreativeFormat } from '@/lib/marketing-creative-mode.js';

export type PilotReply =
  | { kind: 'ideas'; message: string; ideas: Idea[] }
  | { kind: 'created'; what: Medium; message: string; item: ContentItem; render?: { started: boolean; taskId?: string }; awaitingConfirmation?: boolean; usage?: { calls: number; inputTokens: number; outputTokens: number } }
  | { kind: 'plan_week'; message: string }
  /** A Marketing Job whose video is being made (or is made): the page follows it and shows the video and caption. */
  | { kind: 'job'; message: string; jobId: string }
  | { kind: 'message'; message: string };

const label = (platform: PlatformId) => platformSpecs[platform].label;

// AI video is made as one short clip of 2 to 10 seconds. With no length asked for, a 5-second clip keeps it quick and light.
const MIN_CLIP = 2; const MAX_CLIP = 10; const DEFAULT_CLIP = 5;
const wantedSeconds = (message: string) => Number(message.match(/\b(\d{1,2})\s*-?\s*(?:seconds?|secs?|s)\b/i)?.[1] ?? 0);
/** Makes the video plan match the clip that will really be made, so the plan never promises more than the video delivers. */
function fitClip<T extends { durationSeconds: number; scenes: Array<{ seconds: number }> }>(video: T, message: string): T {
  const seconds = Math.min(MAX_CLIP, Math.max(MIN_CLIP, wantedSeconds(message) || DEFAULT_CLIP));
  const total = video.scenes.reduce((sum, scene) => sum + scene.seconds, 0) || 1;
  return { ...video, durationSeconds: seconds, scenes: video.scenes.map((scene) => ({ ...scene, seconds: Math.max(1, Math.round((scene.seconds / total) * seconds * 10) / 10) })) };
}

/**
 * The owner talks to Pilot in plain words; this works out what they want and makes it with the existing systems.
 * - ideas: one AI call using the business, its activity and what was already posted
 * - a post: the existing post writer
 * - a video: Standard Video (drawn on our own server, no per-video fee). This path can never reach Runway.
 * - an AI video: only when the owner asks for realistic or generated footage. Pilot prepares the plan and waits for a yes.
 * - an AI picture: only when the owner explicitly asks for an AI-generated picture. Ordinary posts never call an image service.
 * A post's visual is the owner's own photo (with branded text and motion), or a branded animated graphic.
 * Nothing is approved, scheduled or posted.
 */
const designDeps = (tenant: Tenant): DesignDeps => ({ complete: aiComplete, loadInput: async () => { const { input, hasRealData } = await loadMarketingInput(tenant); if (!hasRealData) throw new NeedsBusinessInformation(); return input; } });
const asCreated = (created: { item: ContentItem; message: string }): PilotReply => ({ kind: 'created', what: 'post', item: created.item, message: created.message });

export async function handlePilotMessage(tenant: Tenant, message: string, options: { ideaId?: string; referenceId?: string; referenceImageId?: string } = {}): Promise<PilotReply> {
  // a reference image was attached: a new picture with its design (layout, tone, type, spacing) and this business's own words, photos and logo
  if (options.referenceImageId) {
    const analysis = await loadReferenceImage(tenant.id, options.referenceImageId);
    if (!analysis) return { kind: 'message', message: 'I can’t find that reference image any more. Please attach it again.' };
    return asCreated(await createFromReferenceImage({ tenant, message, analysis, deps: designDeps(tenant) }));
  }
  // a change to the picture just made from a reference ("make the text bigger", "use our actual cake photo"); a newer video job takes priority
  if (!options.ideaId && !options.referenceId) {
    const newest = await latestActiveJob(tenant.id, 180).catch(() => null);
    const changed = await refineLatestDesign({ tenant, message, deps: designDeps(tenant), newerThan: newest?.updatedAt ?? null });
    if (changed) return asCreated(changed);
  }
  // a reference video was attached: a new video in its style, for this business (free, never Runway)
  if (options.referenceId) return enterMode(tenant, message, 'video', null, options.referenceId);
  // A website address (or "learn from my website <address>"): read it with Firecrawl and save what it finds for the owner to review.
  const website = !options.ideaId ? websiteUrlIn(message) : null;
  if (website) return learnWebsite(tenant, website);
  // The conversation stays in Marketing Creative Mode: "yes" confirms the brief that was just shown, and "make it darker" revises it.
  // The job being discussed is this business's newest one from the last couple of hours (this page only ever talks about marketing).
  if (creativeModePausesGeneration && !options.ideaId) {
    const followUp = await handleModeFollowUp({ tenant, message, format: 'plain', complete: aiComplete });
    if (followUp) return followUp.showJob ? { kind: 'job', message: followUp.reply, jobId: followUp.job.id } : { kind: 'message', message: followUp.reply };
  }
  // tapping an idea card names the exact idea, so there is no guessing which number was meant
  // a video idea goes into Creative Mode (free animation, starts at once); a post idea is made straight away by the normal path below
  if (options.ideaId && creativeModePausesGeneration) {
    const idea = (await cachedIdeas(tenant))?.ideas.find((candidate) => candidate.id === options.ideaId);
    if (idea?.format === 'video') return enterMode(tenant, message, 'video', idea.platform ?? null);
  }
  if (options.ideaId) {
    const idea = (await cachedIdeas(tenant))?.ideas.find((candidate) => candidate.id === options.ideaId);
    if (!idea) return { kind: 'message', message: 'That idea has expired. Ask me for new ideas and I’ll show some.' };
    const wantedNow = understand(message, tenant.businessName);
    return make(tenant, wantedNow.medium ?? (idea.format === 'video' ? 'video' : 'post'), wantedNow.platform ?? idea.platform, { topic: idea.title, idea, message });
  }
  const wanted = understand(message, tenant.businessName);

  // Marketing Creative Mode: anything that would make content (a post, video, AI video or picture, or "make #3") first loads this
  // business's profile and full list of media and confirms the request. Nothing is made while generation is paused.
  // Videos go through Creative Mode: the brief is read, the free animated video starts at once (Runway only on request, after its cost is shown).
  // A post (or a picture the owner asked for) is made straight away: the words and a visual, no brief step and no questions.
  if (creativeModePausesGeneration && (wanted.action === 'make_idea' || wanted.action === 'create')) {
    const idea = wanted.action === 'make_idea' ? (await cachedIdeas(tenant))?.ideas[(wanted.ideaNumber ?? 0) - 1] : undefined;
    const medium = wanted.medium ?? (idea ? (idea.format === 'video' ? 'video' : 'post') : null);
    if (medium === null || medium === 'video' || medium === 'ai_video') return enterMode(tenant, message, medium, wanted.platform ?? idea?.platform ?? null);
  }

  if (wanted.action === 'clarify') return { kind: 'message', message: 'I can make posts, videos and ideas for your business. What would you like me to make?' };

  if (wanted.action === 'plan_week') return { kind: 'plan_week', message: 'Planning your week.' };

  if (wanted.action === 'ideas') {
    const { input, hasRealData } = await loadMarketingInput(tenant, { refreshTrends: false, research: true });
    if (!hasRealData) throw new NeedsBusinessInformation();
    const ideas = await generateIdeas(input, aiComplete);
    await saveIdeas(tenant, ideas);
    return { kind: 'ideas', ideas, message: 'Here are some ideas. Tap one, or tell me which number to make.' };
  }

  if (wanted.action === 'make_idea') {
    const saved = await cachedIdeas(tenant);
    const idea = saved?.ideas[(wanted.ideaNumber ?? 0) - 1];
    if (!idea) return { kind: 'message', message: saved ? `I only have ${saved.ideas.length} ideas. Pick a number from the list.` : 'I don’t have a list of ideas yet. Ask me for ideas and I’ll show some.' };
    const medium: Medium = wanted.medium ?? (idea.format === 'video' ? 'video' : 'post');
    return make(tenant, medium, wanted.platform ?? idea.platform, { topic: idea.title, idea, message });
  }

  return make(tenant, wanted.medium ?? 'post', wanted.platform, { topic: wanted.topic, message, when: wanted.when });
}

async function make(tenant: Tenant, medium: Medium, platform: PlatformId | null, { topic, idea, message, when }: { topic: string; idea?: Idea; message: string; when?: string | null }): Promise<PilotReply> {
  // Standard Video: planned from the request and the business, drawn on our own server
  if (medium === 'video') {
    const chosen = platform ?? undefined;
    const request = idea ? `Make a ${chosen ?? idea.platform} video: ${idea.title}. ${idea.why}`.slice(0, 600) : message.slice(0, 600);
    const result = await createStandardVideo(tenant, { request, platform: chosen, startRender: true });
    const item = result.item;
    return { kind: 'created', what: 'video', item, render: { started: result.render.started, taskId: result.render.taskId }, usage: result.usage, message: result.render.started ? `Making your ${label(item.platform)} video now.` : `Here’s the plan for your ${label(item.platform)} video.` };
  }

  // a post, or the plan for an AI video: both start from the existing writer
  const { input, hasRealData } = await loadMarketingInput(tenant);
  if (!hasRealData) throw new NeedsBusinessInformation();
  const target: PlatformId = platform ?? 'instagram';
  const vague = !topic;
  const timing = when ? ` It will be posted ${when}, so make it suit that time.` : '';
  const subject = (topic || `The best thing for ${tenant.businessName} to promote ${when ?? 'right now'}. Choose it yourself from what you know about the business, the season and what has already been posted.`) + (topic ? timing : '');
  const piece = await generatePiece({ kind: medium === 'post' || medium === 'ai_image' ? 'post' : 'video', platform: target, topic: subject, goal: idea?.goal || undefined, cta: idea?.cta || undefined, why: idea?.why }, input, aiComplete);
  if (vague) piece.topic = piece.hook.slice(0, 120); else piece.topic = topic.slice(0, 200);
  if (medium === 'ai_video' && piece.video) piece.video = { ...fitClip(piece.video, message), mode: 'ai' };
  // a post is a complete piece: the words and a visual. The owner's own photo is used when one suits; otherwise Pilot makes a
  // branded animated graphic (never a realistic AI picture unless the owner explicitly asked for one). If no visual can be had, the post is still kept.
  const { imagePrompt, ...words } = piece;
  let image = null; let pictureFailed = false;
  if (medium === 'ai_image') {
    try { image = await createPostImage({ tenantId: tenant.id, brief: input.brief, platform: target, topic: words.topic, scene: topic || imagePrompt || words.suggestedVisual, hook: words.hook, explicit: true }); } catch (error) { pictureFailed = true; console.error('post picture failed', pictureFailure(error)); }
  } else if (medium === 'post') {
    try { image = await choosePostImage({ tenantId: tenant.id, brief: input.brief, topic: words.topic, hook: words.hook, cta: words.cta, complete: aiComplete, designed: { codePost: true, message, facts: { services: input.brief.services, sellingPoints: input.brief.sellingPoints } } }); } catch (error) { pictureFailed = true; console.error('post picture failed', pictureFailure(error)); }
  }
  const item = await createContent(tenant.id, { ...words, image, evidence: idea?.evidence.length ? idea.evidence : piece.evidence, status: 'draft', scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null });
  if (medium === 'ai_video') return { kind: 'created', what: 'ai_video', item, awaitingConfirmation: true, message: `Here’s the plan for your ${item.video?.durationSeconds}-second ${label(item.platform)} video with realistic AI footage.${wantedSeconds(message) > MAX_CLIP ? ` AI clips can be up to ${MAX_CLIP} seconds, so this one is ${MAX_CLIP}.` : ''} Shall I make it?` };
  if (medium === 'ai_image') return { kind: 'created', what: 'post', item, message: pictureFailed ? `Here’s your ${label(item.platform)} post. I couldn’t make the AI picture just now. You can ask me to try again.` : `Here’s your ${label(item.platform)} post with the AI-generated picture you asked for. It is an AI picture, not a photo of your real work.` };
  return { kind: 'created', what: 'post', item, message: pictureFailed ? `Here’s your ${label(item.platform)} post. I couldn’t make the picture just now. You can ask me to try again.` : `Here’s your ${label(item.platform)} post.` };
}

const formatFor: Record<Medium, CreativeFormat> = { post: 'social_post', video: 'video', ai_video: 'video', ai_image: 'graphic' };

/** Enters Marketing Creative Mode: reads the brief, saves the Marketing Job, and confirms with the owner. Makes nothing. */
async function enterMode(tenant: Tenant, message: string, medium: Medium | null, platform: PlatformId | null, referenceId?: string): Promise<PilotReply> {
  const seen = detectCreativeRequest(message);
  const detection: CreativeDetection = seen.isCreative ? seen : { isCreative: true, formats: [formatFor[medium ?? 'post']], platform, matched: [] };
  const { reply, job, showJob } = await enterCreativeMode({ tenant, message, detection, format: 'plain', complete: aiComplete, ...(referenceId ? { referenceId } : {}) });
  return showJob && job ? { kind: 'job', message: reply, jobId: job.id } : { kind: 'message', message: reply };
}


/** Reads the owner's website, saves the facts to the profile as "review required", and says what was found. Nothing is used by Pilot until the owner confirms it. */
async function learnWebsite(tenant: Tenant, address: string): Promise<PilotReply> {
  try {
    const facts = await extractWebsiteFacts(address);
    const result = await saveWebsiteFacts(tenant.id, facts);
    const photos = describeImport(await importWebsiteImages({ tenantId: tenant.id, candidates: facts.imageCandidates, businessName: tenant.businessName }));
    const found = describeFacts(facts).join('\n');
    const notes = [photos, ...facts.warnings].filter(Boolean).length ? `\n\n${[photos, ...facts.warnings].filter(Boolean).join(' ')}` : '';
    if (!result.saved) return { kind: 'message', message: `I read ${facts.website} and found:\n${found}\n\nYour Business information is already confirmed, so I haven’t changed it. If you want any of this in it, edit it in Business information and confirm it again.${notes}` };
    return { kind: 'message', message: `I read ${facts.website} and saved what I found for you to review:\n${found}\n\nOpen Business information to check it and confirm. Once you confirm, I’ll use it in chat, posts, videos and captions, and your logo and colours go into your brand.${notes}` };
  } catch (error) {
    if (error instanceof FirecrawlNotConfiguredError || error instanceof MarketingRetrievalError) return { kind: 'message', message: error.publicMessage };
    return { kind: 'message', message: 'I couldn’t read that website just now. Please try again, or upload your business information instead.' };
  }
}
