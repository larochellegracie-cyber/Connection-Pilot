import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/client.js';
import { marketingJob } from '@/server/db/schema.js';
import { cleanSelection, type AssetSelection } from './asset-selection.js';
import { parseBrief, type CreativeBrief } from './creative-brief.js';
import type { Storyboard } from './storyboard.js';
import type { VideoEngine } from './video-engine.js';

/**
 * Marketing Jobs: one row per Marketing request. It keeps the owner's own words and the structured brief Pilot understood, and
 * where the job stands (brief_ready: waiting for the owner to confirm; confirmed: the owner said the brief is right; generating: the
 * video is being made; ready: it is made; failed: it could not be made). A change the
 * owner asks for becomes a NEW job whose brief points back at the one it revises (iteration_of). It holds no generated media. Every query is scoped to one business, so a business can only ever see and
 * change its own jobs. Stored in the `marketing_job` table.
 */
export const jobStatuses = ['brief_ready', 'confirmed', 'generating', 'ready', 'failed'] as const;
export type JobStatus = (typeof jobStatuses)[number];

/** How a finished (or failed) generation ended. On success it holds the video's link and the caption; on failure, a plain reason. */
export type JobResult = { /** set when no photo of the owner's fitted and Pilot generated artwork for the video (its label in Photos) */ generated_visual?: string; generated_kind?: 'ai-image' | 'artwork'; /** how a free video was drawn */ renderer?: 'code' | 'template' | 'explainer'; /** the voice on an explainer */ voiceover?: 'openai' | 'system' | 'none'; /** set when the owner attached a reference video: 'followed' (its style and structure were copied) or 'fallback' (it could not be followed, so an ordinary free video was made) */ /** set when the video was made from a reference video: what text of the reference was detected, whether any of it showed up in the new video's text or script before the final check, how it was revised, and whether the final check passed */ reference_check?: { detected: { brands: string[]; words: string[]; phrases: string[] }; found_first: number; regenerated: number; redacted: boolean; found_final: number; passed: boolean }; /** set when Pilot wrote its own drawing code for a request the templates did not suit: 'invented' (it drew the scenes itself) or 'fell_back' (it could not, so the scene library or standard video was used) */ code?: 'invented' | 'fell_back'; code_note?: string; reference?: 'followed' | 'fallback'; /** why a reference could not be followed (plain words, for the owner or support) */ reference_note?: string; video_url: string | null; caption: string; hashtags: string[]; cta: string; total_seconds: number; scene_count: number; provider: string; estimated_credits: number | null; /** The background music added to the video (its style and feel), or null when the video has no music. */ music: string | null; /** How it was made: "animated" is Pilot's own free animation, "runway" is the premium AI footage. */ engine: VideoEngine; library_item_id: string | null; error: string | null; finished_at: string };

export type MarketingJob = { id: string; status: JobStatus; userMessage: string; brief: CreativeBrief; /** Which of the business's own media fit the brief. Set when the job is confirmed; null before that. */ selection: AssetSelection | null; /** The scene plan, set when generation starts. */ storyboard: Storyboard | null; /** The finished video, or why it failed. Set when generation ends. */ result: JobResult | null; createdAt: string; updatedAt: string };

type Row = { id: string; status: string; userMessage: string; briefJson: string; selectionJson?: string | null; storyboardJson?: string | null; resultJson?: string | null; createdAt: Date | string | null; updatedAt: Date | string | null };
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : new Date(0).toISOString());

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Text whose line breaks matter (a caption: hook, body and call to action on separate lines). Spaces are tidied; the breaks are kept. */
const multiline = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const cleanReferenceCheck = (value: unknown): JobResult['reference_check'] => { const v = (value && typeof value === 'object' ? value : null) as Record<string, any> | null; if (!v || typeof v.passed !== 'boolean') return undefined; const list = (x: unknown) => (Array.isArray(x) ? x : []).filter((item): item is string => typeof item === 'string').slice(0, 30).map((item) => item.slice(0, 120)); return { detected: { brands: list(v.detected?.brands), words: list(v.detected?.words), phrases: list(v.detected?.phrases) }, found_first: Number(v.found_first) || 0, regenerated: Number(v.regenerated) || 0, redacted: v.redacted === true, found_final: Number(v.found_final) || 0, passed: v.passed }; };
/** A result read back from storage: only a secure link or one of this app's own video addresses is accepted as the video. */
export function cleanResult(value: unknown): JobResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const link = typeof v.video_url === 'string' && (/^https:\/\/\S+$/.test(v.video_url) || /^\/api\/marketing\/media\/videos\/[A-Za-z0-9-]{8,64}\.mp4$/.test(v.video_url)) ? v.video_url : null;
  return {
    video_url: link, caption: multiline(v.caption, 2600), hashtags: (Array.isArray(v.hashtags) ? v.hashtags : []).filter((tag): tag is string => typeof tag === 'string').slice(0, 12).map((tag) => text(tag, 60)),
    cta: text(v.cta, 240), total_seconds: Number.isFinite(Number(v.total_seconds)) ? Number(v.total_seconds) : 0, scene_count: Number.isFinite(Number(v.scene_count)) ? Number(v.scene_count) : 0, provider: text(v.provider, 40),
    estimated_credits: Number.isFinite(Number(v.estimated_credits)) && v.estimated_credits !== null ? Number(v.estimated_credits) : null, library_item_id: typeof v.library_item_id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v.library_item_id) ? v.library_item_id : null,
    music: text(v.music, 200) || null, engine: v.engine === 'animated' ? 'animated' : 'runway', renderer: v.renderer === 'code' ? 'code' : v.renderer === 'template' ? 'template' : v.renderer === 'explainer' ? 'explainer' : undefined, reference_check: cleanReferenceCheck(v.reference_check), code: v.code === 'invented' ? 'invented' : v.code === 'fell_back' ? 'fell_back' : undefined, code_note: text(v.code_note, 200) || undefined, reference: v.reference === 'followed' ? 'followed' : v.reference === 'fallback' ? 'fallback' : undefined, reference_note: text(v.reference_note, 200) || undefined, voiceover: v.voiceover === 'openai' ? 'openai' : v.voiceover === 'system' ? 'system' : v.voiceover === 'none' ? 'none' : undefined, generated_visual: text(v.generated_visual, 200) || undefined, generated_kind: v.generated_kind === 'ai-image' ? 'ai-image' : v.generated_kind === 'artwork' ? 'artwork' : undefined, error: text(v.error, 400) || null, finished_at: text(v.finished_at, 40),
  };
}

function toJob(row: Row): MarketingJob | null {
  let brief: CreativeBrief | null = null;
  try { brief = parseBrief(JSON.parse(row.briefJson)); } catch { /* an unreadable brief means the job is skipped, not guessed at */ }
  if (!brief) return null;
  let selection: AssetSelection | null = null;
  try { selection = row.selectionJson ? cleanSelection(JSON.parse(row.selectionJson)) : null; } catch { /* an unreadable selection is treated as not made yet */ }
  let storyboard: Storyboard | null = null;
  try { const parsed = row.storyboardJson ? JSON.parse(row.storyboardJson) : null; storyboard = parsed && Array.isArray(parsed.scenes) && parsed.scenes.length <= 6 ? parsed as Storyboard : null; } catch { /* treated as not planned */ }
  let result: JobResult | null = null;
  try { result = row.resultJson ? cleanResult(JSON.parse(row.resultJson)) : null; } catch { /* treated as no result */ }
  return { id: row.id, status: (jobStatuses as readonly string[]).includes(row.status) ? row.status as JobStatus : 'brief_ready', userMessage: row.userMessage, brief, selection, storyboard, result, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

/** Saves a new job with status "brief_ready": the request is understood and nothing has been made. */
export async function createMarketingJob(tenantId: string, { userMessage, brief }: { userMessage: string; brief: CreativeBrief }): Promise<MarketingJob> {
  const id = randomUUID();
  const clean = parseBrief(brief);
  if (!clean) throw new Error('A job needs a valid brief.');
  const now = new Date().toISOString();
  await db.insert(marketingJob).values({ id, businessProfileId: tenantId, status: 'brief_ready', userMessage: userMessage.slice(0, 4000), briefJson: JSON.stringify(clean) });
  return { id, status: 'brief_ready', userMessage: userMessage.slice(0, 4000), brief: clean, selection: null, storyboard: null, result: null, createdAt: now, updatedAt: now };
}

export async function getMarketingJob(tenantId: string, id: string): Promise<MarketingJob | null> {
  const [row] = await db.select().from(marketingJob).where(and(eq(marketingJob.id, id), eq(marketingJob.businessProfileId, tenantId))).limit(1);
  return row ? toJob(row) : null;
}

export async function listMarketingJobs(tenantId: string, limit = 50): Promise<MarketingJob[]> {
  const rows = await db.select().from(marketingJob).where(eq(marketingJob.businessProfileId, tenantId)).orderBy(desc(marketingJob.createdAt)).limit(Math.min(200, Math.max(1, limit)));
  return rows.map(toJob).filter((job): job is MarketingJob => job !== null);
}

/** Marks a job confirmed: the owner said the brief is right. Nothing is generated by this. Returns the job as it now stands. */
export async function confirmMarketingJob(tenantId: string, id: string): Promise<MarketingJob | null> {
  await db.update(marketingJob).set({ status: 'confirmed' }).where(and(eq(marketingJob.id, id), eq(marketingJob.businessProfileId, tenantId)));
  return getMarketingJob(tenantId, id);
}

/**
 * The job the owner is probably still talking about: this business's newest job, if it was touched in the last couple of hours.
 * The time is compared inside the database, so it is not affected by the server's own time zone.
 */
export async function latestActiveJob(tenantId: string, windowMinutes = 120): Promise<MarketingJob | null> {
  const [row] = await db.select().from(marketingJob)
    .where(and(eq(marketingJob.businessProfileId, tenantId), gt(marketingJob.updatedAt, sql`(now() - interval ${sql.raw(String(Math.max(1, Math.trunc(windowMinutes))))} minute)`)))
    .orderBy(desc(marketingJob.createdAt)).limit(1);
  return row ? toJob(row) : null;
}

/** Saves which of the business's own media were chosen for this job. Only that column changes. */
export async function saveJobSelection(tenantId: string, id: string, selection: AssetSelection): Promise<void> {
  await db.update(marketingJob).set({ selectionJson: JSON.stringify(selection) }).where(and(eq(marketingJob.id, id), eq(marketingJob.businessProfileId, tenantId)));
}

/** Moves a job to "generating": the owner confirmed and the video is being made. Only the status changes. */
export async function markJobGenerating(tenantId: string, id: string): Promise<void> {
  await db.update(marketingJob).set({ status: 'generating', resultJson: null }).where(and(eq(marketingJob.id, id), eq(marketingJob.businessProfileId, tenantId)));
}

/** Saves the scene plan the video is being made from. */
export async function saveJobStoryboard(tenantId: string, id: string, storyboard: Storyboard): Promise<void> {
  await db.update(marketingJob).set({ storyboardJson: JSON.stringify(storyboard) }).where(and(eq(marketingJob.id, id), eq(marketingJob.businessProfileId, tenantId)));
}

/** Ends generation: "ready" with the finished video, or "failed" with a plain reason. */
export async function finishJob(tenantId: string, id: string, status: 'ready' | 'failed', result: JobResult): Promise<void> {
  await db.update(marketingJob).set({ status, resultJson: JSON.stringify(result) }).where(and(eq(marketingJob.id, id), eq(marketingJob.businessProfileId, tenantId)));
}
