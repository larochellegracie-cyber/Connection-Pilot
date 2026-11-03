import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { stems } from './asset-selection.js';
import { codeVideoSupport, RUNTIME_DIR } from './code-video/sandbox.js';
import type { AssetMeta, MediaStorage } from './standard-video/storage.js';

const run = promisify(execFile);

/**
 * Visual awareness for the creative model. Before a video is storyboarded, the business's pictures are looked at, once, so the model chooses by what is IN them, not by their file labels.
 *
 *  1. RETRIEVE every picture the business has, and tell them apart by where they came from (deterministic, free, from the metadata): an upload of the owner's own, a photo from their website, a product
 *     photo, an AI-generated image, Pilot's own abstract artwork, a logo.
 *  2. SHORTLIST: the pictures whose words match the request first, then the rest (own pictures before generated ones, newest first), at most MAX_REVIEW. A picture whose label says nothing ("photo 4")
 *     is never dropped for that alone, because it may be exactly right.
 *  3. LOOK: ONE call with ONE small contact sheet (every candidate in a lettered cell) and the request. The model says what each picture really shows, how well it suits the request and how good it is,
 *     how it should be used (hero, support, background, branding, skip), where its subject is, and which one is the hero (or none).
 *  4. ENFORCE in code, so the model cannot be talked into a bad choice: Pilot's abstract artwork is never a photograph or a hero, a logo is branding and never a hero, and a hero must be a realistic picture
 *     that is relevant and good enough. If the model's pick is not allowed, the best allowed one is used, or none.
 * Without a model, a Python install, or when the sheet cannot be made, the review is made from the metadata alone (same enforcement), and says so.
 */
export type Provenance = 'own_upload' | 'website' | 'product_photo' | 'ai_image' | 'pilot_artwork' | 'logo';
export type PictureKind = 'real_photo' | 'ai_image' | 'graphic' | 'abstract' | 'screenshot' | 'logo' | 'other';
export type BestUse = 'hero' | 'support' | 'background' | 'branding' | 'skip';
export type AssetFacts = { id: string; label: string; provenance: Provenance; kind: PictureKind; /** what is really in the picture */ shows: string; /** how well it shows what the request is about, 0-10 */ relevance: number; /** sharpness, light, composition, size for a vertical video, 0-10 */ quality: number; best_use: BestUse; /** where its main subject is (0..1 across, 0..1 down) */ focus?: { x: number; y: number }; width: number; height: number };
export type AssetReview = { assets: AssetFacts[]; hero: { id: string; label: string; reason: string } | null; logo: { id: string; label: string } | null; /** how many pictures the business has, and how many were looked at */ considered: number; reviewed: number; /** 'vision': the model looked at the pictures; 'metadata': decided from labels and provenance alone */ source: 'vision' | 'metadata'; note: string };

export const MAX_REVIEW = 8;
const PRIORITY: Provenance[] = ['own_upload', 'product_photo', 'website', 'ai_image', 'pilot_artwork', 'logo'];

/** Where a picture came from, from its metadata. */
export function provenanceOf(meta: Pick<AssetMeta, 'kind' | 'tags'>): Provenance {
  if (meta.kind === 'logo') return 'logo';
  if (meta.tags.includes('generated')) return meta.tags.includes('ai-image') ? 'ai_image' : 'pilot_artwork';
  if (meta.tags.includes('website')) return 'website';
  return meta.kind === 'product' ? 'product_photo' : 'own_upload';
}
/** Pictures that can be the main visual of a video about the subject (a real or realistic picture, never abstract art, a graphic or a logo). */
const REALISTIC: PictureKind[] = ['real_photo', 'ai_image'];

/** Step 2: which pictures are looked at. Word matches first, then the rest, own before generated, newest first. Logos are never looked at. */
export function shortlist(assets: AssetMeta[], topic: string, max = MAX_REVIEW): AssetMeta[] {
  const wanted = stems(topic);
  const score = (asset: AssetMeta) => { const have = new Set(stems(`${asset.label} ${asset.description} ${asset.tags.join(' ')}`)); return wanted.filter((word) => have.has(word)).length; };
  return assets.filter((asset) => asset.kind !== 'logo')
    .map((asset) => ({ asset, score: score(asset), rank: PRIORITY.indexOf(provenanceOf(asset)) }))
    .sort((a, b) => (b.score > 0 ? 1 : 0) - (a.score > 0 ? 1 : 0) || b.score - a.score || a.rank - b.rank || b.asset.createdAt.localeCompare(a.asset.createdAt))
    .slice(0, max).map((entry) => entry.asset);
}

const clamp = (value: unknown, lo: number, hi: number, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback; };
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const KINDS: PictureKind[] = ['real_photo', 'ai_image', 'graphic', 'abstract', 'screenshot', 'logo', 'other'];
const USES: BestUse[] = ['hero', 'support', 'background', 'branding', 'skip'];

/** What the metadata alone allows a picture to be: Pilot's artwork is abstract art, a logo is a logo, and an AI image is an AI image, whatever the model says. */
function enforceKind(provenance: Provenance, said: PictureKind): PictureKind {
  if (provenance === 'logo') return 'logo';
  if (provenance === 'pilot_artwork') return said === 'graphic' ? 'graphic' : 'abstract';
  if (provenance === 'ai_image') return said === 'abstract' || said === 'graphic' ? said : 'ai_image';
  return said === 'ai_image' && provenance !== 'own_upload' ? 'real_photo' : said;
}

/** Step 4: the model's reply (letters A, B, C...) turned into facts about real pictures, with the rules enforced. */
export function sanitizeReview(raw: unknown, lettered: AssetMeta[], all: AssetMeta[], reviewedCount: number): AssetReview {
  const body = (raw && typeof raw === 'object' ? raw : {}) as { assets?: unknown; hero?: unknown; reason?: unknown };
  const byLetter = new Map(lettered.map((asset, i) => [String.fromCharCode(65 + i), asset]));
  const facts: AssetFacts[] = [];
  for (const entry of Array.isArray(body.assets) ? body.assets : []) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const asset = byLetter.get(text(e.id, 3).toUpperCase()); if (!asset || facts.some((fact) => fact.id === asset.id)) continue;
    const provenance = provenanceOf(asset);
    const said = (KINDS as string[]).includes(String(e.kind)) ? (e.kind as PictureKind) : 'other';
    const kind = enforceKind(provenance, said);
    const focus = e.focus && typeof e.focus === 'object' ? { x: clamp((e.focus as Record<string, unknown>).x, 0, 1, 0.5), y: clamp((e.focus as Record<string, unknown>).y, 0, 1, 0.5) } : undefined;
    let use = (USES as string[]).includes(String(e.best_use)) ? (e.best_use as BestUse) : 'support';
    if (!REALISTIC.includes(kind) && use === 'hero') use = kind === 'logo' ? 'branding' : 'background';
    if (kind === 'logo') use = 'branding';
    facts.push({ id: asset.id, label: asset.label, provenance, kind, shows: text(e.shows, 140) || asset.label, relevance: clamp(e.relevance, 0, 10, 0), quality: clamp(e.quality, 0, 10, 5), best_use: use, ...(focus ? { focus } : {}), width: asset.width, height: asset.height });
  }
  for (const asset of lettered) if (!facts.some((fact) => fact.id === asset.id)) facts.push({ id: asset.id, label: asset.label, provenance: provenanceOf(asset), kind: enforceKind(provenanceOf(asset), 'other'), shows: asset.label, relevance: 0, quality: 5, best_use: 'skip', width: asset.width, height: asset.height });
  const allowed = (fact: AssetFacts) => REALISTIC.includes(fact.kind) && fact.relevance >= 6 && fact.quality >= 5 && fact.best_use !== 'skip' && fact.best_use !== 'branding';
  const picked = byLetter.get(text(body.hero, 3).toUpperCase());
  let hero = picked ? facts.find((fact) => fact.id === picked.id && allowed(fact)) : undefined; let reason = text(body.reason, 200);
  if (!hero) {
    const best = facts.filter(allowed).sort((a, b) => b.relevance * 2 + b.quality + (b.provenance === 'ai_image' ? 0 : 1.5) - (a.relevance * 2 + a.quality + (a.provenance === 'ai_image' ? 0 : 1.5)))[0];
    hero = best; reason = best ? (picked ? `The first choice was not usable as the main visual, so “${best.label}” is used: ${best.shows}.` : reason || `“${best.label}” shows ${best.shows}.`) : '';
  }
  const logo = all.find((asset) => asset.kind === 'logo');
  return { assets: facts, hero: hero ? { id: hero.id, label: hero.label, reason } : null, logo: logo ? { id: logo.id, label: logo.label } : null, considered: all.length, reviewed: reviewedCount, source: 'vision', note: hero ? `Main visual: “${hero.label}”. ${reason}` : `None of the ${facts.length} pictures looked at is a good main visual for this request.${reason ? ` ${reason}` : ''}` };
}

/** The review from metadata alone: provenance and words, with the same rules. */
export function metadataReview(assets: AssetMeta[], topic: string, why: string): AssetReview {
  const picked = shortlist(assets, topic); const wanted = stems(topic);
  const facts: AssetFacts[] = picked.map((asset) => {
    const provenance = provenanceOf(asset); const have = new Set(stems(`${asset.label} ${asset.description} ${asset.tags.join(' ')}`)); const hits = wanted.filter((word) => have.has(word)).length;
    const kind = enforceKind(provenance, provenance === 'ai_image' ? 'ai_image' : 'real_photo');
    return { id: asset.id, label: asset.label, provenance, kind, shows: asset.description || asset.label, relevance: Math.min(10, hits * 3), quality: Math.min(asset.width, asset.height) >= 700 ? 6 : 4, best_use: REALISTIC.includes(kind) && hits > 0 ? 'support' : 'skip', width: asset.width, height: asset.height };
  });
  const best = facts.filter((fact) => REALISTIC.includes(fact.kind) && fact.relevance >= 3).sort((a, b) => b.relevance - a.relevance)[0];
  if (best) best.best_use = 'hero';
  const logo = assets.find((asset) => asset.kind === 'logo');
  return { assets: facts, hero: best ? { id: best.id, label: best.label, reason: 'Chosen by its label and description (the pictures were not looked at).' } : null, logo: logo ? { id: logo.id, label: logo.label } : null, considered: assets.length, reviewed: 0, source: 'metadata', note: `${why} ${best ? `Main visual by label: “${best.label}”.` : 'No picture matches by label.'}` };
}

const SYSTEM = `You are Pilot's art buyer for a small business's marketing. You are shown ONE contact sheet of candidate pictures, each in a cell with a blue letter. For every picture say what it REALLY shows and how well it suits the request. Be strict and literal: judge only what you can see.
Provenance is given for each letter and is reliable: "pilot_artwork" is abstract art drawn by Pilot (never a photograph of the real thing), "ai_image" is AI-generated, "own_upload", "website" and "product_photo" are the business's own pictures.
Reply with ONLY JSON: {"assets": [{"id": "A", "kind": "real_photo" | "ai_image" | "graphic" | "abstract" | "screenshot" | "logo" | "other", "shows": "up to 15 plain words saying what is visible", "relevance": 0-10 (how clearly it shows what the request is about; 0 if it is unrelated), "quality": 0-10 (sharp, well lit, well composed, big enough for a vertical video), "best_use": "hero" | "support" | "background" | "branding" | "skip", "focus": {"x": 0-1 across, "y": 0-1 down, where its main subject is}}], "hero": "a letter, or null", "reason": "one plain sentence"}.
A hero is the one picture that should carry the video: it must clearly show the request's subject, and be a picture that suits the video (a real photo, or an AI image in any intentional style such as cinematic, 3D or illustrated), sharp and well lit. If no picture does, hero is null and say why (for example: the only candidates are abstract art, or show something else). Logos are "branding". Unrelated pictures are "skip".`;

async function contactSheet({ lettered, storage, tenantId, dir }: { lettered: AssetMeta[]; storage: MediaStorage; tenantId: string; dir: string }): Promise<Buffer | null> {
  const support = await codeVideoSupport(); if (!support.python) return null;
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (const [i, asset] of lettered.entries()) { const stored = await storage.openAsset(tenantId, asset.id); if (!stored) return null; const file = path.join(dir, `c${i}`); await writeFile(file, await stored.read()); files.push(file); }
  const fontDir = path.join(path.dirname(nodeModule.createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
  const out = path.join(dir, 'sheet.jpg'); const columns = Math.min(4, lettered.length);
  await run(support.python, ['-I', path.join(RUNTIME_DIR, 'pilot_sheet.py'), out, fontDir, '340', '420', String(columns), ...files], { timeout: 60_000, env: {} });
  return readFile(out);
}

export type ReviewInput = { tenantId: string; /** what the owner asked for, in their words */ request: string; subject: string; assets: AssetMeta[]; storage: MediaStorage; workDir: string; completeWithImages?: (system: string, prompt: string, images: Buffer[]) => Promise<{ text: string }> };

/** Retrieve, shortlist, look once, enforce. Never throws: any trouble gives the metadata-only review. */
export async function reviewAssets({ tenantId, request, subject, assets, storage, workDir, completeWithImages }: ReviewInput): Promise<AssetReview> {
  const topic = `${subject} ${request}`;
  if (!assets.some((asset) => asset.kind !== 'logo')) return metadataReview(assets, topic, 'The business has no pictures yet.');
  if (!completeWithImages) return metadataReview(assets, topic, 'No model was available to look at the pictures.');
  const lettered = shortlist(assets, topic);
  const dir = path.join(workDir, 'asset-review');
  try {
    const sheet = await contactSheet({ lettered, storage, tenantId, dir });
    if (!sheet) return metadataReview(assets, topic, 'The pictures could not be laid out to look at.');
    const lines = lettered.map((asset, i) => `${String.fromCharCode(65 + i)}: provenance ${provenanceOf(asset)}; owner's label “${asset.label}”${asset.description ? `; description “${asset.description.slice(0, 120)}”` : ''}; ${asset.width}x${asset.height}`).join('\n');
    const reply = await completeWithImages(SYSTEM, `THE REQUEST\n"${request.slice(0, 400)}"\nSubject: ${subject}\n\nTHE PICTURES (letters match the sheet)\n${lines}`, [sheet]);
    const parsed = JSON.parse(/\{[\s\S]*\}/.exec(reply.text)?.[0] ?? '');
    return sanitizeReview(parsed, lettered, assets, lettered.length);
  } catch (error) {
    return metadataReview(assets, topic, `Looking at the pictures failed (${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}).`);
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}
