import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { ReferenceProblem } from './shared.js';
import { measurePixels } from '../reference-image/analyze.js';
import { aggregateRoles, colourRoles, type ColourRoles } from './colour.js';

/**
 * Reads a reference video the owner uploaded and measures how it is made: how long it is, where it cuts, how fast things move, how bright it is,
 * its colours, and whether it has sound or speech. This is plain measuring with FFmpeg (free, nothing leaves the server). What the video looks like in
 * words (layouts, text treatment, feel) is described separately from its key frames (see style.ts). Nothing about the reference's own words, brand or
 * pictures is kept: only its structure.
 */
/** Where things are in a part, measured from three frames (near its start, middle and end): the centre of the main detail and how far it spreads, the calmest band for words, and how far the detail moved. */
export type Geometry = { /** the colours of this part by role (backdrop, floor, light, hero, accent, text) and their shares */ colours?: ColourRoles; subject: { x: number; y: number; spread: number }; calmest: 'top' | 'middle' | 'bottom'; placement: string; drift: { dx: number; dy: number }; /** how much the main detail grows (above 1) or shrinks (below 1) from the start of the part to its end: a camera push in or pull out */ zoom: number; /** how busy the part is over time, 8 steps, 1 = its average */ activity: number[]; /** where light sits: the brightest third of the picture */ glowAt: 'top' | 'middle' | 'bottom' };
/** how this shot begins: a hard cut or a dissolve (measured from the picture across the change) */ export type Boundary = 'cut' | 'dissolve';
export type Segment = { /** how this shot begins (the first shot has none) */ boundary?: Boundary; index: number; start: number; end: number; seconds: number; brightness: number; /** average change from frame to frame, 0 (still) to 100 */ motion: number; colours: string[]; frame: string; geometry?: Geometry };
import { boundaryKind, lookFromFrames, type VideoLook } from './look.js';
export type ReferenceMeasures = {
  /** the look measured from the pictures: colour, contrast, tint, vignette, bars, grain */ look?: VideoLook;
  seconds: number; width: number; height: number; fps: number; vertical: boolean; hasAudio: boolean; meanVolumeDb: number | null;
  cuts: number[]; segments: Segment[];
  /** the colours of the whole video by role, with the share each fills and the warmth of its light */ colourRoles?: ColourRoles;
  /** words spoken per minute, when speech could be counted (needs an OpenAI key); null when not measured */ speechWordsPerMinute: number | null;
};

export const MAX_REFERENCE_SECONDS = 120;
const MAX_SEGMENTS = 12;

export { ReferenceProblem };

function run(args: string[], { collect = 'stderr', timeoutMs = 120_000, input }: { collect?: 'stderr' | 'stdout'; timeoutMs?: number; input?: Buffer } = {}): Promise<{ out: Buffer; err: string; code: number | null }> {
  const binary = ffmpegPath(); if (!binary) return Promise.reject(new ReferenceProblem('Pilot can’t read videos on this server yet (FFmpeg is missing).'));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-nostdin', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = []; let err = ''; let size = 0;
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new ReferenceProblem('That video took too long to read.')); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => { if (collect === 'stdout' && size < 40_000_000) { out.push(chunk); size += chunk.length; } });
    child.stderr.on('data', (chunk: Buffer) => { err = (err + chunk.toString()).slice(-400_000); });
    child.stdin.on('error', () => undefined); child.stdin.end(input);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ out: Buffer.concat(out), err, code }); });
  });
}

export async function probe(file: string) {
  const { err } = await run(['-i', file]);
  const duration = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err);
  const video = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*/.exec(err);
  if (!duration || !video) throw new ReferenceProblem('Pilot couldn’t read that file as a video. Please upload an MP4 or MOV.');
  const fps = Number(/(\d+(?:\.\d+)?)\s*fps/.exec(video[0])?.[1] ?? 30);
  const rotated = /rotate\s*:\s*(?:90|270)/i.test(err) || /displaymatrix: rotation of (?:-?90|-?270)/i.test(err);
  let width = Number(video[1]); let height = Number(video[2]); if (rotated) [width, height] = [height, width];
  return { seconds: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]), width, height, fps: Math.min(120, Math.max(1, fps)), hasAudio: /Stream #[^\n]*Audio:/.test(err) };
}

/** Times where the picture changes completely (a cut), from FFmpeg's scene detector. Cuts closer than 0.7 s are one cut. */
async function detectCuts(file: string, seconds: number): Promise<number[]> {
  const { err } = await run(['-i', file, '-an', '-vf', "scale=160:-2,select='gt(scene,0.32)',showinfo", '-f', 'null', '-'], { timeoutMs: 180_000 });
  const times = [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((time) => time > 0.5 && time < seconds - 0.5);
  const cuts: number[] = [];
  for (const time of times.sort((a, b) => a - b)) if (!cuts.length || time - cuts[cuts.length - 1] >= 0.7) cuts.push(Math.round(time * 100) / 100);
  return cuts;
}

/** How much the picture changes from frame to frame over time (a measure of motion), sampled six times a second. */
async function motionSamples(file: string): Promise<Array<{ t: number; v: number }>> {
  const { out } = await run(['-i', file, '-an', '-vf', 'fps=6,scale=96:-2,tblend=all_mode=difference,signalstats,metadata=print:file=-', '-f', 'null', '-'], { collect: 'stdout', timeoutMs: 180_000 });
  const samples: Array<{ t: number; v: number }> = []; let t = 0;
  for (const line of out.toString().split('\n')) {
    const time = /pts_time:([\d.]+)/.exec(line); if (time) t = Number(time[1]);
    const value = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line); if (value) samples.push({ t, v: Number(value[1]) });
  }
  return samples;
}

async function pixels(file: string, at: number): Promise<Buffer> {
  const { out } = await run(['-ss', String(at), '-i', file, '-frames:v', '1', '-an', '-vf', 'scale=24:24:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { collect: 'stdout', timeoutMs: 30_000 });
  return out;
}

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** The average brightness (0 to 1) and up to three dominant colours of a small picture. Near-white and near-black are reported only when nothing else is there. */
export function colourFacts(rgb: Buffer): { brightness: number; colours: string[] } {
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>(); let luma = 0; const count = Math.floor(rgb.length / 3);
  for (let i = 0; i < count; i += 1) {
    const r = rgb[i * 3]; const g = rgb[i * 3 + 1]; const b = rgb[i * 3 + 2]; luma += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const key = `${r >> 6}${g >> 6}${b >> 6}`; const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1; bucket.r += r; bucket.g += g; bucket.b += b; buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).map((bucket) => hex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n));
  return { brightness: count ? luma / count : 0.5, colours: ranked.slice(0, 3) };
}

async function pixelsRgba(file: string, at: number): Promise<Buffer> {
  const { out } = await run(['-ss', String(at), '-i', file, '-frames:v', '1', '-an', '-vf', 'scale=64:64:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { collect: 'stdout', timeoutMs: 30_000 });
  return out;
}

/** The layout facts of one part, from frames near its start, middle and end plus the motion samples inside it. */
export async function segmentGeometry(file: string, start: number, end: number, samples: Array<{ t: number; v: number }>, size: { width: number; height: number }): Promise<Geometry | undefined> {
  try {
    const at = [0.15, 0.55, 0.85].map((f) => start + (end - start) * f);
    const lastRgba: Buffer[] = [];
    const frames = await Promise.all(at.map(async (time, i) => { const rgba = await pixelsRgba(file, time); lastRgba[i] = rgba; return rgba.length >= 64 * 64 * 4 ? measurePixels(rgba, 64, size.width, size.height) : null; }));
    const [a, b, c] = frames; const mid = b ?? a ?? c; if (!mid) return undefined;
    const midIndex = b ? 1 : a ? 0 : 2; const roles = colourRoles(midIndex === 1 ? lastRgba[1] : midIndex === 0 ? lastRgba[0] : lastRgba[2], 64);
    const last = c ?? mid; const first = a ?? mid;
    const lum = mid.grid.map((g) => g.luminance); const rows = [0, 1, 2].map((r) => (lum[r * 3] + lum[r * 3 + 1] + lum[r * 3 + 2]) / 3);
    const inside = samples.filter((s) => s.t >= start && s.t < end); const avg = inside.length ? inside.reduce((sum, s) => sum + s.v, 0) / inside.length : 0;
    const activity = Array.from({ length: 8 }, (_, i) => { const lo = start + ((end - start) * i) / 8; const hi = start + ((end - start) * (i + 1)) / 8; const part = inside.filter((s) => s.t >= lo && s.t < hi); const v = part.length ? part.reduce((sum, s) => sum + s.v, 0) / part.length : 0; return avg > 0 ? Math.round((v / avg) * 100) / 100 : 1; });
    return { colours: roles, subject: mid.subject, calmest: mid.calmest, placement: mid.placement, drift: { dx: Math.round((last.subject.x - first.subject.x) * 100) / 100, dy: Math.round((last.subject.y - first.subject.y) * 100) / 100 }, zoom: Math.round((last.subject.spread / Math.max(0.02, first.subject.spread)) * 100) / 100, activity, glowAt: (['top', 'middle', 'bottom'] as const)[rows.indexOf(Math.max(...rows))] };
  } catch { return undefined; }
}

async function volume(file: string): Promise<number | null> {
  const { err } = await run(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
  const mean = /mean_volume:\s*(-?[\d.]+)/.exec(err);
  return mean ? Number(mean[1]) : null;
}

/** Counts the words spoken (never keeps them) so Pilot knows whether the reference has a voiceover and how fast it talks. Optional: needs an OpenAI key. */
export async function speechRate(file: string, seconds: number, fetcher: typeof fetch = fetch): Promise<number | null> {
  const key = process.env.OPENAI_API_KEY?.trim(); if (!key) return null;
  try {
    const { out } = await run(['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'mp3', '-'], { collect: 'stdout', timeoutMs: 60_000 });
    if (out.length < 2000 || out.length > 24_000_000) return null;
    const form = new FormData(); form.append('model', 'gpt-4o-mini-transcribe'); form.append('response_format', 'json'); form.append('file', new Blob([new Uint8Array(out)], { type: 'audio/mpeg' }), 'audio.mp3');
    const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(90_000) });
    if (!response.ok) return null;
    const words = ((await response.json()) as { text?: string }).text?.trim().split(/\s+/).filter(Boolean).length ?? 0;
    return words >= 8 ? Math.round((words / Math.max(1, seconds)) * 60) : 0;
  } catch { return null; }
}

/** Joins the shortest neighbouring pieces until there are at most `max`. */
function limit(bounds: number[], max: number): number[] {
  const points = [...bounds];
  while (points.length - 1 > max) {
    let at = 1; let least = Infinity;
    for (let i = 1; i < points.length - 1; i += 1) { const joined = points[i + 1] - points[i - 1]; if (joined < least) { least = joined; at = i; } }
    points.splice(at, 1);
  }
  return points;
}

/** Measures a reference video. `frames` is a folder for the key frames (one JPEG per segment), which the style step then looks at. */
export async function measureReference(file: string, frames: string, { transcribe = true }: { transcribe?: boolean } = {}): Promise<ReferenceMeasures> {
  const info = await probe(file);
  if (info.seconds < 3) throw new ReferenceProblem('That video is too short to learn a style from. Please use one that is at least 3 seconds.');
  if (info.seconds > MAX_REFERENCE_SECONDS) throw new ReferenceProblem(`That video is longer than ${MAX_REFERENCE_SECONDS} seconds. Please upload a shorter one (or a clip of it).`);
  await mkdir(frames, { recursive: true });
  const [cuts, motion, meanVolumeDb, speech] = await Promise.all([detectCuts(file, info.seconds), motionSamples(file), info.hasAudio ? volume(file) : Promise.resolve(null), info.hasAudio && transcribe ? speechRate(file, info.seconds) : Promise.resolve(null)]);
  // with few or no cuts (one continuous screen recording), the video is read in equal parts instead
  let bounds = [0, ...cuts, info.seconds];
  if (bounds.length - 1 < 3) { const parts = Math.min(6, Math.max(3, Math.round(info.seconds / 4))); bounds = Array.from({ length: parts + 1 }, (_, i) => Math.round((info.seconds * i / parts) * 100) / 100); }
  bounds = limit(bounds, MAX_SEGMENTS);
  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i]; const end = bounds[i + 1]; const mid = start + (end - start) * 0.55;
    const frame = path.join(frames, `frame-${i + 1}.jpg`);
    await run(['-y', '-ss', String(mid), '-i', file, '-frames:v', '1', '-an', '-vf', 'scale=270:-2', '-q:v', '4', frame], { timeoutMs: 30_000 });
    const facts = colourFacts(await pixels(file, mid));
    const geometry = await segmentGeometry(file, start, end, motion, { width: info.width, height: info.height });
    const inside = motion.filter((sample) => sample.t >= start && sample.t < end);
    segments.push({ index: i + 1, start, end, seconds: Math.round((end - start) * 10) / 10, brightness: Math.round(facts.brightness * 100) / 100, motion: inside.length ? Math.round((inside.reduce((sum, s) => sum + s.v, 0) / inside.length) * 10) / 10 : 0, colours: facts.colours, frame, ...(geometry ? { geometry } : {}) });
  }
  // the look of the whole video, and how each shot begins
  let look: VideoLook | undefined;
  try { const times = [0.12, 0.35, 0.6, 0.85].map((f) => Math.min(info.seconds - 0.2, Math.max(0.1, info.seconds * f))); const grabbed = await Promise.all(times.map((t) => rgbaFrame(file, t))); look = lookFromFrames(grabbed.filter((g) => g.length >= 540 * 960 * 4).map((rgba) => ({ rgba, width: 540, height: 960 }))); } catch { look = undefined; }
  for (let i = 1; i < segments.length; i += 1) { try { segments[i].boundary = boundaryKind(await boundaryDiffs(file, segments[i].start)); } catch { /* left unset */ } }
  const colourRolesAll = aggregateRoles(segments.map((s) => s.geometry?.colours).filter((c): c is ColourRoles => !!c));
  return { ...(look ? { look } : {}), ...(colourRolesAll ? { colourRoles: colourRolesAll } : {}), seconds: Math.round(info.seconds * 10) / 10, width: info.width, height: info.height, fps: Math.round(info.fps), vertical: info.height >= info.width, hasAudio: info.hasAudio, meanVolumeDb, cuts, segments, speechWordsPerMinute: info.hasAudio ? speech : null };
}

/** Mean change between consecutive small grey frames across a moment of change (20 per second, a third of a second either side). */
async function boundaryDiffs(file: string, at: number): Promise<number[]> {
  const W = 32; const H = 56; const { out } = await run(['-ss', String(Math.max(0, at - 0.35)), '-i', file, '-t', '0.7', '-an', '-vf', `fps=20,scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { collect: 'stdout', timeoutMs: 30_000 });
  const frames = Math.floor(out.length / (W * H)); const diffs: number[] = []; for (let f = 1; f < frames; f += 1) { let d = 0; for (let i = 0; i < W * H; i += 1) d += Math.abs(out[f * W * H + i] - out[(f - 1) * W * H + i]); diffs.push(d / (W * H)); } return diffs;
}

/** Puts the key frames side by side in sheets of up to four, for the model to look at. */
/** A video's frame at `time`, scaled to 540 x 960 RGBA bytes (the size finished videos are searched at). */
export async function rgbaFrame(file: string, time: number): Promise<Buffer> { const { out } = await run(['-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=540:960:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { collect: 'stdout', timeoutMs: 30_000 }); return out; }

export async function frameSheets(segments: Segment[], dir: string): Promise<Buffer[]> {
  const sheets: Buffer[] = [];
  for (let i = 0; i < segments.length; i += 4) {
    const group = segments.slice(i, i + 4); const out = path.join(dir, `sheet-${i / 4 + 1}.jpg`);
    const inputs = group.flatMap((segment) => ['-i', segment.frame]);
    await run(['-y', ...inputs, '-filter_complex', `${group.map((_, k) => `[${k}:v]scale=270:480:force_original_aspect_ratio=decrease,pad=270:480:(ow-iw)/2:(oh-ih)/2:color=black[v${k}]`).join(';')};${group.map((_, k) => `[v${k}]`).join('')}hstack=inputs=${group.length}`, '-frames:v', '1', '-q:v', '4', out], { timeoutMs: 30_000 });
    sheets.push(await readFile(out));
  }
  return sheets;
}

export { saveJson } from './shared.js';
