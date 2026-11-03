import { randomUUID } from 'node:crypto';
import { cleanImage, ImageProblem } from './images.js';
import { assetKinds, getMediaStorage, type AssetKind, type AssetMeta, type MediaStorage } from './storage.js';

/**
 * A business's own pictures: product photos, logos and other photos, each with a label saying what it shows. Pilot uses the
 * label to choose the right picture for a video, so a product photo must say what the product is.
 */
export const MAX_ASSETS_PER_BUSINESS = 60;

export class AssetProblem extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage); this.name = 'AssetProblem'; }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A safe name for display only. The file itself is stored under a generated id, never this name. */
export const safeDisplayName = (name: unknown) => text(name, 120).replace(/[\\/:*?"<>|]+/g, '_') || 'image';
const cleanTags = (value: unknown): string[] => [...new Set((Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []).map((tag) => text(tag, 30).toLowerCase()).filter(Boolean))].slice(0, 8);

export type AssetFields = { kind?: unknown; label?: unknown; description?: unknown; tags?: unknown };

function fieldsFrom(input: AssetFields, fallbackName: string): Pick<AssetMeta, 'kind' | 'label' | 'description' | 'tags'> {
  const kind = (assetKinds as readonly string[]).includes(input.kind as string) ? input.kind as AssetKind : 'photo';
  const label = text(input.label, 120);
  if (kind === 'product' && !label) throw new AssetProblem('Say what the product is (for example "chocolate birthday cake") so Pilot can pick the right photo for a video.');
  return { kind, label: label || (kind === 'logo' ? 'Logo' : fallbackName.replace(/\.[A-Za-z0-9]{2,5}$/, '') || 'Photo'), description: text(input.description, 300), tags: cleanTags(input.tags) };
}

export async function saveBusinessImage({ tenantId, bytes, originalName, fields, storage = getMediaStorage() }: { tenantId: string; bytes: Buffer; originalName: unknown; fields: AssetFields; storage?: MediaStorage }): Promise<AssetMeta> {
  const name = safeDisplayName(originalName);
  const meta = fieldsFrom(fields, name);
  if ((await storage.listAssets(tenantId)).length >= MAX_ASSETS_PER_BUSINESS) throw new AssetProblem(`A business can keep up to ${MAX_ASSETS_PER_BUSINESS} pictures. Delete some you no longer use first.`);
  let cleaned;
  try { cleaned = await cleanImage(bytes); } catch (error) { if (error instanceof ImageProblem) throw new AssetProblem(error.publicMessage); throw error; }
  const full: AssetMeta = { id: randomUUID(), ...meta, originalName: name, mime: cleaned.mime, width: cleaned.width, height: cleaned.height, bytes: cleaned.bytes.length, createdAt: new Date().toISOString() };
  await storage.putAsset(tenantId, full, cleaned.bytes);
  return full;
}

export async function updateBusinessImage({ tenantId, assetId, fields, storage = getMediaStorage() }: { tenantId: string; assetId: string; fields: AssetFields; storage?: MediaStorage }): Promise<AssetMeta | null> {
  const current = await storage.getAssetMeta(tenantId, assetId);
  if (!current) return null;
  const next = fieldsFrom({ kind: fields.kind ?? current.kind, label: fields.label ?? current.label, description: fields.description ?? current.description, tags: fields.tags ?? current.tags }, current.originalName);
  const updated = { ...current, ...next };
  await storage.updateAssetMeta(tenantId, updated);
  return updated;
}

const STOP = new Set(['the', 'a', 'an', 'for', 'of', 'and', 'with', 'my', 'our', 'new', 'video', 'ad', 'ads', 'make', 'me', 'second', 'seconds', 'instagram', 'tiktok', 'facebook', 'linkedin', 'story', 'reel', 'short', 'that', 'this', 'it', 'to', 'in', 'on', 'people', 'order', 'encourage', 'appetizing']);
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)).map((word) => word.replace(/(ies)$/, 'y').replace(/(es|s)$/, (m, _g, i) => (word.length - m.length >= 3 ? '' : m)));

export type RankedAsset = AssetMeta & { score: number; matched: string[] };

/**
 * Ranks the business's pictures for what a request is about, by how many of the request's words appear in each picture's
 * label, tags and description. Labels count most. Pictures with no match score zero and are only used if the owner's
 * request is not about anything specific.
 */
export function rankAssets(assets: AssetMeta[], topic: string): RankedAsset[] {
  const wanted = new Set(words(topic));
  return assets.filter((asset) => asset.kind !== 'logo').map((asset) => {
    const labelWords = new Set(words(asset.label)); const other = new Set([...words(asset.tags.join(' ')), ...words(asset.description)]);
    const matched = [...wanted].filter((word) => labelWords.has(word) || other.has(word));
    const score = matched.reduce((sum, word) => sum + (labelWords.has(word) ? 2 : 1), 0) + (asset.kind === 'product' ? 0.5 : 0);
    return { ...asset, score, matched };
  }).sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
}

/** The logo to draw: the newest logo picture the business uploaded, else its website logo (id "logo"), else none. */
export function pickLogo(assets: AssetMeta[], websiteLogoUrl: string | null): string | null {
  const uploaded = assets.filter((asset) => asset.kind === 'logo').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return uploaded ? uploaded.id : websiteLogoUrl ? 'logo' : null;
}
