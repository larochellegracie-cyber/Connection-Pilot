import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { pickLogo } from '../standard-video/business-assets.js';
import type { MediaStorage } from '../standard-video/storage.js';
import type { BrandKit } from '../standard-video/templates.js';
import { cleanPalette, conceptPalette, conceptPlan, type Concept } from './concept.js';
import { codeVideoMode, wantsCreative, wantsPolish } from './choose.js';
import type { Complete, CompleteWithImages } from './generate.js';
import { renderCodeVideo, type CodeVideoResult } from './index.js';

const run = promisify(execFile);

/**
 * A complex post drawn as code. The same sandboxed Python + Pillow path as a custom video writes ONE finished composition (the business's own or generated photograph as
 * the main visual, with the type, light, grade and layout drawn around it), it is rendered as a short silent clip, and its settled last frame is the post's picture.
 * Only for a styled, creative or reference-based request; a plain post keeps the designed-post engine, which is also the way back when this cannot be made.
 */
export const wantsCodePost = (message: string, hasReference = false) => codeVideoMode() !== 'off' && codeVideoMode() !== 'request' && (hasReference || wantsPolish(message) || wantsCreative(message));

export type CodePostResult = { ok: true; bytes: Buffer; script: string; score?: number } | { ok: false; reason: string };

export async function renderCodePost({ tenantId, message, subject, hook, cta, kit, photo, logoId, storage, workDir, complete, completeWithImages, render = renderCodeVideo }: { tenantId: string; message: string; subject: string; hook: string; cta: string; kit: BrandKit; /** the main visual: a real or generated photograph of the subject */ photo: { id: string; label: string } | null; logoId?: string | null; storage: MediaStorage; workDir: string; complete: Complete; completeWithImages?: CompleteWithImages; render?: typeof renderCodeVideo }): Promise<CodePostResult> {
  try {
    const ffmpeg = ffmpegPath(); if (!ffmpeg) return { ok: false, reason: 'FFmpeg is not available.' };
    const palette = cleanPalette(null, `${message} ${subject}`);
    const seconds = 4;
    const concept: Concept = { title: subject.slice(0, 80), mood: '', palette, seconds, scenes: [{ role: 'hook', seconds, headline: hook.slice(0, 44), subtext: cta.slice(0, 70), items: [], visual: `one finished, poster-quality composition about ${subject}: the photograph large and cropped with intent, the headline set with strong hierarchy, a light/grade treatment and a small brand sign-off. It settles by the end and holds.`, photoId: photo?.id ?? null }] };
    const base = conceptPlan(concept, kit, photo ? [photo] : []);
    const plan = { ...base, spec: { ...base.spec, size: '1080x1080' as const }, summary: { ...base.summary, size: '1080x1080' as const } };
    const dir = path.join(workDir, 'post'); await mkdir(dir, { recursive: true });
    const clip = path.join(dir, 'post.mp4');
    const made: CodeVideoResult = await render({ tenantId, plan, kit, logoId: logoId !== undefined ? logoId : pickLogo(await storage.listAssets(tenantId), kit.logoUrl), storage, workDir: dir, outPath: clip, complete, ...(completeWithImages ? { completeWithImages } : {}), style: 'custom', look: photo ? 'photo' : 'motion', subject, palette: conceptPalette(concept), ...(photo ? { heroPhoto: photo } : {}) });
    if (!made.ok) return { ok: false, reason: made.reason };
    const still = path.join(dir, 'post.jpg');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, made.seconds - 0.4)), '-i', clip, '-frames:v', '1', '-q:v', '2', still], { timeout: 60_000 });
    const bytes = await readFile(still);
    if (bytes.length < 8_000) return { ok: false, reason: 'The picture was not created.' };
    return { ok: true, bytes, script: made.script, ...(made.score !== undefined ? { score: made.score } : {}) };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : 'The post could not be drawn.' }; }
  finally { await rm(path.join(workDir, 'post', 'preview'), { recursive: true, force: true }).catch(() => undefined); }
}
