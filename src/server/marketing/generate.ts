import { fitToPlatform, goals, platformSpecs, platforms, stripUnsupportedClaims, type ContentItem, type ContentKind, type Evidence, type PlatformId, type VideoConcept } from '@/lib/marketing-content.js';
import type { BusinessBrief } from './store.js';
import type { Signal } from './signals.js';
import type { Trend } from './trends.js';
import { parseJson } from './trends.js';

export type Complete = (system: string, prompt: string) => Promise<string>;

export type Insight = { title: string; recommendation: string };
export type MarketingInput = { brief: BusinessBrief; signals: Signal[]; trends: Trend[]; insights: Insight[]; existing: ContentItem[]; now: Date; timezone: string };
export type PieceRequest = { kind: ContentKind; platform: PlatformId; topic: string; tone?: string; goal?: string; cta?: string; why?: string; evidenceIds?: string[] };
export type Piece = Omit<ContentItem, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'scheduledFor' | 'approvedAt' | 'publishedAt' | 'campaign' | 'image'> & { /** For a post: the scene Pilot describes for its picture. Not saved on the item itself. */ imagePrompt?: string };
export type Idea = { id: string; title: string; why: string; format: 'post' | 'video' | 'either'; platform: PlatformId; hook: string; cta: string; goal: string; evidence: Evidence[] };

export class GenerationError extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage); this.name = 'GenerationError'; }
}

const RULES = `You are Pilot Marketing, writing for ONE specific small business. Be specific to this business, never generic.
Honesty rules (strict):
- Use only facts in the business brief and the evidence you are given. Never invent services, prices, offers, discounts, locations, customer names, testimonials, reviews, awards, statistics, or years in business.
- Never call anything "trending" or "viral", never promise results ("guaranteed", "will get you more customers"), and never claim a post will perform well.
- Never suggest or describe fake before/after images or misleading visuals. Suggest only visuals the business can really shoot or already has.
- If a detail you would need (a price, an offer, a date) is not in the brief, leave it out instead of making it up.
- Write like the business's own voice, in plain language, with its real service names and place. Avoid stock marketing phrases.`;

const money = (value: string) => value.replace(/\s+/g, ' ').trim();

export function briefText(input: MarketingInput): string {
  const { brief } = input;
  const lines = [
    `Business: ${brief.businessName || 'unnamed'}${brief.businessType ? ` (${brief.businessType})` : ''}`,
    brief.location && `Location: ${brief.location}`,
    brief.description && `About: ${money(brief.description)}`,
    brief.services.length && `Services/products: ${brief.services.join('; ')}`,
    brief.pricing && `Pricing information: ${money(brief.pricing).slice(0, 500)}`,
    brief.targetCustomers && `Target customers: ${money(brief.targetCustomers)}`,
    brief.sellingPoints.length && `Selling points: ${brief.sellingPoints.join('; ')}`,
    brief.promotions && `Current promotions: ${money(brief.promotions)}`,
    brief.hours && `Hours: ${money(brief.hours).slice(0, 200)}`,
    brief.brandVoice.tone && `Brand voice: ${brief.brandVoice.tone}${brief.brandVoice.description ? ` — ${money(brief.brandVoice.description)}` : ''}`,
    brief.learned.length && `Business knowledge Pilot has learned:\n- ${brief.learned.join('\n- ')}`,
    brief.websiteNotes.length && `From the business website:\n${brief.websiteNotes.join('\n')}`,
    brief.setupAnswers.length && `What the owner said at setup:\n- ${brief.setupAnswers.join('\n- ')}`,
  ].filter(Boolean);
  return lines.join('\n');
}

export function evidenceMenu(input: MarketingInput): string {
  const rows = [
    ...input.signals.map((signal) => `${signal.id} [${signal.kind}] ${signal.label}. ${signal.detail}`),
    ...input.trends.map((trend) => `${trend.id} [current trend, ${trend.confidence} confidence, as of ${trend.asOf}] ${trend.statement}`),
    ...input.insights.slice(0, 5).map((insight, index) => `i${index + 1} [business insight] ${insight.title}. ${insight.recommendation}`),
  ];
  return rows.length ? rows.join('\n') : 'No signals available.';
}

/** Turns evidence ids chosen by the model into evidence Pilot can stand behind. Unknown ids are dropped. */
export function resolveEvidence(ids: unknown, input: MarketingInput): Evidence[] {
  const out: Evidence[] = [];
  for (const raw of Array.isArray(ids) ? ids.slice(0, 6) : []) {
    const id = String(raw);
    const signal = input.signals.find((candidate) => candidate.id === id);
    if (signal) { out.push({ label: signal.label, source: signal.kind === 'season' || signal.kind === 'holiday' ? 'season' : 'insight', detail: signal.detail, asOf: signal.asOf }); continue; }
    const trend = input.trends.find((candidate) => candidate.id === id);
    if (trend) { out.push({ label: 'Current trend', source: 'trend', detail: trend.statement, url: trend.sources[0]?.url, asOf: trend.asOf, confidence: trend.confidence }); continue; }
    const insight = /^i(\d+)$/.exec(id) ? input.insights[Number(id.slice(1)) - 1] : undefined;
    if (insight) out.push({ label: 'Pilot insight', source: 'insight', detail: `${insight.title}. ${insight.recommendation}` });
  }
  return out;
}

const businessEvidence = (brief: BusinessBrief): Evidence => ({ label: 'About your business', source: 'business', detail: brief.services.length ? `Your services include ${brief.services.slice(0, 4).join(', ')}.` : brief.description.slice(0, 200) || `You run a ${brief.businessType || 'local'} business.` });

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+\n/g, '\n').trim().slice(0, max) : '');
const isPlatform = (value: unknown): value is PlatformId => (platforms as readonly string[]).includes(value as string);

function cleanVideo(raw: unknown): VideoConcept {
  const video = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const scenes = (Array.isArray(video.scenes) ? video.scenes : []).slice(0, 10).map((scene: Record<string, unknown>) => ({ seconds: Math.max(1, Math.min(30, Math.round(Number(scene?.seconds) || 3))), visual: stripUnsupportedClaims(text(scene?.visual, 400)), onScreenText: stripUnsupportedClaims(text(scene?.onScreenText, 100)), ...(text(scene?.voiceover, 300) && { voiceover: stripUnsupportedClaims(text(scene?.voiceover, 300)) }) })).filter((scene: { visual: string; onScreenText: string }) => scene.visual || scene.onScreenText);
  if (scenes.length < 2) throw new GenerationError('Pilot could not put together a usable video plan. Please try again.');
  const total = scenes.reduce((sum: number, scene: { seconds: number }) => sum + scene.seconds, 0);
  return { durationSeconds: Math.max(5, Math.min(90, Math.round(Number(video.durationSeconds) || total))), scenes, transitions: text(video.transitions, 300), audioDirection: text(video.audioDirection, 300), render: { status: 'not_generated' } };
}

/** Checks one piece of generated content, applies platform limits, and removes promises Pilot cannot keep. */
export function finalizePiece(raw: Record<string, any>, request: PieceRequest, input: MarketingInput, evidence: Evidence[]): Piece {
  const hook = stripUnsupportedClaims(text(raw.hook, 300));
  const rawCaption = stripUnsupportedClaims(text(raw.caption, 5000));
  const cta = stripUnsupportedClaims(text(raw.cta, 200));
  if (!hook || !rawCaption || !cta) throw new GenerationError('Pilot could not finish that piece of content. Please try again.');
  const hashtags = (Array.isArray(raw.hashtags) ? raw.hashtags : []).filter((tag: unknown): tag is string => typeof tag === 'string');
  const fitted = fitToPlatform(request.platform, { caption: rawCaption, hashtags });
  return {
    kind: request.kind, platform: request.platform, hook, caption: fitted.caption, cta, hashtags: fitted.hashtags,
    suggestedVisual: stripUnsupportedClaims(text(raw.suggestedVisual, 500)), postingFormat: text(raw.postingFormat, 160) || (request.kind === 'video' ? platformSpecs[request.platform].videoFormat : `${platformSpecs[request.platform].label} post`),
    topic: request.topic.slice(0, 200), goal: request.goal ?? '', tone: request.tone || input.brief.brandVoice.tone || '', why: text(request.why ?? raw.why, 600),
    evidence: evidence.length ? evidence : [businessEvidence(input.brief)], video: request.kind === 'video' ? cleanVideo(raw.video) : null,
    ...(request.kind === 'post' && text(raw.imagePrompt, 600) ? { imagePrompt: stripUnsupportedClaims(text(raw.imagePrompt, 600)) } : {}),
  };
}

const PIECE_SHAPE = `{"hook":"first line / first 2 seconds","caption":"full caption","cta":"one clear call to action","hashtags":["tag"],"suggestedVisual":"what to show, using only what the business can really film or photograph","postingFormat":"e.g. Reel / carousel / single photo","imagePrompt":"POSTS ONLY: one or two vivid sentences describing the single picture to go with the post (subject, setting, light, mood), for an image generator. Only things this business really does or places it really serves. No text or words in the picture, no people at all, no before-and-after, no results or claims.","video":{"durationSeconds":15,"scenes":[{"seconds":3,"visual":"","onScreenText":"","voiceover":""}],"transitions":"","audioDirection":""}}`;

function pieceInstructions(request: PieceRequest, input: MarketingInput) {
  const spec = platformSpecs[request.platform];
  const voice = request.tone || input.brief.brandVoice.tone || 'natural and friendly';
  return `Create ${request.kind === 'video' ? `a short-form VIDEO plan (${spec.videoFormat})` : `a ${spec.label} POST`}.\nTopic: ${request.topic}\nGoal: ${request.goal || 'choose the most useful goal for this business'}\nVoice: ${voice}\nCall to action: ${request.cta || 'write a clear one using the real next step for this business (for example booking or calling)'}\nPlatform style: ${spec.style}\nCaption limit: ${spec.captionMax} characters; at most ${spec.hashtagMax} hashtags.\n${request.kind === 'video' ? 'Include the "video" object with 3–7 scenes. Each scene has on-screen text of at most 8 words.' : 'Leave "video" out.'}`;
}

export async function generatePiece(request: PieceRequest, input: MarketingInput, complete: Complete): Promise<Piece> {
  const prompt = `BUSINESS BRIEF\n${briefText(input)}\n\nEVIDENCE AVAILABLE (ids you may cite)\n${evidenceMenu(input)}\n\n${pieceInstructions(request, input)}\n\nRespond with JSON only, in this shape:\n${PIECE_SHAPE}`;
  const raw = parseJson(await complete(RULES, prompt));
  if (!Object.keys(raw).length) throw new GenerationError('Pilot could not write that just now. Please try again.');
  return finalizePiece(raw, request, input, resolveEvidence(request.evidenceIds, input));
}

export async function generateIdeas(input: MarketingInput, complete: Complete): Promise<Idea[]> {
  const prompt = `BUSINESS BRIEF\n${briefText(input)}\n\nEVIDENCE AVAILABLE (ids you may cite)\n${evidenceMenu(input)}\n\nRecent content already created (avoid repeating):\n${input.existing.slice(0, 10).map((item) => `- ${item.topic || item.hook}`).join('\n') || 'none'}\n\nSuggest 4–6 content ideas for this business. Each idea must be grounded in at least one evidence id from the list or in the business brief. Explain WHY in one or two sentences that only state facts from the brief or the evidence.\nRespond with JSON only: {"ideas":[{"title":"","why":"","format":"post|video|either","platform":"instagram|facebook|tiktok|linkedin","hook":"","cta":"","goal":"one of: ${goals.join(' | ')}","evidenceIds":["id"]}]}`;
  const raw = parseJson(await complete(RULES, prompt));
  const ideas: Idea[] = [];
  for (const entry of Array.isArray(raw.ideas) ? raw.ideas.slice(0, 8) : []) {
    const title = stripUnsupportedClaims(text(entry?.title, 140)); const why = stripUnsupportedClaims(text(entry?.why, 400));
    if (!title || !why) continue;
    const evidence = resolveEvidence(entry?.evidenceIds, input);
    ideas.push({ id: `idea-${ideas.length + 1}`, title, why, format: entry?.format === 'video' ? 'video' : entry?.format === 'post' ? 'post' : 'either', platform: isPlatform(entry?.platform) ? entry.platform : 'instagram', hook: stripUnsupportedClaims(text(entry?.hook, 200)), cta: stripUnsupportedClaims(text(entry?.cta, 160)), goal: (goals as readonly string[]).includes(entry?.goal) ? entry.goal : 'Promote a service', evidence: evidence.length ? evidence : [businessEvidence(input.brief)] });
    if (ideas.length === 6) break;
  }
  if (!ideas.length) throw new GenerationError('Pilot could not come up with grounded ideas just now. Please try again.');
  return ideas;
}

export type PlannedPiece = Piece & { date: string };

export async function generatePlan(input: MarketingInput, complete: Complete, days = 7): Promise<PlannedPiece[]> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(input.now);
  const recent = input.existing.filter((item) => item.createdAt >= new Date(input.now.getTime() - 14 * 86_400_000).toISOString()).length;
  const prompt = `BUSINESS BRIEF\n${briefText(input)}\n\nEVIDENCE AVAILABLE (ids you may cite)\n${evidenceMenu(input)}\n\nContent already created: ${input.existing.length} pieces in total, ${recent} in the last 14 days. Recent topics:\n${input.existing.slice(0, 10).map((item) => `- ${item.topic || item.hook}`).join('\n') || 'none'}\n\nToday is ${today}. Plan content for the next ${days} days (3–5 pieces, a realistic pace for a small business, not every day). Choose the weekdays and the mix of posts and short videos that suit THIS business, and explain WHY for each in one or two sentences that only state facts from the brief or the evidence. Every piece must cite at least one evidence id or the brief.\n${platforms.map((platform) => `${platformSpecs[platform].label}: ${platformSpecs[platform].style} Caption limit ${platformSpecs[platform].captionMax}; at most ${platformSpecs[platform].hashtagMax} hashtags.`).join('\n')}\nRespond with JSON only: {"items":[{"date":"YYYY-MM-DD","kind":"post|video","platform":"instagram|facebook|tiktok|linkedin","topic":"","goal":"one of: ${goals.join(' | ')}","why":"","evidenceIds":["id"],"hook":"","caption":"","cta":"","hashtags":[],"suggestedVisual":"","postingFormat":"","video":{"durationSeconds":15,"scenes":[{"seconds":3,"visual":"","onScreenText":""}],"transitions":"","audioDirection":""}}]}\nInclude "video" only for kind "video".`;
  const raw = parseJson(await complete(RULES, prompt));
  const last = new Date(`${today}T12:00:00Z`); last.setUTCDate(last.getUTCDate() + days + 1);
  const planned: PlannedPiece[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items.slice(0, 7) : []) {
    const date = typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : '';
    if (!date || date < today || date > last.toISOString().slice(0, 10)) continue;
    const kind: ContentKind = entry?.kind === 'video' ? 'video' : 'post';
    const platform: PlatformId = isPlatform(entry?.platform) ? entry.platform : 'instagram';
    try {
      const piece = finalizePiece(entry, { kind, platform, topic: text(entry?.topic, 200) || text(entry?.hook, 120), goal: (goals as readonly string[]).includes(entry?.goal) ? entry.goal : undefined, why: text(entry?.why, 600) }, input, resolveEvidence(entry?.evidenceIds, input));
      planned.push({ ...piece, date });
    } catch { /* a piece that is not complete is left out of the plan */ }
  }
  if (!planned.length) throw new GenerationError('Pilot could not put together a plan just now. Please try again.');
  return planned.sort((a, b) => a.date.localeCompare(b.date));
}
