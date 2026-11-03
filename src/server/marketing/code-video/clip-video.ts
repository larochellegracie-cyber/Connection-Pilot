import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { stems } from '../asset-selection.js';
import { getRunwayVideo, startRunwayClip, type ClipRequest } from '../runway.js';
import { ensureFonts, FONT_FAMILY } from '../standard-video/fonts.js';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import type { MediaStorage } from '../standard-video/storage.js';
import { downloadClip, stitchClips } from '../video-stitch.js';
import type { Idea, IdeaShot } from './idea.js';
import { reviewClaims, unsupportedClaims, type Strategy } from './strategy.js';
import type { Concept } from './concept.js';

/**
 * The GENERATED-CLIP production method. Every shot of the idea's timed structure starts from a still (the owner's own picture, or one Pilot makes) and an
 * image-to-video model animates it for 2 to 10 seconds with the shot's explicit motion. The clips are cut together, and the words (checked against what the
 * business really said) are laid over them, ending on the business's name and the call to action. Nothing here is a slideshow: every shot is footage.
 */
export type ClipDeps = {
  startClip: (request: ClipRequest) => Promise<{ taskId: string; estimatedCredits: number | null }>;
  checkClip: (taskId: string) => Promise<{ status: 'processing' | 'succeeded' | 'failed'; url?: string; message?: string }>;
  fetchClip: (url: string) => Promise<Buffer>;
  sleep: (ms: number) => Promise<void>; pollMs: number; clipTimeoutMs: number;
};
export const defaultClipDeps = (): ClipDeps => ({ startClip: (r) => startRunwayClip(r), checkClip: (id) => getRunwayVideo(id), fetchClip: (url) => downloadClip(url), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), pollMs: 5000, clipTimeoutMs: 8 * 60_000 });

type Complete = (system: string, prompt: string) => Promise<string>;
type Pic = { id: string; label: string; shows?: string };
export type ClipResult = { ok: true; seconds: number; credits: number | null; shots: Array<{ beat: string; seconds: number; still: string; motion: string; words: string; picture: string; origin: 'owner' | 'generated' }>; notes: string[]; framePaths: string[] } | { ok: false; reason: string };

const NO_TEXT = 'No readable text, no logos, no captions, no people. Smooth, physically plausible motion with a stable, undistorted subject.';
/** The words the image-to-video model is given: the explicit motion first, then the look. */
export const clipPrompt = (shot: IdeaShot, idea: Idea) => `${shot.motion.replace(/\.$/, '')}. ${idea.visual_style}. ${NO_TEXT}`.slice(0, 950);
/** The shots with their lengths made whole seconds in the range the model makes, and the total held to the cap. */
export function planShots(shots: IdeaShot[], maxSeconds: number): IdeaShot[] {
  let list = shots.map((s) => ({ ...s, seconds: Math.max(2, Math.min(10, Math.round(s.seconds))) }));
  while (list.reduce((a, s) => a + s.seconds, 0) > maxSeconds && list.some((s) => s.seconds > 2)) { const i = list.reduce((best, s, k) => (s.seconds > list[best].seconds ? k : best), 0); list = list.map((s, k) => (k === i ? { ...s, seconds: s.seconds - 1 } : s)); }
  while (list.reduce((a, s) => a + s.seconds, 0) > maxSeconds && list.length > 2) list = list.slice(0, -2).concat(list.slice(-1));
  return list;
}
const matchOwner = (shot: IdeaShot, pictures: Pic[], used: Set<string>): Pic | null => {
  const want = new Set(stems(`${shot.still} ${shot.beat}`)); let best: { pic: Pic; score: number } | null = null;
  for (const pic of pictures) { if (used.has(pic.id)) continue; const have = stems(`${pic.label} ${pic.shows ?? ''}`); const score = have.filter((w) => want.has(w)).length; if (score > 0 && (!best || score > best.score)) best = { pic, score }; }
  return best?.pic ?? null;
};

const run = (args: string[], timeoutMs = 5 * 60_000) => new Promise<void>((resolve, reject) => {
  const bin = ffmpegPath(); if (!bin) { reject(new Error('FFmpeg is not available on this server.')); return; }
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = '';
  child.stderr.on('data', (c: Buffer) => { err = (err + c.toString()).slice(-500); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Making the video took too long.')); }, timeoutMs);
  child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg stopped with code ${code}. ${err.trim()}`)); });
});

/** A transparent 1080x1920 picture of one on-screen message, kept clear of the areas platforms cover. */
async function overlayPng(file: string, { words, kind, name, accent }: { words: string; kind: 'hook' | 'line' | 'cta'; name: string; accent: string }): Promise<void> {
  await ensureFonts();
  const W = 1080; const H = 1920; const canvas = createCanvas(W, H); const x = canvas.getContext('2d');
  const wrap = (text: string, size: number, max: number) => { x.font = `800 ${size}px ${FONT_FAMILY}`; const out: string[] = []; let line = ''; for (const word of text.split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (x.measureText(next).width > max && line) { out.push(line); line = word; } else line = next; } if (line) out.push(line); return out; };
  const draw = (lines: string[], size: number, cy: number, color = '#FFFFFF') => { x.font = `800 ${size}px ${FONT_FAMILY}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 24; x.shadowOffsetY = 4; x.fillStyle = color; lines.forEach((l, i) => x.fillText(l, W / 2, cy + (i - (lines.length - 1) / 2) * size * 1.08)); x.shadowBlur = 0; x.shadowOffsetY = 0; };
  if (kind === 'cta') {
    const g = x.createLinearGradient(0, 980, 0, 1560); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)'); x.fillStyle = g; x.fillRect(0, 980, W, 580);
    draw(wrap(name, 120, 900), 120, 1170);
    const lines = wrap(words, 54, 780); const size = 54; const h = lines.length * size * 1.15 + 56; const cy = 1380; const w = 860;
    x.fillStyle = accent; x.beginPath(); x.roundRect(W / 2 - w / 2, cy - h / 2, w, h, h / 2); x.fill();
    x.fillStyle = '#FFFFFF'; x.font = `800 ${size}px ${FONT_FAMILY}`; x.textAlign = 'center'; x.textBaseline = 'middle'; lines.forEach((l, i) => x.fillText(l, W / 2, cy + (i - (lines.length - 1) / 2) * size * 1.15));
  } else {
    const size = kind === 'hook' ? 108 : 88; const lines = wrap(words, size, 900);
    draw(lines, size, kind === 'hook' ? 520 : 1260);
  }
  await writeFile(file, canvas.toBuffer('image/png'));
}

export async function renderClipVideo(args: {
  tenantId: string; idea: Idea; business: { name: string; type: string }; accent: string; pictures: Pic[]; storage: MediaStorage; facts: string;
  /** makes a picture from a description (the same step the photo path uses); null/undefined when it cannot */
  generate?: (subject: string, look?: string, style?: string) => Promise<{ id: string; label: string } | null>;
  complete: Complete; completeWithImages?: (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }>;
  workDir: string; outPath: string; deps?: ClipDeps; maxSeconds?: number;
}): Promise<ClipResult> {
  const { idea, deps = defaultClipDeps() } = args; const notes: string[] = [];
  const maxSeconds = args.maxSeconds ?? Math.max(6, Number(process.env.PILOT_CLIP_MAX_SECONDS) || 24);
  const shots = planShots(idea.shots.filter((s) => s.motion), maxSeconds);
  if (shots.length < 2) return { ok: false, reason: 'The idea has fewer than two shots with an explicit motion.' };
  await mkdir(args.workDir, { recursive: true });

  // 1. a starting picture for every shot
  const used = new Set<string>(); const stills: Array<{ pic: Pic; origin: 'owner' | 'generated' }> = [];
  for (const [index, shot] of shots.entries()) {
    // a call-to-action shot whose first frame is a button, card or graphic is not footage (the button is laid over the video): it settles on the previous picture instead
    if (index === shots.length - 1 && index > 0 && /\b(button|graphic|icon|card|badge|logo|banner|tag)\b/i.test(`${shot.still} ${shot.motion}`)) { stills.push({ ...stills[index - 1] }); shot.motion = 'slow, calm pull-back as the light settles and the scene holds still at the end'; notes.push('the closing shot settles on the previous picture instead of a drawn button'); continue; }
    const owner = shot.source === 'owner' ? matchOwner(shot, args.pictures, used) : null;
    if (owner) { used.add(owner.id); stills.push({ pic: owner, origin: 'owner' }); continue; }
    const made = args.generate ? await args.generate(shot.still, idea.visual_style, idea.visual_style).catch(() => null) : null;
    if (!made) return { ok: false, reason: `A starting picture could not be made for the "${shot.beat}" shot ("${shot.still.slice(0, 80)}").` };
    stills.push({ pic: { id: made.id, label: made.label }, origin: 'generated' }); notes.push(`made a starting picture for the ${shot.beat} shot`);
  }

  // 2. each still becomes a clip (two at a time, one retry each)
  const { referenceDataUri } = await import('../video-generation.js');
  const files: string[] = new Array(shots.length); let credits: number | null = null;
  const makeOne = async (i: number) => {
    const uri = await referenceDataUri(args.tenantId, stills[i].pic.id, args.storage); if (!uri) throw new Error('A starting picture is no longer available.');
    const attempt = async () => {
      const started = await deps.startClip({ prompt: clipPrompt(shots[i], idea), seconds: shots[i].seconds, imageDataUri: uri });
      if (started.estimatedCredits !== null) credits = (credits ?? 0) + started.estimatedCredits;
      const deadline = Date.now() + deps.clipTimeoutMs;
      for (;;) { const state = await deps.checkClip(started.taskId); if (state.status === 'succeeded' && state.url) return state.url; if (state.status === 'failed') throw new Error(state.message ?? 'A clip could not be made.'); if (Date.now() > deadline) throw new Error('A clip took too long.'); await deps.sleep(deps.pollMs); }
    };
    const url = await attempt().catch(() => attempt());
    const file = path.join(args.workDir, `clip-${i}.mp4`); await writeFile(file, await deps.fetchClip(url)); files[i] = file; notes.push(`clip ${i + 1} (${shots[i].beat}, ${shots[i].seconds}s) made`);
  };
  let next = 0; let failure: unknown = null;
  await Promise.all(Array.from({ length: Math.min(2, shots.length) }, async () => { while (failure === null) { const i = next; next += 1; if (i >= shots.length) return; try { await makeOne(i); } catch (e) { failure = e; } } }));
  if (failure) return { ok: false, reason: failure instanceof Error ? failure.message : 'A clip could not be made.' };

  // 3. the words: only what the business's own information supports
  const lines = shots.map((s) => s.words.trim()); const last = shots.length - 1;
  const asConcept = { scenes: lines.map((w) => ({ headline: w, subtext: '', items: [] })) } as unknown as Concept;
  const flagged = new Set<number>([...unsupportedClaims(asConcept, args.facts).map((c) => c.scene), ...(await reviewClaims(asConcept, args.facts, args.complete).catch(() => [])).map((c) => c.scene)]);
  flagged.forEach((n) => { notes.push(`removed on-screen words that claimed something unsupported: "${lines[n - 1]}"`); lines[n - 1] = ''; });
  if (!lines[last]) lines[last] = idea.cta && !flagged.has(shots.length) ? idea.cta.split(/[.;]/)[0].slice(0, 60) : '';

  // 4. cut together, upscale, and lay the words over (fading in and out)
  const joined = path.join(args.workDir, 'joined.mp4'); await stitchClips(files, joined);
  const times: Array<[number, number]> = []; let clock = 0; for (const s of shots) { times.push([clock, clock + s.seconds]); clock += s.seconds; }
  const overlays: Array<{ file: string; a: number; b: number }> = [];
  for (let i = 0; i < shots.length; i += 1) {
    if (!lines[i]) continue; const kind = i === last ? 'cta' : i === 0 ? 'hook' : 'line';
    const file = path.join(args.workDir, `overlay-${i}.png`); await overlayPng(file, { words: lines[i], kind, name: args.business.name, accent: args.accent });
    overlays.push({ file, a: kind === 'cta' ? times[i][0] + 0.2 : times[i][0] + 0.35, b: times[i][1] - (kind === 'cta' ? 0 : 0.15) });
  }
  if (!overlays.some((o) => o.file.endsWith(`overlay-${last}.png`))) { const file = path.join(args.workDir, `overlay-${last}.png`); await overlayPng(file, { words: 'Learn more', kind: 'cta', name: args.business.name, accent: args.accent }); overlays.push({ file, a: times[last][0] + 0.2, b: times[last][1] }); }
  const total = clock;
  const inputs = ['-i', joined, ...overlays.flatMap((o) => ['-loop', '1', '-t', String(total), '-i', o.file])];
  const chain = overlays.map((o, k) => `[${k + 1}:v]format=rgba,fade=t=in:st=${o.a.toFixed(2)}:d=0.25:alpha=1,fade=t=out:st=${Math.max(o.a + 0.3, o.b - 0.25).toFixed(2)}:d=0.25:alpha=1[o${k}]`).join(';');
  let tail = '[base]'; const stages = ['[0:v]scale=1080:1920:flags=lanczos,setsar=1[base]']; overlays.forEach((_, k) => { stages.push(`${tail}[o${k}]overlay=0:0:format=auto:eof_action=pass[s${k}]`); tail = `[s${k}]`; });
  await run(['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${stages[0]};${chain};${stages.slice(1).join(';')}`, '-map', tail, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(total), args.outPath]);

  // 5. frames for the quality check
  const framePaths: string[] = [];
  for (let i = 0; i < shots.length; i += 1) { const f = path.join(args.workDir, `frame-${i}.png`); await run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(times[i][0] + shots[i].seconds * 0.6), '-i', args.outPath, '-frames:v', '1', '-vf', 'scale=360:-1', f]).then(() => framePaths.push(f)).catch(() => undefined); }
  return { ok: true, seconds: total, credits, shots: shots.map((s, i) => ({ beat: s.beat, seconds: s.seconds, still: s.still, motion: s.motion, words: lines[i], picture: stills[i].pic.label, origin: stills[i].origin })), notes, framePaths };
}

const CHECKER = 'You are the quality director for a short social-media ad made of AI-generated clips with words laid over them. You are given one frame from each shot, in order, and the shot list. Judge as an Instagram viewer and the business owner would. Report real problems only: distorted or melting objects, anything unrecognisable, text or logos or people appearing inside the footage, words hard to read or colliding, a shot that does not match its description, an ending that is weak, anything that would make the owner hesitate to post. Reply with ONLY JSON: {"publishable": true or false, "score": 1 to 10, "problems": ["each problem, with the shot number"], "verdict": "one sentence"}.';
export async function checkClipVideo(result: Extract<ClipResult, { ok: true }>, completeWithImages: (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }>): Promise<{ publishable: boolean; score: number; problems: string[]; verdict: string }> {
  const images = await Promise.all(result.framePaths.map((f) => readFile(f)));
  const reply = await completeWithImages(CHECKER, result.shots.map((s, i) => `${i + 1}. ${s.beat} (${s.seconds}s): ${s.still} | motion: ${s.motion} | words: ${s.words || 'none'}`).join('\n'), images).catch(() => ({ text: '' }));
  try { const b = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? '{}') as Record<string, unknown>; return { publishable: b.publishable === true, score: Math.max(1, Math.min(10, Math.round(Number(b.score) || 5))), problems: Array.isArray(b.problems) ? b.problems.map((p) => String(p).slice(0, 200)).slice(0, 8) : [], verdict: typeof b.verdict === 'string' ? b.verdict.slice(0, 200) : '' }; } catch { return { publishable: false, score: 5, problems: ['The quality check could not read the video.'], verdict: '' }; }
}
export type { Strategy };
