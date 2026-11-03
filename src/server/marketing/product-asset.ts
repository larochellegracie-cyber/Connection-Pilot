import { stems, subjectTerms } from './asset-selection.js';
import type { AssetMeta, MediaStorage } from './standard-video/storage.js';

/**
 * The product for a product advert. One explicit decision, in this order:
 *   1. the business's OWN photo of that product, if its uploaded assets have one (every distinctive word of the request's subject is found in the asset's label,
 *      description or tags: "chocolate" and "cake" for a chocolate cake; an occasion word such as "birthday" does not have to be);
 *   2. otherwise a generated picture of the product, when one was made for this request (realistic images switched on);
 *   3. otherwise a drawn product (a ready-made illustration), never passed off as the business's own work.
 * A drawn or generated product is never preferred when an asset of the business's own matches. The decision is returned with the reasons and the assets looked at,
 * so it can be logged and shown.
 */
export type ConsideredAsset = { id: string; label: string; kind: string; matched: string[]; missing: string[]; coverage: number };
export type ProductAssetDecision = {
  /** the business's own matching photo was found */ found: boolean; mode: 'own_photo' | 'generated_image' | 'drawn_product';
  asset: { id: string; label: string } | null; terms: string[]; considered: ConsideredAsset[]; reason: string;
};

/** Words that say what the request is for, not what the product is: they do not have to appear in a photo's label. */
const OCCASION = new Set(['birthday', 'special', 'new', 'favourite', 'favorite', 'best', 'fresh', 'delicious', 'amazing', 'tasty', 'sweet', 'holiday', 'celebration', 'party', 'seasonal', 'limited', 'our', 'your', 'custom']);

export async function resolveProductAsset({ tenantId, subject, business, storage, generated }: { tenantId: string; subject: string; business: { businessName: string; businessType: string }; storage: MediaStorage; /** a picture generated for this request, if there is one */ generated?: { id: string; label: string } | null }): Promise<ProductAssetDecision> {
  const terms = subjectTerms(subject, business).filter((term) => !OCCASION.has(term.word));
  const owned = (await storage.listAssets(tenantId)).filter((asset: AssetMeta) => asset.kind !== 'logo' && !asset.tags.includes('generated'));
  const considered: ConsideredAsset[] = owned.map((asset) => {
    const have = new Set(stems(`${asset.label} ${asset.description} ${asset.tags.join(' ')}`));
    const matched = terms.filter((term) => have.has(term.stem) || [...have].some((word) => word.length >= 4 && term.stem.length >= 3 && (word === term.stem || word.startsWith(term.stem) && term.stem.length >= 4))).map((term) => term.word);
    const missing = terms.filter((term) => !matched.includes(term.word)).map((term) => term.word);
    return { id: asset.id, label: asset.label, kind: asset.kind, matched, missing, coverage: terms.length ? matched.length / terms.length : 0 };
  }).sort((a, b) => b.coverage - a.coverage);
  const exact = terms.length ? considered.find((asset) => asset.missing.length === 0) : undefined;
  if (exact) return { found: true, mode: 'own_photo', asset: { id: exact.id, label: exact.label }, terms: terms.map((t) => t.word), considered, reason: `The business’s own photo “${exact.label}” covers everything asked for (${exact.matched.join(', ')}), so it is used instead of a generated or drawn product.` };
  const closest = considered[0];
  const why = closest ? `Closest of the business’s own photos: “${closest.label}” (has ${closest.matched.join(', ') || 'nothing'} of ${terms.map((t) => t.word).join(', ')}; missing ${closest.missing.join(', ')}), so it does not show this product.` : 'The business has no product photos uploaded.';
  if (generated) return { found: false, mode: 'generated_image', asset: generated, terms: terms.map((t) => t.word), considered, reason: `${why} A product picture was generated for this request and is used (it is not a photo of the business’s own work).` };
  return { found: false, mode: 'drawn_product', asset: null, terms: terms.map((t) => t.word), considered, reason: `${why} The product is drawn as an illustration (it is not a photo of the business’s own work).` };
}
