import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getMediaStorage } from '../standard-video/storage.js';
import { frameSheets, rgbaFrame, measureReference, type ReferenceMeasures } from './analyze.js';
import { printFromRgba, type LogoPrint } from './logo.js';
import { pruneReferences, referenceDir, referenceFile, ReferenceProblem, saveJson } from './shared.js';
import { describeAnalysis, describeStyle, pacingOf, type ReferenceAnalysis, type SheetModel } from './style.js';

export { ReferenceProblem };
export * from './style.js';

/**
 * Reference videos. The uploaded video is read once, on this server, and then deleted: only its measured structure and the description of its style are
 * kept (a small JSON file in this business's own folder, up to ten of them). Nothing of the reference's pictures, words or sound is kept or reused.
 */
export const MAX_REFERENCE_BYTES = 80 * 1024 * 1024;

/** The first bytes of an MP4/MOV ("ftyp"), WebM/MKV (EBML) or AVI; anything else is refused whatever its name says. */
export function looksLikeVideo(bytes: Buffer): boolean {
  if (bytes.length < 16) return false;
  if (bytes.subarray(4, 8).toString('latin1') === 'ftyp') return true;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'AVI ';
}

const fileFor = (tenantId: string, id: string) => referenceFile(tenantId, id, 'video');

export async function loadReference(tenantId: string, id: string): Promise<ReferenceAnalysis | null> {
  try { const parsed = JSON.parse(await readFile(fileFor(tenantId, id), 'utf8')) as ReferenceAnalysis; return parsed?.id === id && parsed.style && parsed.measures ? parsed : null; } catch { return null; }
}

export type AnalyseInput = { tenantId: string; bytes: Buffer; fileName: string; model?: SheetModel; transcribe?: boolean };

/** Reads an uploaded reference video and keeps what it taught Pilot. The video itself is deleted before this returns. */
export async function analyseReference({ tenantId, bytes, fileName, model, transcribe }: AnalyseInput): Promise<ReferenceAnalysis> {
  if (!looksLikeVideo(bytes)) throw new ReferenceProblem('That doesn’t look like a video file. Please upload an MP4 or MOV.');
  if (bytes.length > MAX_REFERENCE_BYTES) throw new ReferenceProblem('That video is larger than 80 MB. Please upload a shorter or smaller one.');
  const storage = getMediaStorage(); const id = randomUUID();
  const dir = await storage.makeTempDir(`ref-${id.slice(0, 12)}`);
  try {
    const file = path.join(dir, 'reference.bin'); await writeFile(file, bytes, { mode: 0o600 });
    const measures: ReferenceMeasures = await measureReference(file, path.join(dir, 'frames'), { transcribe });
    const style = await describeStyle(measures, await frameSheets(measures.segments, dir), model);
    // the reference's logo: only a fingerprint of the place it sits is kept (never the picture), so a finished video can be checked for it
    let logoPrint: LogoPrint | undefined;
    if (style.logo?.present && measures.segments[0]) { try { const seg = measures.segments[0]; const rgba = await rgbaFrame(file, (seg.start + seg.end) / 2); if (rgba.length >= 540 * 960 * 4) logoPrint = printFromRgba(rgba, 540, 960, style.logo.position) ?? undefined; } catch { /* no pattern: the other protections still apply */ } }
    const analysis: ReferenceAnalysis = {
      ...(logoPrint ? { logoPrint } : {}), id, fileName: fileName.replace(/[^\w .()-]/g, '').slice(0, 80) || 'reference video', createdAt: new Date().toISOString(),
      measures: { ...measures, segments: measures.segments.map(({ frame: _frame, ...rest }) => rest) }, style, pacing: pacingOf(measures), averageSceneSeconds: measures.seconds / Math.max(1, measures.segments.length),
    };
    await mkdir(referenceDir(tenantId), { recursive: true }); await saveJson(fileFor(tenantId, id), analysis); await pruneReferences(tenantId, 'video');
    return analysis;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}

export const summarise = (analysis: ReferenceAnalysis) => describeAnalysis(analysis);
