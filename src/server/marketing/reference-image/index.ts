import { readFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pruneReferences, referenceDir, referenceFile, ReferenceProblem, saveJson } from '../reference/shared.js';
import { measureImage, looksLikeImage, logoPrintOf, MAX_REFERENCE_IMAGE_BYTES } from './analyze.js';
import { describeDesign, summariseDesign, type ImageModel, type ReferenceImageAnalysis } from './style.js';

export { ReferenceProblem, looksLikeImage, MAX_REFERENCE_IMAGE_BYTES, summariseDesign };
export * from './style.js';

/**
 * Reference images. The uploaded picture is read once, on this server, and then deleted: only its measurements and the description of its DESIGN are kept
 * (a small JSON file in this business's own folder). It is a visual reference, not content: the picture itself is never drawn into anything Pilot makes.
 */
export async function loadReferenceImage(tenantId: string, id: string): Promise<ReferenceImageAnalysis | null> {
  try { const parsed = JSON.parse(await readFile(referenceFile(tenantId, id, 'image'), 'utf8')) as ReferenceImageAnalysis; return parsed?.id === id && parsed.style?.blueprint && parsed.measures ? parsed : null; } catch { return null; }
}

export async function analyseReferenceImage({ tenantId, bytes, fileName, model }: { tenantId: string; bytes: Buffer; fileName: string; model?: ImageModel }): Promise<ReferenceImageAnalysis> {
  const { measures, small, frame } = await measureImage(bytes);
  const style = await describeDesign(measures, small, model);
  // the reference's logo, as a tiny grey pattern (never the picture), so the finished picture can be checked for it
  const logoPrint = style.logo?.present ? logoPrintOf(frame, style.logo.position) ?? undefined : undefined;
  // for a split layout the page colour is read from the half that holds the words, not from the whole picture (the photo would colour it)
  const half = style.post?.structure === 'split' ? style.post.photo.position : null;
  if (half && ['left', 'right', 'top'].includes(half)) { const { colourRoles } = await import('../reference/colour.js'); const R = 96; const out = new Uint8ClampedArray(R * R * 4); const x0 = half === 'left' ? 0.5 : 0; const x1 = half === 'right' ? 0.5 : 1; const y0 = half === 'top' ? 0.5 : 0; const y1 = 1;
    for (let r = 0; r < R; r += 1) for (let q = 0; q < R; q += 1) { const sx = Math.min(frame.width - 1, Math.floor((x0 + (x1 - x0) * (q / R)) * frame.width)); const sy = Math.min(frame.height - 1, Math.floor((y0 + (y1 - y0) * (r / R)) * frame.height)); const si = (sy * frame.width + sx) * 4; const di = (r * R + q) * 4; out[di] = frame.rgba[si]; out[di + 1] = frame.rgba[si + 1]; out[di + 2] = frame.rgba[si + 2]; out[di + 3] = 255; }
    measures.pageRoles = colourRoles(out, R); }
  const analysis: ReferenceImageAnalysis = { ...(logoPrint ? { logoPrint } : {}), id: randomUUID(), fileName: fileName.replace(/[^\w .()-]/g, '').slice(0, 80) || 'reference image', createdAt: new Date().toISOString(), measures, style };
  await mkdir(referenceDir(tenantId), { recursive: true }); await saveJson(referenceFile(tenantId, analysis.id, 'image'), analysis); await pruneReferences(tenantId, 'image');
  return analysis;
}

// ---- the design session: what Pilot is making from the reference, kept so follow-up changes keep the reference's design ----------------------------------

import type { Blueprint } from './style.js';
import type { ImageDesignBlueprint } from './blueprint.js';
export type Copy = { headline: string; subline: string; cta: string };
export type DesignSession = {
  /** set when the post was made by the post designer from the reference's style: the style followed (see post-design/style.ts) and the shape of the post */ postStyle?: import('../post-design/style.js').PostStyle; originalPostStyle?: import('../post-design/style.js').PostStyle; postAspect?: '1:1' | '4:5' | '9:16';
  referenceId: string; /** the structured design blueprint made from the reference (palette, floor, light, forbidden text); the drawable layout is `blueprint` */ design?: ImageDesignBlueprint; /** the ready-made illustration standing in for the product when there is no photo of it (a drawing, not the business's own work) */ drawnKind?: string | null; /** where the picture of the product came from */ productMode?: 'own_photo' | 'generated_image' | 'drawn_product'; /** the design as it came from the reference (for "go back to the original look") */ original: Blueprint; blueprint: Blueprint; copy: Copy; request: string; subject: string;
  photoId: string | null; photoLabel: string | null; itemId: string; imageId: string; platform: string; createdAt: string; updatedAt: string;
};
const sessionFile = (tenantId: string) => path.join(referenceDir(tenantId), 'design-session.json');
export async function saveDesignSession(tenantId: string, session: DesignSession): Promise<void> { await saveJson(sessionFile(tenantId), session); }
export async function loadDesignSession(tenantId: string, maxAgeMinutes = 180): Promise<DesignSession | null> {
  try { const s = JSON.parse(await readFile(sessionFile(tenantId), 'utf8')) as DesignSession; return s?.blueprint && Date.now() - Date.parse(s.updatedAt) < maxAgeMinutes * 60_000 ? s : null; } catch { return null; }
}
export const clearDesignSession = async (tenantId: string) => rm(sessionFile(tenantId), { force: true }).catch(() => undefined);
