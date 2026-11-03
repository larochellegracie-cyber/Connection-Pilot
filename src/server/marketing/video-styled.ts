import { heroFocus } from './code-video/photo-ad.js';
import { loadPhoto, photoQuality } from './post-design/photo.js';
import { rankAssets } from './standard-video/business-assets.js';
import type { AssetMeta, MediaStorage } from './standard-video/storage.js';

/**
 * The pictures for a styled video: the business's OWN photos that fit what the video is about (all that fit, best first), judged for how well they will look filling a tall
 * frame (sharp, well exposed, big enough), each with where its subject is so the camera aims at it. A generated picture is used only when it was already made for this video.
 */
export type StyledPick = { id: string; label: string; bytes: Buffer; quality: number; focus: { x: number; y: number } };

export async function pickStyledPhotos({ tenantId, storage, assets, generated, topic, max = 6 }: { tenantId: string; storage: MediaStorage; assets: AssetMeta[]; /** pictures generated for this video (already in the library) */ generated?: AssetMeta[]; topic: string; max?: number }): Promise<StyledPick[]> {
  const own = assets.filter((a) => a.kind !== 'logo' && !a.tags.includes('generated')); const ranked = rankAssets(own, topic); const score = new Map(ranked.map((r) => [r.id, r.score]));
  const order = [...own].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || b.createdAt.localeCompare(a.createdAt)).slice(0, 14);
  const judged: Array<StyledPick & { fit: number }> = [];
  for (const asset of [...order, ...(generated ?? [])]) {
    const bytes = await (await storage.openAsset(tenantId, asset.id))?.read().catch(() => null); const photo = bytes ? await loadPhoto(bytes) : null; if (!bytes || !photo) continue;
    const q = await photoQuality(photo); if (q.score < 0.4) continue; const relevance = Math.min(1, (score.get(asset.id) ?? 0) / 6);
    judged.push({ id: asset.id, label: asset.label, bytes, quality: q.score, focus: await heroFocus(bytes), fit: relevance * 0.45 + q.score * 0.55 + (asset.tags.includes('generated') ? -0.05 : 0) });
  }
  const seen = new Set<string>(); const picks: StyledPick[] = [];
  for (const j of judged.sort((a, b) => b.fit - a.fit)) { const key = j.label.toLowerCase().replace(/[^a-z0-9]/g, ''); if (seen.has(key)) continue; seen.add(key); const { fit: _fit, ...pick } = j; picks.push(pick); if (picks.length >= max) break; }
  return picks;
}
