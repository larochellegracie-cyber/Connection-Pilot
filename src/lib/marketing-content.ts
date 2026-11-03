/**
 * The shape of a piece of marketing content (a post or a video concept) and how it is kept in the existing
 * marketing_generated_post table: its own columns hold the copy, and one JSON envelope in `hashtags_json`
 * holds everything else. Nothing here publishes anything.
 */
export const platforms = ['instagram', 'facebook', 'tiktok', 'linkedin'] as const;
export type PlatformId = (typeof platforms)[number];
export const contentStatuses = ['proposed', 'draft', 'approved', 'scheduled', 'published'] as const;
export type ContentStatus = (typeof contentStatuses)[number];
export type ContentKind = 'post' | 'video';

export const platformSpecs: Record<PlatformId, { label: string; captionMax: number; hashtagMax: number; style: string; videoFormat: string }> = {
  instagram: { label: 'Instagram', captionMax: 2200, hashtagMax: 12, style: 'Visual-first. A strong first line (it is cut off after about 125 characters), short paragraphs, a few relevant hashtags at the end.', videoFormat: 'Reel, vertical 9:16, 15–30 seconds' },
  facebook: { label: 'Facebook', captionMax: 2000, hashtagMax: 3, style: 'Conversational and local. A clear first sentence, one idea, a direct call to action. Very few hashtags.', videoFormat: 'Vertical or square video, 15–45 seconds' },
  tiktok: { label: 'TikTok', captionMax: 2200, hashtagMax: 5, style: 'Very short caption that supports the video. The hook lives in the first seconds on screen. A few hashtags.', videoFormat: 'Vertical 9:16, 15–30 seconds, hook in the first 2 seconds' },
  linkedin: { label: 'LinkedIn', captionMax: 3000, hashtagMax: 4, style: 'Professional but human. A clear opening line, short paragraphs, practical value, a soft call to action. Few hashtags.', videoFormat: 'Landscape or square video, 30–60 seconds' },
};

export const goals = ['Get more bookings', 'Promote a service', 'Showcase a recent job', 'Educate customers', 'Build trust', 'Promote a special', 'Seasonal content', 'Engagement'] as const;
export const tones = ['Professional', 'Friendly', 'Funny', 'Luxury', 'Straightforward', 'Local/community-focused'] as const;

export type Evidence = { label: string; source: 'insight' | 'season' | 'trend' | 'business'; detail: string; url?: string; asOf?: string; confidence?: 'high' | 'medium' | 'low' };
export type VideoMode = 'standard' | 'ai';
export const videoModes: readonly VideoMode[] = ['standard', 'ai'];
/** Standard videos are made on this app's own servers and served from here. */
export const ownVideoLink = /^\/api\/marketing\/media\/videos\/[A-Za-z0-9-]{8,64}\.mp4$/;
/** A finished video's link is only accepted if it is a secure link or one of this app's own video addresses. */
export const isUsableVideoLink = (url: unknown): url is string => typeof url === 'string' && (/^https:\/\/\S+$/.test(url) || ownVideoLink.test(url));
export type VideoScene = { seconds: number; visual: string; onScreenText: string; voiceover?: string };
export type VideoConcept = {
  /** standard = designed motion graphics rendered here (no per-video fee). ai = realistic AI footage from a provider (Runway). Defaults to standard. */
  mode?: VideoMode;
  /** The Standard Video scene plan Pilot designed for this video. It is what gets rendered; the scenes below describe it. */
  plan?: Record<string, unknown>;
  durationSeconds: number;
  scenes: VideoScene[];
  transitions: string;
  audioDirection: string;
  /** A video only counts as made when a real file exists. */
  render: { status: 'not_generated' | 'processing' | 'ready'; url?: string; provider?: string; /** The provider's task, while the video is being made. */ taskId?: string };
};

/**
 * The picture on a post: one of the business's own uploaded photos (`source: 'photo'`, preferred), or one Pilot made when no
 * photo suited (`source: 'generated'`, where `prompt` is the scene described to the image maker).
 */
export type PostImage = { url: string; prompt: string; source?: 'photo' | 'graphic' | 'generated'; /** A short silent animated version (an MP4 in the business's own storage) of the same visual. The still `url` is always kept. */ motion?: string };
export const ownMotionLink = /^\/api\/marketing\/media\/videos\/[A-Za-z0-9][A-Za-z0-9_-]{5,63}\.mp4$/;
export const ownPhotoLink = /^\/api\/marketing\/assets\/[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/;
export const ownImageLink = /^\/api\/marketing\/media\/images\/[A-Za-z0-9][A-Za-z0-9_-]{5,63}\.jpg$/;

export type ContentItem = {
  id: string;
  kind: ContentKind;
  platform: PlatformId;
  status: ContentStatus;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  suggestedVisual: string;
  postingFormat: string;
  topic: string;
  goal: string;
  tone: string;
  /** Why Pilot suggested it, and what that rests on. */
  why: string;
  evidence: Evidence[];
  /** YYYY-MM-DD in the business time zone. */
  scheduledFor: string | null;
  /** HH:MM in the business time zone. Optional: content can be planned for a day without a time. */
  scheduledTime?: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  campaign: string | null;
  video: VideoConcept | null;
  /** The picture Pilot made for a post. Absent when there is none: a post never claims a picture it does not have. */
  image?: PostImage | null;
  createdAt: string;
  updatedAt: string;
};

type Row = { id: string; hook: string; caption: string; callToAction: string; suggestedVisual: string; platform: string; hashtagsJson: string; planItemId: string | null; createdAt: Date | string | null; updatedAt: Date | string | null };
type Envelope = { v: 1; kind: ContentKind; status: ContentStatus; hashtags: string[]; postingFormat: string; topic: string; goal: string; tone: string; why: string; evidence: Evidence[]; scheduledFor: string | null; scheduledTime?: string | null; approvedAt: string | null; publishedAt: string | null; video: VideoConcept | null; image?: PostImage | null };

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : new Date(0).toISOString());
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
export const isTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());

export function cleanVideoConcept(value: unknown): VideoConcept | null {
  if (!value || typeof value !== 'object') return null;
  const video = value as Record<string, any>;
  const scenes: VideoScene[] = (Array.isArray(video.scenes) ? video.scenes : []).slice(0, 12).map((scene: Record<string, unknown>) => ({ seconds: Math.max(1, Math.min(60, Math.round(Number(scene?.seconds) || 3))), visual: text(scene?.visual, 400), onScreenText: text(scene?.onScreenText, 120), ...(text(scene?.voiceover, 300) && { voiceover: text(scene?.voiceover, 300) }) })).filter((scene: VideoScene) => scene.visual || scene.onScreenText);
  const render = video.render && typeof video.render === 'object' ? video.render as Record<string, unknown> : {};
  const ready = render.status === 'ready' && typeof render.url === 'string' && (/^https:\/\/\S+$/.test(render.url) || ownVideoLink.test(render.url));
  const processing = render.status === 'processing' && /^[\w-]{6,80}$/.test(text(render.taskId, 80)) && text(render.provider, 60);
  return { durationSeconds: Math.max(5, Math.min(90, Math.round(Number(video.durationSeconds) || scenes.reduce((sum, scene) => sum + scene.seconds, 0) || 15))), scenes, mode: video.mode === 'ai' ? 'ai' : 'standard', ...(video.plan && typeof video.plan === 'object' && !Array.isArray(video.plan) && JSON.stringify(video.plan).length < 60_000 ? { plan: video.plan as Record<string, unknown> } : {}), transitions: text(video.transitions, 400), audioDirection: text(video.audioDirection, 400), render: ready ? { status: 'ready', url: render.url as string, ...(text(render.provider, 60) && { provider: text(render.provider, 60) }) } : processing ? { status: 'processing', taskId: text(render.taskId, 80), provider: text(render.provider, 60) } : { status: 'not_generated' } };
}

export function cleanImage(value: unknown): PostImage | null {
  const image = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (!image || typeof image.url !== 'string') return null;
  const motion = typeof image.motion === 'string' && ownMotionLink.test(image.motion) ? { motion: image.motion } : {};
  if (ownPhotoLink.test(image.url)) return { url: image.url, prompt: text(image.prompt, 800), source: 'photo', ...motion };
  return ownImageLink.test(image.url) ? { url: image.url, prompt: text(image.prompt, 800), source: image.source === 'graphic' ? 'graphic' : 'generated', ...motion } : null;
}

export function rowToItem(row: Row): ContentItem {
  let envelope: Partial<Envelope> = {};
  try { const parsed = JSON.parse(row.hashtagsJson); envelope = Array.isArray(parsed) ? { hashtags: parsed.filter((tag): tag is string => typeof tag === 'string') } : parsed && typeof parsed === 'object' ? parsed : {}; } catch { /* an unreadable envelope still leaves the copy */ }
  const kind: ContentKind = envelope.kind === 'video' ? 'video' : 'post';
  return {
    id: row.id, kind,
    platform: (platforms as readonly string[]).includes(row.platform) ? row.platform as PlatformId : 'instagram',
    status: (contentStatuses as readonly string[]).includes(envelope.status as string) ? envelope.status as ContentStatus : 'draft',
    hook: row.hook, caption: row.caption, cta: row.callToAction, hashtags: (envelope.hashtags ?? []).slice(0, 30), suggestedVisual: row.suggestedVisual,
    postingFormat: text(envelope.postingFormat, 200), topic: text(envelope.topic, 200), goal: text(envelope.goal, 80), tone: text(envelope.tone, 80), why: text(envelope.why, 1000),
    evidence: Array.isArray(envelope.evidence) ? envelope.evidence.slice(0, 8) : [],
    scheduledFor: isDay(envelope.scheduledFor) ? envelope.scheduledFor : null,
    scheduledTime: isDay(envelope.scheduledFor) && isTime(envelope.scheduledTime) ? envelope.scheduledTime : null,
    approvedAt: envelope.approvedAt ?? null, publishedAt: envelope.publishedAt ?? null, campaign: row.planItemId,
    video: kind === 'video' ? cleanVideoConcept(envelope.video) : null,
    image: kind === 'post' ? cleanImage(envelope.image) : null,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  };
}

export function itemToRow(item: ContentItem): { hook: string; caption: string; callToAction: string; suggestedVisual: string; platform: string; hashtagsJson: string; planItemId: string | null } {
  const envelope: Envelope = { v: 1, kind: item.kind, status: item.status, hashtags: item.hashtags, postingFormat: item.postingFormat, topic: item.topic, goal: item.goal, tone: item.tone, why: item.why, evidence: item.evidence, scheduledFor: item.scheduledFor, scheduledTime: item.scheduledFor && isTime(item.scheduledTime) ? item.scheduledTime : null, approvedAt: item.approvedAt, publishedAt: item.publishedAt, video: item.video, image: item.kind === 'post' ? cleanImage(item.image) : null };
  return { hook: item.hook || '—', caption: item.caption || '—', callToAction: item.cta || '—', suggestedVisual: item.suggestedVisual || '—', platform: item.platform, hashtagsJson: JSON.stringify(envelope), planItemId: item.campaign ? item.campaign.slice(0, 80) : null };
}

/** Wording that promises results Pilot cannot know. It is removed rather than published. */
const unsupported = /(?:\b(?:go(?:es|ing)?|will\s+go|going)\s+viral\b|\bviral\b|\bguarantee[ds]?\b|\b(?:100|one hundred)\s*%\s*(?:success|results|satisfaction)\b|\bwill\s+(?:get|bring|double|triple)\s+you\b|\b#1\s+(?:in|pool|company)\b|\bbest\s+in\s+(?:the\s+)?(?:city|town|world|country)\b)/i;
export function findUnsupportedClaims(value: string): string[] {
  return value.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => unsupported.test(sentence)).map((sentence) => sentence.trim());
}
export function stripUnsupportedClaims(value: string): string {
  return value.split(/(?<=[.!?])\s+|(?<=\n)/).filter((sentence) => !unsupported.test(sentence)).join(' ').replace(/[ \t]+\n/g, '\n').trim();
}

/** Brings a piece of copy within a platform's limits without cutting a word or hashtag in half. */
export function fitToPlatform(platform: PlatformId, parts: { caption: string; hashtags: string[] }): { caption: string; hashtags: string[]; trimmed: boolean } {
  const spec = platformSpecs[platform];
  const hashtags = [...new Set(parts.hashtags.map((tag) => `#${tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((tag) => tag.length > 1))].slice(0, spec.hashtagMax);
  const tagLine = hashtags.join(' ');
  const room = Math.max(0, spec.captionMax - (tagLine ? tagLine.length + 2 : 0));
  let caption = parts.caption.trim();
  let trimmed = false;
  if (caption.length > room) { caption = `${caption.slice(0, room).replace(/\s+\S*$/, '').trim()}…`; trimmed = true; }
  return { caption, hashtags, trimmed };
}

export const statusLabels: Record<ContentStatus, string> = { proposed: 'Proposed', draft: 'Draft', approved: 'Approved', scheduled: 'Scheduled', published: 'Published' };

/** The moves an owner can make. Publishing is only ever recorded by the owner; nothing is posted for them. */
export const allowedMoves: Record<ContentStatus, ContentStatus[]> = {
  proposed: ['draft', 'approved'],
  draft: ['approved', 'proposed'],
  approved: ['scheduled', 'draft', 'published'],
  scheduled: ['approved', 'draft', 'published'],
  published: ['approved'],
};

export type ContentAction =
  | { type: 'approve' }
  | { type: 'schedule'; date: string; time?: string | null }
  | { type: 'move'; date: string | null; time?: string | null }
  | { type: 'mark_published' }
  | { type: 'back_to_draft' };

/**
 * The only ways content changes status. Approving means the owner reviewed it. "Mark as published" is the owner
 * telling Pilot they posted it themselves: Pilot never posts anything, so nothing here contacts any platform.
 */
export function applyAction(item: ContentItem, action: ContentAction, nowIso: string): { item: ContentItem } | { error: string } {
  const next: ContentItem = { ...item, updatedAt: nowIso };
  switch (action.type) {
    case 'approve':
      if (item.status === 'published') return { error: 'That content is already marked as published.' };
      next.status = item.scheduledFor ? 'scheduled' : 'approved'; next.approvedAt = nowIso; return { item: next };
    case 'schedule':
      if (!isDay(action.date)) return { error: 'Choose a valid date to schedule this for.' };
      if (item.status !== 'approved' && item.status !== 'scheduled') return { error: 'Approve this content before scheduling it.' };
      if (action.time && !isTime(action.time)) return { error: 'Choose a valid time.' };
      next.status = 'scheduled'; next.scheduledFor = action.date; next.scheduledTime = action.time || null; return { item: next };
    case 'move':
      if (action.date !== null && !isDay(action.date)) return { error: 'Choose a valid date.' };
      if (action.time && !isTime(action.time)) return { error: 'Choose a valid time.' };
      next.scheduledFor = action.date;
      if (action.date === null) next.scheduledTime = null; else if (action.time !== undefined) next.scheduledTime = action.time || null;
      if (item.status === 'scheduled' && action.date === null) next.status = 'approved';
      return { item: next };
    case 'mark_published':
      if (item.status !== 'approved' && item.status !== 'scheduled') return { error: 'Approve this content before marking it as published.' };
      next.status = 'published'; next.publishedAt = nowIso; return { item: next };
    case 'back_to_draft':
      next.status = 'draft'; next.approvedAt = null; next.publishedAt = null; return { item: next };
  }
}

/** Changing the words of reviewed content means it needs review again. */
export function needsReviewAfterEdit(status: ContentStatus): boolean { return status === 'approved' || status === 'scheduled' || status === 'published'; }
