import { randomUUID } from 'node:crypto';
import type { PostImage } from '@/lib/marketing-content.js';
import { pickLogo, rankAssets } from '../standard-video/business-assets.js';
import { getMediaStorage, type AssetMeta, type MediaStorage } from '../standard-video/storage.js';
import { loadBrandKit } from '../store.js';
import { aspectFrom, choosePattern, extractEvent, extractOffer, extractQuote, GRAPHIC_ASK } from './choose.js';
import { motifFor, type Motif } from './graphics.js';
import { moodFrom, moodStyle, MOOD_MOTIFS } from './moods.js';
import { buildCopy, pointsFrom } from './copy.js';
import { renderPost, type Pattern, type PostCopy, type PostResult } from './layouts.js';
import { lintPost } from './lint.js';
import { pairingFor, type PostAspect } from './tokens.js';
import type { PostStyle } from './style.js';
import { protectPostCopy } from './protect-copy.js';
import { tidyCopy } from './standards.js';
import { loadPhoto, photoQuality, type PhotoQuality } from './photo.js';
import type { ReferenceText } from '../reference/protect.js';

export * from './tokens.js'; export { lintPost } from './lint.js'; export { choosePattern, aspectFrom, fontFrom, seasonOf } from './choose.js'; export { renderPost, type Pattern } from './layouts.js';

/**
 * A designed picture post: the owner's real product photo (or a photo generated for this request when they have none), placed on a clean layout, with the
 * brand's colours, a font pairing that suits the business, a small number of well-set words, and the brand's logo. See tokens.ts for the rules and layouts.ts
 * for the patterns. The finished picture is checked against the rules (lint.ts); if anything fails, the busiest parts (call-outs, the supporting line) are
 * dropped and it is drawn again, so what is shown is always a clean version.
 */
export type DesignedPost = { /** the finished picture */ bytes: Buffer; /** the style that was followed, when the post was made from a reference */ style?: PostStyle; /** what was taken out of the words because it belongs to the reference */ removed?: number; image: PostImage; pattern: Pattern; why: string; fonts: { display: string; body: string }; aspect: PostAspect; photoUsed: { id: string; label: string; source: 'own' | 'generated' } | null; issues: string[]; notes: string[]; copy: PostCopy };

export async function createDesignedPost({ tenantId, hook, cta, topic, businessName, businessType, photo, message = '', aspect, pattern, storage = getMediaStorage(), exclude, variant = 0, facts, style, forbidden, refCopy }: { /** a style learned from a reference image: the post follows its structure, colours, type, photo treatment and elements */ style?: PostStyle; /** the reference's own text, kept out of the words */ forbidden?: ReferenceText; /** the headline, supporting line and button words already written for this post */ refCopy?: { headline: string; subline: string; cta: string }; /** what the business says about itself, for a list of points */ facts?: { services?: string[]; sellingPoints?: string[] }; tenantId: string; hook: string; cta: string; topic: string; businessName: string; businessType: string; /** the photo chosen for this post (the owner's own, or a generated one), as a /api/marketing/assets/<id> link */ photo?: PostImage | null; /** what the owner said (a story, square, a font, a style) */ message?: string; aspect?: PostAspect; pattern?: Pattern; storage?: MediaStorage; exclude?: string; variant?: number }): Promise<DesignedPost> {
  const kit = await loadBrandKit(tenantId); const assets = await storage.listAssets(tenantId); const text = `${topic} ${hook} ${message}`;
  const ownAssets = assets.filter((a: AssetMeta) => a.kind !== 'logo' && !a.tags.includes('generated') && a.id !== exclude);
  const heroId = photo?.url.split('/').pop() ?? null; let heroMeta = heroId ? assets.find((a) => a.id === heroId) ?? null : null; let heroBytes = heroId ? await (await storage.openAsset(tenantId, heroId))?.read().catch(() => null) ?? null : null;
  // other photos of products, for a grid: the ones that rank for the topic, one per distinct label, with the hero first
  const ranked = rankAssets(ownAssets, `${topic} ${hook}`).filter((r) => r.score > 0).map((r) => ownAssets.find((a) => a.id === r.id)!).filter(Boolean);
  const gridAssets = [...(heroMeta && !heroMeta.tags.includes('generated') ? [heroMeta] : []), ...ranked.filter((a) => a.id !== heroMeta?.id)].filter((a, i, all) => all.findIndex((b) => b.label === a.label) === i).slice(0, 4);
  // the photo that will work best on social media: if the one chosen is soft, dark or small, a better one of the business's own that fits the topic equally is used instead
  let quality: PhotoQuality | null = null; const qualityNotes: string[] = [];
  if (heroBytes) { const lp = await loadPhoto(heroBytes); quality = lp ? await photoQuality(lp) : null;
    if (quality && quality.score < 0.7) { let best: { meta: AssetMeta; bytes: Buffer; q: PhotoQuality } | null = null; for (const alt of ranked.filter((a) => a.id !== heroMeta?.id).slice(0, 4)) { const bytes = await (await storage.openAsset(tenantId, alt.id))?.read().catch(() => null); const ap = bytes ? await loadPhoto(bytes) : null; const aq = ap ? await photoQuality(ap) : null; if (bytes && aq && aq.score > quality.score + 0.12 && (!best || aq.score > best.q.score)) best = { meta: alt, bytes, q: aq }; }
      if (best) { qualityNotes.push(`Another of your photos (“${best.meta.label}”) works better on social media than “${heroMeta?.label ?? 'the first one'}” (${quality.issues.join(', ') || 'smaller or softer'}), so it is used.`); heroMeta = best.meta; heroBytes = best.bytes; quality = best.q; } } }
  // what the owner gave in their own words: an offer, words to quote, an event. Nothing here is ever written for them.
  const ownerText = `${message} ${topic}`; const offer = extractOffer(message) ?? extractOffer(topic); const quote = extractQuote(message); const event = extractEvent(message) ?? extractEvent(topic); const points = pointsFrom(facts ?? {});
  const recent = [...ownAssets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); const galleryAssets = [...gridAssets, ...ranked, ...recent].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i && !/\b(?:logo)\b/i.test(a.label)).slice(0, 3);
  const choice = choosePattern({ text, seasonText: ownerText, photos: heroBytes ? 1 : 0, products: gridAssets.length >= 2 && /\b(?:menu|flavou?rs|collection|range|favou?rites|products)\b/i.test(text) ? gridAssets.length : 0, offer: !!offer, quote: !!quote, points: points.length, gallery: galleryAssets.length, graphic: GRAPHIC_ASK.test(message), motif: !!motifFor(`${topic} ${hook} ${businessType} ${message}`) });
  const mood = style ? null : moodFrom(message);
  if (pattern === 'poster' || (!pattern && !style && GRAPHIC_ASK.test(message) && !extractQuote(message) && !extractOffer(message))) { heroBytes = null; heroMeta = null; } // a graphic post is drawn, so no photo is placed (or reported as used)
  let chosen: Pattern = pattern ?? (style ? style.pattern : variant % 3 === 1 && heroBytes && choice.pattern === 'product_focus' ? 'announcement' : choice.pattern); const styleNotes: string[] = [];
  if (style) { // the reference's structure, as far as what the owner gave allows: a quote layout needs words to quote, an offer layout needs an offer, and so on
    const fallback: Pattern = heroBytes ? 'product_focus' : 'announcement'; const need: Partial<Record<Pattern, [boolean, string]>> = { quote: [!!quote, 'words to quote'], offer: [!!offer, 'an offer'], benefits: [points.length >= 2, 'points to list'], grid: [gridAssets.length >= 2, 'two or more product photos'], collage: [galleryAssets.length >= 2, 'two or more photos'], overlay: [!!heroBytes, 'a photo'], split: [!!heroBytes, 'a photo'] };
    const req = need[chosen]; if (req && !req[0]) { styleNotes.push(`The reference is built as a ${chosen} layout, which needs ${req[1]}; none was given, so the same style is applied to a ${fallback.replace('_', ' ')} layout.`); chosen = fallback; }
  }
  const activeStyle: PostStyle | undefined = style ?? (mood ? { ...moodStyle(mood, kit, chosen), pattern: chosen } : undefined);
  // the picture of a post with no photo: a motif about the subject (or the mood), composed one of four ways (the same post always gets the same one)
  const hash = (str: string) => [...str].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7); const seed = hash(`${topic}|${hook}|${message}`);
  const motif: Motif = motifFor(`${topic} ${hook} ${businessType} ${message}`) ?? (mood ? MOOD_MOTIFS[mood] : (['blobs', 'arches', 'rings', 'sparkle', 'dots', 'burst'] as Motif[])[seed % 6]); const compositions = ['stack', 'side', 'center', 'frame'] as const;
  const graphic = { motif, composition: compositions[(seed >> 3) % 4], seed: (seed % 97) + 1 };
  // a photo too small to fill the frame is never stretched to: layouts that need it edge to edge give way to ones that set it at its own size
  if (quality && quality.resolution < 0.35 && (chosen === 'overlay' || chosen === 'split')) { qualityNotes.push(`The photo is small (${quality.width}×${quality.height}), so it is set at its own size instead of filling the frame.`); chosen = 'product_focus'; }
  const itemAssets = chosen === 'collage' ? galleryAssets : gridAssets; const items = chosen === 'grid' || chosen === 'collage' ? await Promise.all(itemAssets.map(async (a) => ({ label: a.label.replace(/^(?:ai image|from website|made by pilot)\s*[-–—]\s*/i, '').slice(0, 40), photo: (await (await storage.openAsset(tenantId, a.id))?.read().catch(() => null)) ?? null }))) : [];
  const logoId = pickLogo(assets, kit.logoUrl); const logo = logoId && logoId !== 'logo' ? (await (await storage.openAsset(tenantId, logoId))?.read().catch(() => null)) ?? null : null;
  const pairing = style?.pairing ?? (mood && !/\b(?:font|type|typeface|lettering)\b/i.test(message) ? activeStyle!.pairing : pairingFor({ businessType, mood: text, request: message })); const shape = aspect ?? aspectFrom(message);
  const built = buildCopy({ pattern: chosen, hook: refCopy?.headline ?? hook, cta: refCopy?.cta ?? cta, ...(refCopy ? { subline: refCopy.subline } : {}), businessName, topic, season: choice.season, product: heroMeta ? { label: heroMeta.label, description: heroMeta.description, tags: heroMeta.tags } : null, items, extra: { ...(!heroBytes || chosen === 'poster' ? { graphic } : {}), ...(offer && chosen === 'offer' ? { offer } : {}), ...(quote && chosen === 'quote' ? { quote } : {}), ...(chosen === 'banner' && event ? { event } : {}), ...(chosen === 'benefits' ? { points } : {}) } });
  const protectedCopy = protectPostCopy(built, forbidden, businessName); const tidy = tidyCopy(protectedCopy.copy, { pattern: chosen, hasLogo: !!logo, hasPhoto: !!heroBytes, businessName }); const full = tidy.copy;
  let attempt: PostResult = await renderPost({ pattern: chosen, aspect: shape, kit, pairing, copy: full, hero: style && style.pattern === 'announcement' && style.photo.shape === 'none' ? null : heroBytes, logo, businessName, ...(activeStyle ? { style: activeStyle } : {}) }); let issues = lintPost(attempt); let copy = full; const notes = [...qualityNotes, ...styleNotes, ...tidy.notes, ...attempt.notes];
  if (issues.length) { // drop the busiest parts and draw again: what is shown is always a clean version
    const lean: PostCopy = { ...full, callouts: [], subline: '' }; const retry = await renderPost({ pattern: chosen, aspect: shape, kit, pairing, copy: lean, hero: style && style.pattern === 'announcement' && style.photo.shape === 'none' ? null : heroBytes, logo, businessName, ...(activeStyle ? { style: activeStyle } : {}) }); const again = lintPost(retry);
    if (again.length <= issues.length) { notes.push(`The first layout had ${issues.length} design problem(s) (${issues[0]}), so the call-outs and supporting line were dropped.`); attempt = retry; issues = again; copy = lean; }
  }
  const id = randomUUID(); await storage.putImage(tenantId, id, attempt.bytes);
  const used = heroMeta ? { id: heroMeta.id, label: heroMeta.label, source: (heroMeta.tags.includes('generated') ? 'generated' : 'own') as 'own' | 'generated' } : null;
  const image: PostImage = { url: `/api/marketing/media/images/${id}.jpg`, prompt: `Designed post (${attempt.pattern.replace('_', ' ')}, ${attempt.fonts.display}${used ? `, using “${used.label}”` : ', type only'}). ${choice.why}.`.slice(0, 400), source: 'graphic' };
  return { bytes: attempt.bytes, image, pattern: attempt.pattern, why: style ? `it follows the reference: ${style.summary}` : choice.why, fonts: attempt.fonts, aspect: shape, photoUsed: used, issues, notes, copy, ...(activeStyle ? { style: activeStyle } : {}), removed: protectedCopy.removed.length };
}
