import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import type { DesignBlueprint } from '../reference/design.js';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import type { MediaStorage } from '../standard-video/storage.js';
import type { BrandKit } from '../standard-video/templates.js';
import { conceptPlan, type Concept } from './concept.js';
import { buildCodeBrief, exportAssets, type CodeVideoResult } from './index.js';
import { codeVideoSupport, runSandboxed } from './sandbox.js';

/**
 * A product advert built straight from a reference video's design blueprint. Where the model-written custom code may or may not follow the reference's
 * layout, this builds each scene from the blueprint's numbers (where the hero sits and how big, the camera move, where the headline sits and how big,
 * when the words appear, the transition) with the scene library's product_scene, in the reference's colours, with the business's own words, logo and
 * hero (a ready-made prop, or the business's own photo). The same checks and sandbox as any code-drawn video; nothing is written by a model here
 * except the words (the concept).
 */
const q = (value: string) => JSON.stringify(value);
const n = (v: number) => Math.round(v * 1000) / 1000;
const textAt = (timing: string) => (/\b(?:start|begin|early|first|opening)\w*/i.test(timing) ? 0.1 : /\b(?:late|end|last|final)\w*/i.test(timing) ? 0.55 : /\bmid\w*/i.test(timing) ? 0.38 : 0.22);

export function buildProductScript(concept: Concept, design: DesignBlueprint, hero: string): string {
  const last = concept.scenes.length - 1;
  const lines = concept.scenes.map((scene, i) => {
    const spec = design.motion.scenes[Math.min(i === last ? design.motion.scenes.length - 1 : i, design.motion.scenes.length - 1)];
    const closing = i === last; const k0 = closing ? 1 : i / Math.max(1, last); const k1 = closing ? 1 : (i + 1) / Math.max(1, last);
    const head = spec.headline; const place = spec.product;
    const horizon = design.visual.horizon !== null && design.visual.horizon !== undefined ? `, horizon=${n(design.visual.horizon)}` : '';
    return `    video.product_scene(${q(scene.headline)}, ${q(scene.subtext)}, ${q(hero)}, ${n(scene.seconds)}, placement=${q(place?.placement ?? 'low_center')}, size=${q(place?.size ?? 'large')}, camera=${q(spec.camera)}, head_pos=${q(head?.position ?? 'upper third')}, head_size=${q(head?.size ?? 'l')}, align=${q(head?.align ?? 'left')}, text_at=${n(textAt(spec.textTiming))}${horizon}, k0=${n(k0)}, k1=${n(k1)}, transition=${q(['fade', 'push', 'zoom', 'wipe', 'iris'].includes(scene.transition ?? spec.transition) ? (scene.transition ?? spec.transition) : 'fade')}${closing ? `, closing=True, sign_line=${q(scene.subtext)}` : ''})`;
  });
  return `def build(video):\n${lines.join('\n')}\n`;
}

export type ProductAdInput = { /** a different script for the same inputs (for example the photo-led advert); the reference design is not needed for it */ script?: (concept: Concept, hero: string) => string; tenantId: string; concept: Concept; design?: DesignBlueprint; kit: BrandKit; logoId: string | null; storage: MediaStorage; workDir: string; outPath: string; palette: Record<string, string | boolean>; /** "prop:<kind>" or the id of the business's own photo (which must be one of the concept's photos) */ hero: string; photos: Array<{ id: string; label: string }> };

export async function renderProductAd(input: ProductAdInput): Promise<CodeVideoResult> {
  try {
    const support = await codeVideoSupport();
    if (!support.ok || !support.python || !support.sandbox) return { ok: false, reason: support.reason };
    const ffmpeg = ffmpegPath(); if (!ffmpeg) return { ok: false, reason: 'FFmpeg is not available.' };
    const dir = path.join(input.workDir, 'product'); await mkdir(dir, { recursive: true });
    // a photo hero is offered to the scenes as p1
    const concept: Concept = input.hero.startsWith('prop:') ? input.concept : { ...input.concept, scenes: input.concept.scenes.map((scene, i) => ({ ...scene, photoId: i === 0 ? input.hero : scene.photoId })) };
    const plan = conceptPlan(concept, input.kit, input.photos);
    if (!input.hero.startsWith('prop:') && !plan.summary.photosUsed.some((photo) => photo.id === input.hero)) plan.summary.photosUsed.unshift({ id: input.hero, label: input.photos.find((photo) => photo.id === input.hero)?.label ?? 'photo' });
    const { assets, photos } = await exportAssets({ tenantId: input.tenantId, plan, logoId: input.logoId, kit: input.kit, storage: input.storage, dir });
    const fontDir = path.join(path.dirname(nodeModule.createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
    const brief = buildCodeBrief({ plan, kit: input.kit, assets, photos, fontDir, ffmpeg, out: input.outPath });
    brief.palette = { ...brief.palette, ...input.palette }; brief.budget_seconds = 440;
    const hero = input.hero.startsWith('prop:') ? input.hero : (assets.p1 ? 'p1' : '');
    if (!hero) return { ok: false, reason: 'The product photo could not be loaded.' };
    const briefPath = path.join(dir, 'brief.json'); await writeFile(briefPath, JSON.stringify(brief));
    if (!input.script && !input.design) return { ok: false, reason: 'No design was given for the product advert.' };
    const script = input.script ? input.script(concept, hero) : buildProductScript(concept, input.design!, hero); const scriptPath = path.join(dir, 'scene_script.py'); await writeFile(scriptPath, script);
    const args = { python: support.python, sandbox: support.sandbox, jobDir: input.workDir, briefPath, scriptPath, fontDir, ffmpegPath: ffmpeg };
    let checked = await runSandboxed({ ...args, checkOnly: true, timeoutMs: 120_000 }); if (!checked.ok && checked.timedOut) checked = await runSandboxed({ ...args, checkOnly: true, timeoutMs: 120_000 });
    if (!checked.ok) return { ok: false, reason: checked.errors[0] ?? 'The product advert failed its safety check.', script };
    let drawn = await runSandboxed({ ...args, timeoutMs: 1_800_000 });
    if (!drawn.ok && /stopped without a result/i.test(drawn.errors[0] ?? '')) drawn = await runSandboxed({ ...args, timeoutMs: 1_800_000 });
    if (!drawn.ok) return { ok: false, reason: drawn.errors[0] ?? 'The product advert could not be drawn.', script };
    if (!(await stat(input.outPath).then((file) => file.size > 10_000).catch(() => false))) return { ok: false, reason: 'The product advert file was not created.', script };
    return { ok: true, script, scriptSha: createHash('sha256').update(script).digest('hex').slice(0, 16), seconds: drawn.seconds ?? concept.seconds, usage: { calls: 0, inputTokens: 0, outputTokens: 0 } };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : 'The product advert could not be made.' }; }
}
