import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fetchPublicImage } from '../standard-video/assets.js';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { sniffImage } from '../standard-video/images.js';
import { paletteFor } from '../standard-video/plan-layout.js';
import { sizes } from '../standard-video/spec.js';
import type { PlanResult } from '../standard-video/planner.js';
import type { MediaStorage } from '../standard-video/storage.js';
import type { BrandKit } from '../standard-video/templates.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile } from 'node:fs/promises';
import { findReferenceText, scriptStrings, type ReferenceText } from '../reference/protect.js';
import { creativeText, critique, fidelityText, type CreativeScore, type SceneFidelity, DIRECTIONS, INVENT_DIRECTION, CUSTOM_DIRECTION, MOTION_DIRECTION, STRATEGY_DIRECTION, repairScript, writeScript, type CodeBrief, type CodeStyle, type Complete, type CompleteWithImages, type Critique } from './generate.js';
import { codeVideoSupport, runSandboxed } from './sandbox.js';
import type { Shot } from './concept.js';
import { lookOf, type Strategy } from './strategy.js';
import { checkRenderedVideo } from './quality.js';

/**
 * Code-written video: Pilot's free animation, but the scene sequence is written as a small Python program by the model (choosing scene
 * types, photos, timing and transitions from Pilot's scene library) and drawn with Pillow + FFmpeg. It is free (the only cost is the one text
 * call to write the script), uses the business's own words, photos and brand colours, and runs in a sandbox. If anything about it fails,
 * the caller uses the standard renderer instead. See code-video/runtime for the trusted scene library and the safety checker.
 *
 * When it is used (PILOT_CODE_VIDEO): "request" (the default) only when the owner asks for a custom or code-written animation; "default" for every free
 * video; "off" never.
 */
const run = promisify(execFile);
const MAX_REPAIRS = 2; const MAX_REPAIRS_INVENT = 8;
export { codeVideoMode, wantsCodeVideo, chooseCodeVideo, wantsCreative, subjectFits, lookFor, wantsMotion, type CodeLook, type CodeVideoMode, type CodeChoice } from './choose.js';
import type { CodeLook } from './choose.js';
import { codeVideoMode, wantsCodeVideo } from './choose.js';

export const useCodeVideo = (message: string, forced = false) => { const mode = codeVideoMode(); return mode !== 'off' && (forced || mode === 'default' || wantsCodeVideo(message)); };

export type AssetFactsById = Record<string, { shows: string; kind: string; best_use: string; focus?: { x: number; y: number } }>;

export type CodeVideoResult = { ok: true; /** what happened round by round (repairs, reviews, renders), for the developer's logs */ trace?: string[]; script: string; scriptSha: string; seconds: number; usage: { calls: number; inputTokens: number; outputTokens: number }; /** the design review's score out of 10, when it was reviewed */ score?: number; candidates?: number; /** per scene, how closely the frames match the storyboard's shot (from the design review of the accepted script) and why not */ fidelity?: { overall?: number; scenes: SceneFidelity[] }; /** the creative rubric of the accepted script's design review (opening, platform, clarity, treatment, pacing, variety, typography, call to action, marketing quality, specificity, difference, ending) */ creative?: { overall?: number; scores: CreativeScore[] }; /** true when the accepted script's design review could not be read */ unreviewed?: boolean; /** the review of the FINISHED video's own frames (the one that decides acceptance) */ rendered_review?: { score: number; issues: string[] }; /** what each scene of the accepted script really contains (text, camera, crop, scrim, pictures), to read beside the storyboard */ measured?: unknown[]; /** the finished-video check: whether it passed, how many times the writer was sent back to revise, what is still weak, and what the revisions were for */ quality?: { passed: boolean; revisions: number; problems: string[]; revised_for?: string[] } } | { ok: false; reason: string; /** the script that was refused, for the developer's logs (never shown to the owner) */ script?: string; /** what happened round by round (checks, repairs, review scores), for the developer's logs */ trace?: string[]; usage?: { calls: number; inputTokens: number; outputTokens: number } };

const extFor = (bytes: Buffer) => ({ png: 'png', jpeg: 'jpg', webp: 'webp' } as const)[sniffImage(bytes) ?? 'png'];

/** Writes the business's pictures into the job folder under short names (p1, p2... and logo): the only files the script's program can open. */
export async function exportAssets({ tenantId, plan, logoId, kit, storage, dir, facts = {} }: { /** what looking at each picture found (by asset id), see asset-vision.ts */ facts?: AssetFactsById; tenantId: string; plan: PlanResult; logoId: string | null; kit: BrandKit; storage: MediaStorage; dir: string }): Promise<{ assets: Record<string, string>; photos: NonNullable<CodeBrief['photos']> }> {
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  const assets: Record<string, string> = {}; const photos: NonNullable<CodeBrief['photos']> = [];
  for (const [index, photo] of plan.summary.photosUsed.entries()) {
    try { const stored = await storage.openAsset(tenantId, photo.id); if (!stored) continue; const bytes = await stored.read(); if (!sniffImage(bytes)) continue; const file = path.join(dir, 'assets', `p${index + 1}.${extFor(bytes)}`); await writeFile(file, bytes); assets[`p${index + 1}`] = file; const meta = await storage.getAssetMeta(tenantId, photo.id).catch(() => null); photos.push({ name: `p${index + 1}`, label: photo.label.replace(/^From website [–-] /, ''), width: meta?.width ?? 0, height: meta?.height ?? 0, orientation: !meta ? 'landscape' : meta.width > meta.height * 1.15 ? 'landscape' : meta.height > meta.width * 1.15 ? 'portrait' : 'square', ...(facts[photo.id] ? { shows: facts[photo.id].shows, kind: facts[photo.id].kind, best_use: facts[photo.id].best_use, ...(facts[photo.id].focus ? { focus: facts[photo.id].focus } : {}) } : {}) }); } catch { /* that picture is simply not offered */ }
  }
  try {
    const bytes = logoId && logoId !== 'logo' ? await (await storage.openAsset(tenantId, logoId))?.read() : logoId === 'logo' && kit.logoUrl ? await fetchPublicImage(kit.logoUrl) : undefined;
    if (bytes && sniffImage(bytes)) { const file = path.join(dir, 'assets', `logo.${extFor(bytes)}`); await writeFile(file, bytes); assets.logo = file; }
  } catch { /* no logo: the business name is drawn instead */ }
  return { assets, photos };
}

/** A fully custom video draws every scene itself: calling any of the ready-made scene functions is a problem the model is asked to fix. */
export function usesReadyMade(script: string): string[] {
  const found = [...new Set([...script.matchAll(/\bvideo\.(hook_kinetic|feature_float|steps_timeline|statement_kinetic|cta_pro|cta|photo_hero|photo_frame|photo_split|statement|card_scene|explainer_\w+)\s*\(/g)].map((m) => m[1]))];
  return found.length ? [`This is a fully custom video: draw every scene yourself with video.add_scene and your own draw(c, t, u). Do not call ${found.map((name) => `video.${name}`).join(', ')}.`] : [];
}

/**
 * A custom photographed video must read as film, not slides: the photograph fills the frame under a moving camera, scenes are joined by the live transitions, and
 * the photo is never set in a floating rounded card. Each problem is sent back to the model to fix (see CINEMATIC MOTION in the runtime reference).
 */
export function cinematicProblems(script: string): string[] {
  const photoCalls = [...script.matchAll(/\bc\.photo\(([^)]*)\)/g)].map((m) => m[1]);
  const cards = photoCalls.filter((args) => /shape\s*=\s*["']round["']|shadow\s*=\s*[0-9.]+|radius\s*=\s*[1-9]/.test(args)).length;
  const cameras = (script.match(/\bc\.camera\(/g) ?? []).length; const scenes = (script.match(/\bvideo\.add_scene\(/g) ?? []).length;
  const live = new Set([...script.matchAll(/["'](whip|crosszoom|lightleak|slice)["']/g)].map((m) => m[1]));
  const moves = new Set([...script.matchAll(/\bc\.camera\([^)]*?["'](push|pull|pan_left|pan_right|tilt_up|tilt_down|orbit|handheld|drift)["']/g)].map((m) => m[1]));
  // mistakes seen in model-written scripts: a drawn illustration laid over the photograph, and a studio set that the full-frame camera then covers completely
  const scenesOf = script.split(/\bdef \w+\(c, t, u\):/).slice(1);
  const propOverPhoto = /\bc\.prop\(/.test(script);
  const studioCovered = scenesOf.some((block) => /\bc\.studio\(/.test(block) && /\bc\.camera\(/.test(block));
  return [
    ...(propOverPhoto ? [`Do not draw illustrations (c.prop) over the photograph: the photograph is the picture. Remove every c.prop call and use light (c.caustics, c.light_leak, c.dust) and camera moves instead.`] : []),
    ...(studioCovered ? [`c.studio() paints a whole set, which the full-frame c.camera then covers completely: remove c.studio() from any scene that uses c.camera.`] : []),
    ...(cards ? [`Do not set the photo in a rounded or shadowed card (c.photo with shape="round", radius or shadow): it looks like a slide. Fill the frame with c.camera("p1", u, "push", ...) and put the words on a c.fade scrim.`] : []),
    ...(scenes && cameras < Math.max(1, scenes - 1) ? [`Use c.camera for the photograph in every scene that shows one (a moving full-frame shot), not a still c.photo or c.backdrop.`] : []),
    ...(scenes >= 3 && live.size < 2 ? [`Join the scenes with at least two different live transitions ("whip", "crosszoom", "lightleak", "slice") as the third argument of video.add_scene, with transition_seconds 0.6 to 0.9, so the video flows.`] : []),
    ...(cameras >= 3 && moves.size < 3 ? [`Vary the camera: use at least three different moves (push, pull, orbit, handheld, pan_left, pan_right, tilt_up, tilt_down, drift), never the same one scene after scene.`] : []),
  ];
}

/**
 * A motion-graphics video is built from invented pieces, not photographs: the kit's cards, chips, fields, marks, counters and the like, moving all the time, with the scenes
 * joined by real transitions and no photo set in a floating card.
 */
export function motionProblems(script: string): string[] {
  const kit = new Set([...script.matchAll(/\bc\.(card|field|chip|swarm|counter|mesh|row|mark|badge|pill|button|cursor|silhouette)\(/g)].map((m) => m[1]));
  const scenes = (script.match(/\bvideo\.add_scene\(/g) ?? []).length;
  const joins = new Set([...script.matchAll(/["'](whip|crosszoom|lightleak|slice|push|zoom|wipe|iris)["']/g)].map((m) => m[1]));
  const cards = [...script.matchAll(/\bc\.photo\(([^)]*)\)/g)].filter((m) => /shape\s*=\s*["']round["']|shadow\s*=\s*[0-9.]+|radius\s*=\s*[1-9]/.test(m[1])).length;
  return [
    ...(kit.size < 3 ? [`This is a motion-graphics video: invent the visuals with the kit instead of photographs. Use at least three kinds of piece (c.swarm or c.chip, c.card with c.field or c.row, c.mark, c.counter, c.mesh, c.button with c.cursor, c.silhouette), animated with progress(t, start, duration).`] : []),
    ...(cards ? [`Do not set a photo in a rounded or shadowed card: a photograph is either full frame (c.camera) or not used.`] : []),
    ...(scenes >= 3 && joins.size < 2 ? [`Join the scenes with at least two different transitions ("whip", "crosszoom", "lightleak", "slice", "push", "zoom", "wipe", "iris") as the third argument of video.add_scene.`] : []),
  ];
}

/**
 * What a script must do to carry out its strategy's visual approach, and nothing about taste: a motion-graphics video is built from the kit, a picture-led one shows pictures with the camera,
 * a mixed one does both, a type-led one only has to use the typography it named. The older mandates (two live transitions, three camera moves, the picture in three scenes, no photo in a card)
 * do not apply: the storyboard names each scene's camera and transition and the frames are measured against it.
 */
export function strategyProblems(script: string, strategy: Strategy): string[] {
  const kit = new Set([...script.matchAll(/\bc\.(card|field|chip|swarm|counter|mesh|row|mark|badge|pill|button|cursor|silhouette)\(/g)].map((m) => m[1]));
  const pictures = (script.match(/\bc\.(?:camera|photo|backdrop)\(/g) ?? []).length;
  const scenesOf = script.split(/\bdef \w+\(c, t, u\):/).slice(1);
  const out: string[] = [];
  if (strategy.visual === 'graphic_led' && kit.size < 3) out.push('The strategy is graphic_led: invented graphics carry this video. Build the scenes from the motion-graphics kit (c.card with c.field or c.row, c.chip or c.swarm, c.mark, c.counter, c.mesh, c.button with c.cursor, c.silhouette): use at least three kinds of piece, animated with progress(t, start, duration).');
  if (strategy.visual === 'graphic_led' && pictures > 2) out.push('The strategy is graphic_led, but the script shows pictures in several places. At most one scene shows a picture; the others are graphics and type.');
  if (strategy.visual === 'photo_led' && pictures === 0) out.push('The strategy is photo_led: pictures carry this video, but the script never shows one. Show each scene\'s assigned picture with c.camera.');
  if (strategy.visual === 'mixed' && pictures === 0) out.push('The strategy is mixed: pictures carry some scenes and graphics or type the others, but this script shows no picture. Show each picture scene\'s assigned picture with c.camera, as the storyboard assigns them scene by scene.');
  if (strategy.typography.face !== 'sans' && !/face\s*=\s*["']serif/.test(script)) out.push(`The strategy's typography is ${strategy.typography.face.replace(/_/g, ' ')}: set the headlines with c.text(..., face="serif") (and face="serif_italic" for an accent word).`);
  // a finishing effect on every scene is a house style, not a decision: it is allowed when the strategy's own colour and light ask for it, and otherwise belongs only where a scene needs it
  if (scenesOf.length >= 3) for (const [fx, what] of [['grain', 'film grain'], ['vignette', 'a vignette']] as const) if (scenesOf.every((block) => new RegExp(`\\bc\\.${fx}\\(`).test(block)) && !/grain|film|vignette|analog|vintage|texture|noise|moody|cinematic|dramatic/i.test(`${strategy.colour_light} ${strategy.visual_notes} ${strategy.format}`)) out.push(`Every scene applies ${what}, but this strategy's colour and light do not call for it. Use ${what} only in the scenes that need it and leave it out of the others (a clean, bright or graphic scene should have none).`);
  // ready-made props are flat clip-art: they belong only in a video whose own visual language is flat, illustrated or iconic
  if (/\bc\.prop\(/.test(script) && strategy.visual !== 'graphic_led' && !/illustrat|cartoon|flat|vector|icon|sticker|hand[- ]drawn|2d/i.test(strategy.visual_language || '')) out.push('Do not use c.prop (flat clip-art) in this video: its visual language is not flat or illustrated, and a clip-art icon next to a real or 3D picture looks cheap. Show the subject with its picture (c.camera or c.photo), or build the moment from type, light, particles and shapes in the video\'s own style.');
  if (/\bc\.prop\(/.test(script) && scenesOf.some((block) => /\bc\.prop\(/.test(block) && /\bc\.camera\(/.test(block))) out.push('Do not draw illustrations (c.prop) over a picture shown with c.camera: the picture is the picture.');
  if (scenesOf.some((block) => /\bc\.studio\(/.test(block) && /\bc\.camera\(/.test(block))) out.push('c.studio() paints a whole set, which a full-frame c.camera then covers completely: remove c.studio() from any scene that uses c.camera.');
  return out;
}

/** A subject that has a ready-made prop must be drawn with it (not rebuilt from plain shapes, which looks flat). */
export const HERO_PROPS: Array<[RegExp, string]> = [[/\b(?:cupcake|muffin)s?\b/i, 'cupcake'], [/\bcakes?\b/i, 'cake'], [/\b(?:coffee|latte|espresso|tea)\b/i, 'coffee'], [/\b(?:gift|present)s?\b/i, 'gift'], [/\b(?:house|home|roof)\b/i, 'house'], [/\b(?:tree|garden)s?\b/i, 'tree']];
/** The ready-made prop a subject is drawn with, or null. */
export const heroKindFor = (subject: string): string | null => HERO_PROPS.find(([pattern]) => pattern.test(subject))?.[1] ?? null;
/** A photographed subject must be shown by its photograph (in at least three scenes), not drawn again from a prop. */
export function missingHeroPhoto(script: string, name: string, subject?: string, minUses = 3): string[] {
  const uses = (script.match(new RegExp(`\\.(?:photo|backdrop|camera)\\(\\s*["']${name}["']`, 'g')) ?? []).length;
  const kind = heroKindFor(subject ?? ''); const drawn = kind && new RegExp(`\\.prop\\(\\s*["']${kind}["']`).test(script);
  return [...(uses < minUses ? [`The subject has a real photograph (${name}). Use it as the main visual: c.photo("${name}", ...) or c.camera("${name}", ...) in at least ${minUses === 3 ? 'three scenes (wide, close-up crops, sign-off)' : `${minUses} scene${minUses === 1 ? '' : 's'} (the storyboard assigns it to that many)`}, not less.`] : []), ...(drawn ? [`Do not draw the ${kind} with c.prop: the photograph ${name} is the ${kind}. Remove the c.prop call and show the photograph instead.`] : [])];
}
export function missingHeroProp(script: string, subject?: string): string[] {
  const kind = HERO_PROPS.find(([pattern]) => pattern.test(subject ?? ''))?.[1];
  return kind && !new RegExp(`\\.prop\\(\\s*["']${kind}["']`).test(script) ? [`The subject is a ${kind}, which has a ready-made prop: draw the hero with c.prop("${kind}", cx, cy, size, k, t) in each scene where it appears, instead of rebuilding it from shapes.`] : [];
}

export function buildCodeBrief({ plan, kit, assets, photos, fontDir, ffmpeg, out }: { plan: PlanResult; kit: BrandKit; assets: Record<string, string>; photos?: CodeBrief['photos']; fontDir: string; ffmpeg: string; out: string }): CodeBrief {
  const { width, height } = sizes[plan.spec.size];
  const p = paletteFor(kit);
  const clean = (text: string) => text.replace(/[\u2010-\u2015]/g, '-'); // the font has no non-breaking hyphen
  const name = (id: string | null | undefined) => { const index = plan.summary.photosUsed.findIndex((photo) => photo.id === id); return index >= 0 && assets[`p${index + 1}`] ? `p${index + 1}` : null; };
  return {
    width, height, fps: 30, ffmpeg, font_dir: fontDir, out,
    brand: { name: clean(kit.name) }, assets, ...(photos?.length ? { photos } : {}),
    palette: { dark: p.dark, bg_a: p.bgA, bg_b: p.bgB, text: p.text, accent: p.accent, on_accent: p.onAccent, glow: p.glow, glow2: p.glow2, scrim: p.scrim },
    scenes: plan.summary.scenes.map((scene) => ({ role: scene.role, seconds: scene.seconds, headline: clean(scene.headline), subtext: clean(scene.subtext), items: (scene.items ?? []).map(clean), photo: name(scene.photoId), visual: scene.visual ?? null, ...((scene as { transition?: string }).transition ? { transition: (scene as { transition?: string }).transition } : {}), ...((scene as { shot?: Shot }).shot ? { shot: (scene as { shot?: Shot }).shot } : {}) })),
    total_seconds: plan.summary.durationSeconds,
  };
}

const CANDIDATES = () => Math.max(1, Math.min(3, Number(process.env.PILOT_CODE_VIDEO_CANDIDATES) || 1));
/** The whole code path (writing, checking, reviewing, drawing) gets this long; after that the standard renderer is used. */
const BUDGET_MS = () => Math.max(60, Number(process.env.PILOT_CODE_VIDEO_BUDGET_SECONDS) || 480) * 1000;
/** A design scoring below this is not used; Pilot's standard renderer is. */
const MIN_SCORE = 6;
const GOOD_ENOUGH = 8;

type Usage = { calls: number; inputTokens: number; outputTokens: number };
type Candidate = { script: string; score: number; issues: string[]; fidelity?: SceneFidelity[]; fidelityOverall?: number; creative?: CreativeScore[]; creativeOverall?: number; /** the design review could not be read, so the score is the default for "not reviewed" */ unreviewed?: boolean };

/** Joins frame files into one labelled contact sheet (labels S1a, S1b... so the review can say which scene). */
async function labelledSheet(files: string[], labels: string[]): Promise<Buffer | null> {
  try {
    const images = []; for (const file of files) images.push(await loadImage(await readFile(file)));
    const width = images[0].width; const height = images[0].height; const columns = Math.min(6, files.length); const rows = Math.ceil(files.length / columns);
    const sheet = createCanvas(columns * width, rows * height); const ctx = sheet.getContext('2d');
    images.forEach((image, i) => { const x = (i % columns) * width; const y = Math.floor(i / columns) * height; ctx.drawImage(image, x, y, width, height); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x + 4, y + height - 30, 62, 26); ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(labels[i] ?? '', x + 10, y + height - 11); });
    return sheet.toBuffer('image/jpeg', 85);
  } catch { return null; }
}

/** Draws a few still frames of every scene at a small size and joins them into one contact sheet (two per scene, mid-scene and settled). */
async function contactSheet({ brief, dir, run }: { brief: CodeBrief; dir: string; run: (extra: { previewOnly: true }, briefPath: string) => Promise<{ ok: boolean; errors: string[] }> }): Promise<Buffer | null> {
  const previewDir = path.join(dir, 'preview'); await mkdir(previewDir, { recursive: true });
  const width = 360; const height = Math.round((brief.height / brief.width) * width);
  const times: number[] = []; let start = 0;
  for (const scene of brief.scenes) { times.push(start + scene.seconds * 0.5, start + scene.seconds * 0.92); start += scene.seconds; }
  const previewBrief = { ...brief, width, height, preview_dir: previewDir, preview_times: times.slice(0, 12) };
  const briefPath = path.join(dir, 'brief_preview.json'); await writeFile(briefPath, JSON.stringify(previewBrief));
  const ran = await run({ previewOnly: true }, briefPath); if (!ran.ok) return null;
  const count = Math.min(12, times.length); const columns = Math.min(count, 6); const rows = Math.ceil(count / columns);
  const sheet = createCanvas(columns * width, rows * height); const ctx = sheet.getContext('2d');
  for (let i = 0; i < count; i += 1) {
    const x = (i % columns) * width; const y = Math.floor(i / columns) * height;
    ctx.drawImage(await loadImage(await readFile(path.join(previewDir, `frame_${String(i).padStart(2, '0')}.jpg`))), x, y, width, height);
    const label = `S${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`; ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x + 4, y + height - 30, 62, 26); ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(label, x + 10, y + height - 11);
  }
  return sheet.toBuffer('image/jpeg', 85);
}

/**
 * Writes the video as code and draws it to `outPath` (a silent MP4; music is added afterwards like any other free video).
 *
 * Quality control, because an open canvas gives variable results: PILOT_CODE_VIDEO_CANDIDATES (default 2) different design directions are written; each
 * passes the safety check and the automatic layout check (repaired by the model if it fails), then a contact sheet of its frames is reviewed by the
 * model as a design critic, who scores it and lists fixes (one more repair if the score is low). Only the best design is rendered in full, and only if it
 * scores well enough. Otherwise, and on any failure, the caller uses the standard renderer.
 */
export async function renderCodeVideo({ tenantId, plan, kit, logoId, storage, workDir, outPath, complete, completeWithImages, style, subject, palette, design, forbidden, heroPhoto, look, assetFacts, strategy, platform, recent }: { /** the creative strategy this video was planned from: authoritative for the look, the writer's rules and the checks */ strategy?: Strategy; platform?: string; /** structures of recent videos, for the design review */ recent?: string[]; /** what looking at the pictures found, by asset id: passed to the writer as text so it chooses and crops by what each picture shows */ assetFacts?: AssetFactsById; /** 'motion': invented graphics and UI with continuous motion (photos optional); 'photo' (the default): the photograph is the main visual */ look?: CodeLook; /** the id of a realistic photograph of the subject (own or generated): it is the main visual and must be shown, not redrawn */ heroPhoto?: { id: string; label: string }; /** the reference's own text: a script that contains any of it is sent back to be rewritten */ forbidden?: ReferenceText; /** the design blueprint of a reference video to follow */ design?: unknown; /** the mood palette of a fully custom video (backdrop, lights, tones); the brand colour stays the accent */ palette?: Record<string, string | boolean>; /** what the request is about, for an invented video */ subject?: string; /** how the script is written: 'invent' draws the scenes from shapes, 'open' arranges the scene library (the default) */ style?: CodeStyle; tenantId: string; plan: PlanResult; kit: BrandKit; logoId: string | null; storage: MediaStorage; workDir: string; outPath: string; complete: Complete; completeWithImages?: CompleteWithImages }): Promise<CodeVideoResult> {
  const trace: string[] = []; const started = Date.now(); const mark = (message: string) => { trace.push(`[${Math.round((Date.now() - started) / 1000)}s] ${message}`); };
  try {
    const deadline = Date.now() + BUDGET_MS();
    const guarded = <T,>(work: Promise<T>): Promise<T> => Promise.race([work, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('TIME_BUDGET')), Math.max(1, deadline - Date.now())); timer.unref?.(); })]);
    const modelComplete: Complete = (system, prompt) => guarded(complete(system, prompt));
    const modelImages: CompleteWithImages | undefined = completeWithImages ? (system, prompt, images) => guarded(completeWithImages(system, prompt, images)) : undefined;
    const support = await codeVideoSupport();
    if (!support.ok || !support.python || !support.sandbox) return { ok: false, reason: support.reason };
    const ffmpeg = ffmpegPath(); if (!ffmpeg) return { ok: false, reason: 'FFmpeg is not available.' };
    const dir = path.join(workDir, 'code'); await mkdir(dir, { recursive: true });
    const { assets, photos } = await exportAssets({ tenantId, plan, logoId, kit, storage, dir, ...(assetFacts ? { facts: assetFacts } : {}) });
    const fontDir = path.join(path.dirname(require_resolve('@fontsource/inter/package.json')), 'files');
    const brief = buildCodeBrief({ plan, kit, assets, photos, fontDir, ffmpeg, out: outPath }); if (subject && (style === 'invent' || style === 'custom')) brief.subject = subject.slice(0, 120); if (style === 'custom') brief.require_motion = true; if (palette && style === 'custom') brief.palette = { ...brief.palette, ...palette }; if (design && style === 'custom') brief.design_reference = design;
    const heroIndex = heroPhoto ? plan.summary.photosUsed.findIndex((photo) => photo.id === heroPhoto.id) : -1; const heroName = heroIndex >= 0 && assets[`p${heroIndex + 1}`] ? `p${heroIndex + 1}` : null;
    if (style === 'custom' && strategy) { brief.strategy = strategy; brief.look = lookOf(strategy); brief.logo_rule = strategy.brand === 'corner_mark' ? 'every' : strategy.brand === 'both' ? 'ends' : 'last'; if (platform) brief.platform = platform; if (recent?.length) brief.recent = recent; }
    else if (style === 'custom' && look === 'motion') { brief.look = 'motion'; if (heroPhoto && heroName) brief.optional_photo = { name: heroName, label: heroPhoto.label.slice(0, 80) }; }
    else if (heroPhoto && heroName && (style === 'custom' || style === 'invent')) brief.hero_photo = { name: heroName, label: heroPhoto.label.slice(0, 80), ...(heroPhoto.id && assetFacts?.[heroPhoto.id] ? { shows: assetFacts[heroPhoto.id].shows } : {}) };
    const briefPath = path.join(dir, 'brief.json'); await writeFile(briefPath, JSON.stringify(brief));
    const scriptPath = path.join(dir, 'scene_script.py');
    const sandboxArgs = { python: support.python, sandbox: support.sandbox, jobDir: workDir, briefPath, scriptPath, fontDir, ffmpegPath: ffmpeg };
    const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
    const check = async (script: string) => { await writeFile(scriptPath, script); const result = await runSandboxed({ ...sandboxArgs, checkOnly: true, timeoutMs: 120_000 }); if (!result.ok) return result.errors; return style === 'custom' ? [...usesReadyMade(script), ...(brief.strategy ? strategyProblems(script, brief.strategy) : brief.look === 'motion' ? motionProblems(script) : brief.hero_photo ? cinematicProblems(script) : []), ...(brief.strategy ? [] : brief.hero_photo ? missingHeroPhoto(script, brief.hero_photo.name, subject, brief.scenes.some((scene) => scene.shot) ? Math.max(1, Math.min(3, brief.scenes.filter((scene) => scene.photo === brief.hero_photo!.name).length)) : 3) : missingHeroProp(script, subject)), ...(forbidden ? findReferenceText(scriptStrings(script).map((text) => ({ where: 'script', text })), forbidden).slice(0, 3).map((v) => `The script contains "${v.found}", which belongs to the reference video and must not appear: write the business's own words instead.`) : [])] : []; };
    // A storyboard mismatch the writer has been told about three times, with the same words each time, is more likely a disagreement with the check than a script that will not change: after
    // the third time it stops blocking (the review of the finished video still scores fidelity), instead of spending every repair round on it.
    const repeated = new Map<string, number>();
    const lintScript = async (script: string) => {
      await writeFile(scriptPath, script);
      const result = await runSandboxed({ ...sandboxArgs, lintOnly: true, timeoutMs: 120_000 });
      if (result.ok || !result.errors.length) return result;
      const kindOf = (error: string) => error.replace(/ACTUAL RESULT:[^\n]*/g, '').replace(/\s+/g, ' '); // the same storyboard point, however the measured numbers moved
      for (const error of new Set(result.errors.map(kindOf))) repeated.set(error, (repeated.get(error) ?? 0) + 1);
      if (result.errors.every((error) => error.startsWith('STORYBOARD MISMATCH') && (repeated.get(kindOf(error)) ?? 0) >= 3)) { mark(`the same storyboard mismatch came back ${Math.max(...result.errors.map((error) => repeated.get(kindOf(error)) ?? 0))} times unchanged: no longer blocking (${result.errors[0].split('\n')[0].slice(0, 60)})`); return { ...result, ok: true, errors: [] }; }
      return result;
    };
    const preview = async (script: string): Promise<Buffer | null> => { await writeFile(scriptPath, script); return contactSheet({ brief, dir, run: (extra, previewBrief) => runSandboxed({ ...sandboxArgs, ...extra, briefPath: previewBrief, timeoutMs: 180_000 }) }); };
    const add = (more: Usage) => { usage.calls += more.calls; usage.inputTokens += more.inputTokens; usage.outputTokens += more.outputTokens; };
    let lastRefused: string | undefined; let lastReason = 'No design passed the checks.';
    const told: string[] = []; const refusal: { problems: string[] } = { problems: [] };

    /** One design direction, from first draft to a scored, checked script (or null). */
    const develop = async (direction: string): Promise<Candidate | null> => {
      const local: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
      try {
        const written = await writeScript({ brief, complete: modelComplete, check, direction, ...(style ? { style } : {}) });
        add(written.usage); mark(`first draft written (${'error' in written ? 'refused' : 'passed the safety check'})`);
        let script = written.script; let repairs = 0;
        const repair = async (errors: string[]) => { if (repairs >= (style === 'invent' || style === 'custom' ? MAX_REPAIRS_INVENT : MAX_REPAIRS)) { mark(`repair limit reached; last problems: ${errors.slice(0, 2).join(' | ').slice(0, 200)}`); return false; } repairs += 1; mark(`repair ${repairs}: ${errors.slice(0, 3).map((error) => error.slice(0, 140)).join(' | ')}`); const fixed = await repairScript({ brief, complete: modelComplete, script, errors, check, usage: local, history: told, notes: trace, rejected: refusal, ...(style ? { style } : {}) }); told.push(...errors); if (!fixed) mark(`repair ${repairs}: the corrected script did not pass the safety check`); if (!fixed) return false; script = fixed; return true; };
        // a first draft the checks refused is not the end: it goes into the same bounded repair as any other problem, told what was wrong
        if ('error' in written) {
          lastRefused = written.script; lastReason = written.error; mark(`first draft refused: ${written.error.slice(0, 160)}`);
          // keep repairing while rounds remain: a correction that is itself refused is told why and tried again, never the end of the run
          let pending = [written.error];
          for (;;) {
            const ok = await repair(pending);
            if (ok) break;
            if (repairs >= (style === 'invent' || style === 'custom' ? MAX_REPAIRS_INVENT : MAX_REPAIRS) || !refusal.problems.length) return null;
            pending = [written.error, ...refusal.problems]; refusal.problems = [];
          }
        }
        let critic: Critique | null = null; let bestSoFar: Candidate | null = null; // repairs do not always improve a design: the best-reviewed version is the one kept, not the last
        for (;;) {
          const lint = await lintScript(script);
          if (!lint.ok) { if (!(await repair(lint.timedOut ? ['The layout check took too long to draw your frames: the script does too much work per frame. Simplify it: fewer layered effects per scene (use at most two of c.caustics, c.light_leak, c.dust, c.rays, c.grain, c.grade in one scene), no loops of more than ten drawing calls, and no repeated c.photo or c.camera calls.'] : lint.errors))) { lastReason = `The animation's layout check failed: ${lint.errors[0] ?? 'it could not be checked'}`; lastRefused = script; return bestSoFar; } continue; }
          if (!modelImages) return { script, score: GOOD_ENOUGH, issues: [] };
          const sheet = await preview(script).catch(() => null); // a review that cannot be drawn is not a reason to lose the design (it is checked and rendered all the same)
          critic = sheet ? await critiqueWith(sheet) : null;
          if (!critic && sheet) { mark('design review could not be read: asking once more'); critic = await critiqueWith(sheet); }
          if (!critic) { mark('design review unavailable: this version goes unreviewed'); return { script, score: MIN_SCORE, issues: [], unreviewed: true }; } // could not be reviewed: acceptable, but not preferred and said so
          if (!bestSoFar || critic.score > bestSoFar.score) bestSoFar = { script, score: critic.score, issues: critic.issues, ...(critic.fidelity ? { fidelity: critic.fidelity, fidelityOverall: critic.fidelity_overall } : {}), ...(critic.creative ? { creative: critic.creative, creativeOverall: critic.creative_overall } : {}) };
          const unfaithful = (critic.fidelity ?? []).filter((f) => f.score <= 6 && (f.cause === 'code' || f.cause === 'toolkit'));
          const weak = (critic.creative ?? []).filter((c) => c.score <= 4);
          if (critic.creative) mark(`creative review: ${critic.creative.map((c) => `${c.aspect} ${c.score}`).join(', ')}; overall ${critic.creative_overall}`);
          if (critic.fidelity) mark(`storyboard fidelity: ${critic.fidelity.map((f) => `S${f.scene} ${f.score}${f.cause !== 'none' ? ` (${f.cause})` : ''}`).join(', ')}; overall ${critic.fidelity_overall}`);
          if (critic) mark(`design review: ${critic.score}/10${critic.issues.length ? ` (${critic.issues.map((issue) => issue.slice(0, 120)).join(' | ')})` : ''}`);
          if ((critic.score >= GOOD_ENOUGH && !unfaithful.length && !weak.length) || !(await repair([...unfaithful.map((f) => fidelityText(brief, f)), ...weak.map(creativeText), ...critic.issues.map((issue) => `Design review: ${issue}`)]))) return bestSoFar ?? { script, score: critic.score, issues: critic.issues };
        }
      } finally { add(local); }
    };
    const critiqueWith = async (sheet: Buffer) => { const local: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 }; const result = await critique({ sheet, brief, look: brief.look, complete: async (system, prompt, images) => { const reply = await modelImages!(system, prompt, images); local.calls += 1; local.inputTokens += reply.usage?.inputTokens ?? 0; local.outputTokens += reply.usage?.outputTokens ?? 0; return reply; } }); add(local); return result; };

    const candidates: Candidate[] = [];
    for (const direction of (style === 'custom' ? [brief.strategy ? STRATEGY_DIRECTION : brief.look === 'motion' ? MOTION_DIRECTION : CUSTOM_DIRECTION] : style === 'invent' ? [INVENT_DIRECTION] : DIRECTIONS.slice(0, CANDIDATES()))) { const made = await develop(direction); if (made) candidates.push(made); if (made && made.score >= GOOD_ENOUGH) break; }
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best) return { ok: false, reason: lastReason, script: lastRefused, trace, usage };
    if (best.score < MIN_SCORE) return { ok: false, reason: `The best design scored ${best.score}/10 in review (${best.issues[0] ?? 'no detail'}), so the standard video is used.`, script: best.script, trace, usage };

    if (process.env.PILOT_DEBUG_CODE === 'on') console.info(JSON.stringify({ event: 'marketing-video.code-script', script: best.script })); // developer logs only, never shown to the owner
    if (style !== 'custom') {
      await writeFile(scriptPath, best.script);
      const ran = await runSandboxed({ ...sandboxArgs });
      if (!ran.ok) return { ok: false, reason: ran.errors[0] ?? 'The animation could not be drawn.', script: best.script };
      if (!ran.seconds || Math.abs(ran.seconds - brief.total_seconds) > brief.total_seconds * 0.25) return { ok: false, reason: `The animation came out ${ran.seconds ?? 0} seconds long instead of about ${brief.total_seconds}.` };
      if (!(await stat(outPath).then((file) => file.size > 10_000).catch(() => false))) return { ok: false, reason: 'The animation file was not created.' };
      return { ok: true, script: best.script, scriptSha: createHash('sha256').update(best.script).digest('hex').slice(0, 16), seconds: ran.seconds, usage, score: best.score, candidates: candidates.length };
    }

    // The model-written creative path: render, check the FINISHED video, and if it fails send what was found back to the writer for a revision (at most
    // PILOT_CODE_VIDEO_REVISIONS times, never more than two). A render that is unusable after that is refused, so the caller uses the standard renderer.
    const maxRevisions = Math.max(0, Math.min(2, Number(process.env.PILOT_CODE_VIDEO_REVISIONS ?? 1) || 0));
    type Review = { score: number; issues: string[]; fidelity?: SceneFidelity[]; fidelityOverall?: number; creative?: CreativeScore[]; creativeOverall?: number };
    /**
     * The design review of the FINISHED video: two frames of every scene are taken from the rendered MP4 itself (the middle of the scene, and the moment it has settled before it hands over),
     * laid out with scene labels and judged against the storyboard and the strategy. This is the review that decides acceptance; the one on preview frames only steers the first drafts.
     */
    const reviewRendered = async (script: string, file: string, round: number): Promise<Review | null> => {
      if (!modelImages) return null;
      try {
        await writeFile(scriptPath, script);
        const rows = ((await runSandboxed({ ...sandboxArgs, measureOnly: true, timeoutMs: 120_000 }).catch(() => null))?.measured ?? []) as Array<{ begin: number; seconds: number; transition_seconds: number }>;
        if (!rows.length) return null;
        const frames = path.join(dir, `frames_r${round}`); await mkdir(frames, { recursive: true });
        const files: string[] = []; const labels: string[] = []; const total = rows.at(-1)!.begin + rows.at(-1)!.seconds;
        for (const [i, row] of rows.entries()) {
          const settled = row.begin + row.seconds - (i === rows.length - 1 ? 0.15 : row.transition_seconds + 0.1);
          for (const [which, t] of [['a', row.begin + row.seconds * 0.5], ['b', settled]] as const) {
            const file2 = path.join(frames, `s${i}${which}.jpg`);
            await run(ffmpeg, ['-v', 'error', '-y', '-ss', String(Math.max(0, Math.min(total - 0.06, which === 'b' && row.seconds < 1.2 ? row.begin + row.seconds * 0.5 : t))), '-i', file, '-frames:v', '1', '-vf', 'scale=360:-1', '-q:v', '3', file2], { timeout: 30_000 });
            files.push(file2); labels.push(`S${i + 1}${which}`);
          }
        }
        const sheet = await labelledSheet(files, labels); if (!sheet) return null;
        const critic = (await critiqueWith(sheet)) ?? (await critiqueWith(sheet));
        if (!critic) { mark('rendered-video review could not be read'); return null; }
        mark(`rendered-video review: ${critic.score}/10${critic.fidelity ? `; fidelity ${critic.fidelity_overall}` : ''}${critic.creative ? `; creative ${critic.creative_overall}` : ''}`);
        return { score: critic.score, issues: critic.issues, ...(critic.fidelity ? { fidelity: critic.fidelity, fidelityOverall: critic.fidelity_overall } : {}), ...(critic.creative ? { creative: critic.creative, creativeOverall: critic.creative_overall } : {}) };
      } catch (error) { mark(`rendered-video review failed: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`); return null; }
    };
    const rejects = (review: Review | null) => !!review && (review.score < MIN_SCORE || (review.fidelity ?? []).some((f) => f.score <= 4 && f.cause !== 'concept') || (review.creative ?? []).some((c) => c.score <= 3));
    const reviewProblems = (review: Review, before: Review | null) => {
      const unfaithful = (review.fidelity ?? []).filter((f) => f.score <= 6 && f.cause !== 'concept' && f.cause !== 'none').map((f) => fidelityText(brief, f));
      const weakNow = (review.creative ?? []).filter((c) => c.score <= 4);
      // a problem that is still there after a repair is not fixed by another small tweak of the same idea
      const stuck = weakNow.filter((c) => (before?.creative ?? []).some((b) => b.aspect === c.aspect && b.score <= 4)).map((c) => `STILL NOT FIXED after your last change: ${c.aspect} (${c.score}/10). Do not tweak what you already tried: change the structural choice behind it (a different picture, composition, camera move, timing or text decision).`);
      return [...stuck, ...unfaithful, ...weakNow.map(creativeText), ...review.issues.map((issue) => `Rendered-video review: ${issue}`)];
    };
    const renderScript = async (script: string, out: string, round: number) => {
      await writeFile(scriptPath, script);
      const roundBrief = path.join(dir, round ? `brief_r${round}.json` : 'brief.json'); await writeFile(roundBrief, JSON.stringify({ ...brief, out }));
      const ran = await runSandboxed({ ...sandboxArgs, briefPath: roundBrief });
      const hard: string[] = []; let soft: string[] = [];
      if (!ran.ok) hard.push(`It failed while drawing: ${ran.errors[0] ?? 'unknown error'}`);
      else if (!(await stat(out).then((file) => file.size > 10_000).catch(() => false))) hard.push('The animation file was not created.');
      else { const seen = await checkRenderedVideo({ file: out, ffmpeg, expectedSeconds: brief.total_seconds, tolerance: 0.1 }); hard.push(...seen.hard); soft = seen.soft; }
      mark(`render ${round} finished${hard.length ? ` (${hard[0].slice(0, 80)})` : ''}`); console.info(JSON.stringify({ event: 'marketing-video.code-quality', round, hard, soft }));
      const review = hard.length ? null : await reviewRendered(script, out, round);
      return { ok: hard.length === 0, seconds: ran.seconds ?? 0, hard, soft, review };
    };
    // which version is kept: one that drew and passed the finished-video check, then the better reviewed (the rendered review, else the preview review), then the fewer soft problems
    const rank = (r: { soft: string[]; review: Review | null }, fallback: number) => (r.review?.score ?? fallback) - 0.4 * r.soft.length;
    let script = best.script; let round = 0; let out = outPath;
    let last = await renderScript(script, out, round);
    let kept: { script: string; out: string; seconds: number; soft: string[]; review: Review | null } | null = last.ok ? { script, out, seconds: last.seconds, soft: last.soft, review: last.review } : null;
    const revisions: string[] = []; let previousReview: Review | null = last.review;
    while ((!last.ok || last.soft.length || rejects(last.review)) && round < maxRevisions && Date.now() < deadline) {
      round += 1;
      const problems = [...[...last.hard, ...last.soft].map((problem) => `Finished video check: ${problem}`), ...(last.review && rejects(last.review) ? reviewProblems(last.review, null) : [])]; revisions.push(...problems);
      mark(`revision ${round} for the finished video: ${problems.slice(0, 2).map((problem) => problem.slice(0, 110)).join(' | ')}`);
      const local: Usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
      const fixed = await repairScript({ brief, complete: modelComplete, script, errors: problems, check, usage: local, history: told, notes: trace, ...(style ? { style } : {}) }).catch(() => null); add(local);
      if (!fixed) break;
      const lint = await lintScript(fixed); if (!lint.ok) { mark(`the revision failed the layout check: ${lint.errors[0]?.slice(0, 100) ?? ''}`); break; }
      told.push(...problems); script = fixed; out = path.join(dir, `revision_${round}.mp4`);
      last = await renderScript(script, out, round);
      if (last.review && previousReview) { const stuck = reviewProblems(last.review, previousReview).filter((p) => p.startsWith('STILL NOT FIXED')); if (stuck.length) mark(`still not fixed after the revision: ${stuck.map((p) => p.slice(24, 60)).join(', ')}`); }
      previousReview = last.review ?? previousReview;
      if (last.ok && (!kept || rank(last, best.score) > rank(kept, best.score))) kept = { script, out, seconds: last.seconds, soft: last.soft, review: last.review };
    }
    if (!kept) return { ok: false, reason: last.hard[0] ?? 'The animation could not be drawn.', script, trace, usage };
    if (kept.out !== outPath) await rename(kept.out, outPath);
    if (process.env.PILOT_DEBUG_CODE === 'on') console.info(JSON.stringify({ event: 'marketing-video.code-script', script: kept.script }));
    let measured: unknown[] | undefined;
    if (brief.scenes.some((scene) => scene.shot)) { await writeFile(scriptPath, kept.script); measured = (await runSandboxed({ ...sandboxArgs, measureOnly: true, timeoutMs: 120_000 }).catch(() => null))?.measured; }
    return { ok: true, trace, script: kept.script, scriptSha: createHash('sha256').update(kept.script).digest('hex').slice(0, 16), seconds: kept.seconds, usage, score: kept.review?.score ?? best.score, candidates: candidates.length, ...((kept.review?.creative ?? (kept.script === best.script ? best.creative : undefined)) ? { creative: { ...((kept.review?.creativeOverall ?? best.creativeOverall) !== undefined ? { overall: kept.review?.creativeOverall ?? best.creativeOverall } : {}), scores: (kept.review?.creative ?? best.creative)! } } : {}), ...(!kept.review && modelImages ? { unreviewed: true } : best.unreviewed && !kept.review ? { unreviewed: true } : {}), ...((kept.review?.fidelity ?? (kept.script === best.script ? best.fidelity : undefined)) ? { fidelity: { ...((kept.review?.fidelityOverall ?? best.fidelityOverall) !== undefined ? { overall: kept.review?.fidelityOverall ?? best.fidelityOverall } : {}), scenes: (kept.review?.fidelity ?? best.fidelity)! } } : {}), ...(kept.review ? { rendered_review: { score: kept.review.score, issues: kept.review.issues } } : {}), ...(measured ? { measured } : {}), quality: { passed: kept.soft.length === 0, revisions: round, problems: kept.soft, ...(revisions.length ? { revised_for: revisions.slice(0, 4) } : {}) } };
  } catch (error) { mark(`stopped: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`); return { ok: false, reason: error instanceof Error && error.message === 'TIME_BUDGET' ? 'The custom animation took too long to design, so the standard video is used.' : error instanceof Error ? error.message.slice(0, 200) : 'The animation could not be made.', trace }; }
}

const require_resolve = (id: string) => nodeModule.createRequire(path.join(process.cwd(), 'package.json')).resolve(id);
