import type { ContentItem, PlatformId } from '@/lib/marketing-content.js';
import { generatePiece } from '../generate.js';
import { removePostMedia } from '../image.js';
import { ensureGeneratedVisual, realisticImagesEnabled } from '../generated-visual.js';
import { createDesignedPost, type DesignedPost } from '../post-design/index.js';
import { aspectFrom } from '../post-design/choose.js';
import { styleFromReference, type PostStyle } from '../post-design/style.js';
import { paletteOf } from '../post-design/layouts.js';
import { PAIRINGS, type PostAspect } from '../post-design/tokens.js';
import { mix } from '../post-design/draw-utils.js';
import { resolveProductAsset, type ProductAssetDecision } from '../product-asset.js';
import { rankAssets } from '../standard-video/business-assets.js';
import { getMediaStorage, type MediaStorage } from '../standard-video/storage.js';
import { createContent, getContent, loadBrandKit, saveContent } from '../store.js';
import { buildImageBlueprint } from './blueprint.js';
import { checkOutput, writeCopy, type Created, type Deps, type OutputChecks } from './create.js';
import { loadReferenceImage, saveDesignSession, type DesignSession } from './index.js';
import { refine } from './refine.js';
import type { ReferenceImageAnalysis } from './style.js';

/**
 * STYLE TRANSFER: the owner uploads a reference image and says "make me a post like this for my business". The reference was analysed once (structure, type, colours, photo
 * treatment, elements); here its style is followed to build a new post from the business's OWN logo, photos (real ones first, a generated realistic one only if switched on
 * and nothing fits) and words. The reference's words, brand and logo are kept out and checked for on the finished picture. What cannot be matched is said plainly.
 */
const ASPECTS: Record<string, PostAspect> = { '1:1': '1:1', '4:5': '4:5', '3:4': '4:5', '2:3': '9:16', '9:16': '9:16', '5:4': '1:1', '4:3': '1:1', '3:2': '1:1', '16:9': '1:1' };

/** "in our brand colours" and "in the reference's colours": which colours the post is made in. */
export const wantsBrandColours = (message: string) => /\b(?:our|my|the)?\s*(?:brand(?:ed)?|business|company)\s+colou?rs?\b|\bin (?:our|my) colou?rs?\b/i.test(message);

const GENERIC = /^(?:the\s+)?(?:business|company|brand|post|something|it|this)$/i;
/** "make me a post like this for Somerset": nothing about WHAT to show, only for whom. Then the business's own fitting photo is used rather than none. */
export function isGenericRequest(message: string, businessName: string): boolean {
  const filler = new Set(['make', 'create', 'design', 'build', 'give', 'me', 'us', 'a', 'an', 'the', 'post', 'posts', 'image', 'picture', 'graphic', 'ad', 'like', 'this', 'that', 'one', 'for', 'our', 'my', 'instagram', 'facebook', 'something', 'similar', 'in', 'style', 'of', 'to', 'business', 'please', 'pilot', 'can', 'you', 'could', 'new', 'same', 'but', 'with', 'using', 'based', 'on', 'from', 'reference', 'it', 'its', 'story', 'square']);
  const own = new Set(businessName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return message.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter((w) => w && !filler.has(w) && !own.has(w)).length < 2;
}

/** The business's photo for the post: one that matches the subject (all its distinctive words), else, when the request is about the business in general, its most fitting photo. */
async function choosePhoto({ tenantId, subject, query, input, storage, deps, generic = false }: { generic?: boolean; tenantId: string; subject: string; query: string; input: Awaited<ReturnType<Deps['loadInput']>>; storage: MediaStorage; deps: Deps }): Promise<{ photo: { id: string; label: string } | null; how: 'own' | 'ai' | 'none'; decision: ProductAssetDecision | null; note: string }> {
  const decision = await resolveProductAsset({ tenantId, subject: query || subject, business: { businessName: input.brief.businessName, businessType: input.brief.businessType }, storage });
  if (decision.found && decision.asset) return { photo: decision.asset, how: 'own', decision, note: '' };
  const own = (await storage.listAssets(tenantId)).filter((a) => a.kind !== 'logo' && !a.tags.includes('generated'));
  generic = generic || decision.terms.length === 0 || GENERIC.test(subject.trim());
  if (generic && own.length) { const ranked = rankAssets(own, `${input.brief.businessType} ${input.brief.services.join(' ')}`).find((r) => r.score > 0); const best = ranked ? own.find((a) => a.id === ranked.id) : [...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; if (best) return { photo: { id: best.id, label: best.label }, how: 'own', decision: { ...decision, found: true, mode: 'own_photo', asset: { id: best.id, label: best.label }, reason: `The request is about the business in general, so its own photo “${best.label}” is used.` }, note: '' }; }
  if ((deps.make || realisticImagesEnabled()) && subject.trim()) {
    const visual = await ensureGeneratedVisual({ tenantId, subject, kit: await loadBrandKit(tenantId), business: { businessName: input.brief.businessName, businessType: input.brief.businessType, location: input.brief.location, services: input.brief.services } as never, storage, ...(deps.make ? { make: deps.make } : {}) }).catch(() => null);
    if (visual?.kind === 'ai-image') return { photo: { id: visual.asset.id, label: visual.asset.label }, how: 'ai', decision: { ...decision, mode: 'generated_image', asset: { id: visual.asset.id, label: visual.asset.label } }, note: '' };
  }
  return { photo: null, how: 'none', decision, note: `I couldn’t find a photo of “${query || subject}” in your Photos${decision.considered[0] ? ` (the closest, “${decision.considered[0].label}”, doesn’t show it)` : ''}, so the post is built from your words and brand.` };
}

export async function createStyledPost({ tenant, message, analysis, deps }: { tenant: { id: string; businessName: string; businessType: string }; message: string; analysis: ReferenceImageAnalysis; deps: Deps }): Promise<Created> {
  const storage = deps.storage ?? getMediaStorage(); const input = await deps.loadInput(); const kit = await loadBrandKit(tenant.id); const spec = analysis.style.post!;
  const ownerWords = [message, input.brief.businessName, input.brief.businessType, input.brief.location, input.brief.services.join(' '), input.brief.description, input.brief.promotions, input.brief.sellingPoints.join(' ')].join(' ');
  const forbidden = buildImageBlueprint(analysis, ownerWords).forbidden;
  const words = await writeCopy({ message, input, analysis, complete: deps.complete });
  const style = styleFromReference({ spec, roles: analysis.measures.pageRoles ?? analysis.measures.roles, kit, mode: wantsBrandColours(message) ? 'brand' : 'reference', tone: analysis.style.blueprint.tone });
  const askedAspect = /\b(?:story|stories|square|1:1|9:16|tall)\b/i.test(message) ? aspectFrom(message) : null; const aspect: PostAspect = askedAspect ?? ASPECTS[analysis.measures.aspectRatio] ?? '4:5';
  // the photo: only if the reference has a place for one
  const wantsPhoto = spec.structure !== 'type_only' && !(spec.photo.shape === 'none' && spec.structure === 'text_top_photo_bottom');
  const asked = refine(analysis.style.blueprint, analysis.style.blueprint, message); const query = asked.photo && asked.photo !== 'none' && asked.photo !== '*' ? asked.photo : words.photoSearch || words.subject;
  const chosen = wantsPhoto && asked.photo !== 'none' ? await choosePhoto({ tenantId: tenant.id, subject: words.subject, query, input, storage, deps, generic: isGenericRequest(message, input.brief.businessName) }) : { photo: null, how: 'none' as const, decision: null, note: '' };
  const design: DesignedPost = await createDesignedPost({ tenantId: tenant.id, hook: words.headline, cta: words.cta, topic: words.subject, businessName: input.brief.businessName, businessType: input.brief.businessType, photo: chosen.photo ? { url: `/api/marketing/assets/${chosen.photo.id}`, prompt: chosen.photo.label, source: 'photo' } : null, message, aspect, style, forbidden, refCopy: { headline: asked.headline ?? words.headline, subline: words.subline, cta: words.cta }, storage, facts: { services: input.brief.services, sellingPoints: input.brief.sellingPoints } });
  console.info(JSON.stringify({ event: 'marketing-post.style-transfer', referenceId: analysis.id, style: style.summary, written: { headline: words.headline, subline: words.subline, cta: words.cta }, used: design.copy, removedFromReference: design.removed ?? 0, pattern: design.pattern, notes: design.notes }));
  const checks: OutputChecks = await checkOutput(design.bytes, design.copy, analysis, buildImageBlueprint(analysis, ownerWords));
  const platform: PlatformId = 'instagram'; const piece = await generatePiece({ kind: 'post', platform, topic: words.subject || design.copy.headline }, input, deps.complete); const { imagePrompt: _p, ...postWords } = piece; piece.topic = (words.subject || design.copy.headline).slice(0, 200);
  const item = await createContent(tenant.id, { ...postWords, topic: piece.topic, image: { ...design.image, prompt: `Styled from a reference (${style.summary})`.slice(0, 400) }, evidence: piece.evidence, status: 'draft', scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null });
  const now = new Date().toISOString(); const original = analysis.style.blueprint;
  const session: DesignSession = { referenceId: analysis.id, postStyle: style, originalPostStyle: style, postAspect: aspect, original, blueprint: original, copy: { headline: design.copy.headline, subline: design.copy.subline, cta: design.copy.cta }, request: message.slice(0, 400), subject: words.subject, photoId: chosen.photo?.id ?? null, photoLabel: chosen.photo?.label ?? null, productMode: chosen.how === 'own' ? 'own_photo' : chosen.how === 'ai' ? 'generated_image' : 'drawn_product', itemId: item.id, imageId: design.image.url.split('/').pop()!.replace(/\.jpg$/, ''), platform, createdAt: now, updatedAt: now };
  await saveDesignSession(tenant.id, session);
  const used = chosen.how === 'own' ? `I used your own photo “${chosen.photo!.label}”.` : chosen.how === 'ai' ? `I didn’t find a photo of that in your Photos, so I generated a realistic image (“${chosen.photo!.label}”). It is an AI image, not a photo of your real work.` : chosen.note || (wantsPhoto ? '' : 'The reference has no photo, so neither does this.');
  const notes = design.notes.filter((n) => /needs|left out|no photo/i.test(n)).slice(0, 2).join(' ');
  const message2 = `Here’s your Instagram post, made in the style of your reference: ${style.summary}. Only the design was borrowed (structure, type, colours, photo treatment, finishing details): the words, logo and pictures are your own${design.removed ? ` (I kept ${design.removed} bit${design.removed === 1 ? '' : 's'} of the reference’s own wording out)` : ''}. ${used}${notes ? ` ${notes}` : ''} I match the look closely but not exactly: fonts come from the ones Pilot carries, and hand-drawn or illustrated parts of a reference can’t be recreated. You can ask me to change it: “use our brand colours”, “make the text bigger”, “make it darker”, “use our actual photo”, “change the headline to “…””.`;
  return { item, session, checks, decision: chosen.decision, message: message2 };
}

// ---- changes to a styled post ------------------------------------------------------------------------------------------------------------------

export type StyleChange = { style: PostStyle; changes: string[]; understood: boolean; aspect?: PostAspect };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Plain-words changes to the style of the post ("make it darker", "use our brand colours", "more luxurious", "bigger text"), keeping the reference's structure. */
export function refineStyle(style: PostStyle, original: PostStyle, message: string, kit: Parameters<typeof paletteOf>[0]): StyleChange {
  const m = message.toLowerCase(); let next: PostStyle = { ...style }; const changes: string[] = []; let aspect: PostAspect | undefined;
  const pairing = (id: string) => PAIRINGS.find((p) => p.id === id) ?? style.pairing;
  if (/\b(?:original|reference(?:'s)?|back to the (?:original|reference))\b.*\b(?:colou?rs?|look|style)\b|\bstart over\b|\breset\b/.test(m)) { next = { ...original }; changes.push('went back to the reference’s own look'); }
  if (wantsBrandColours(message) || /\bbrand colou?rs?\b/.test(m)) { next = { ...next, palette: null, paletteMode: 'brand' }; changes.push('used your brand colours'); }
  if (/\b(?:darker|moodier|dark mode|night)\b/.test(m)) { const base = next.palette ?? paletteOf(kit, null, 'announcement'); const dark = next.palette ? { ...base, bgTop: mix(base.bgTop, '#000000', 0.62), bgBottom: mix(base.bgBottom, '#000000', 0.72), text: '#FFFFFF', muted: mix('#FFFFFF', base.bgTop, 0.2) } : base; next = { ...next, palette: dark, tone: 'dark' }; changes.push('made it darker'); }
  if (/\b(?:lighter|brighter|airier|light mode)\b/.test(m)) { const base = next.palette ?? paletteOf(kit, null, 'product_focus'); const light = next.palette ? { ...base, bgTop: mix(base.bgTop, '#FFFFFF', 0.7), bgBottom: mix(base.bgBottom, '#FFFFFF', 0.55), text: '#1B1B1F', muted: mix('#1B1B1F', '#FFFFFF', 0.3) } : base; next = { ...next, palette: light, tone: 'light' }; changes.push('made it lighter'); }
  if (/\b(?:bigger|larger)\b.*\b(?:text|headline|words|font)\b|\b(?:text|headline|words|font)\b.*\b(?:bigger|larger)\b/.test(m)) { next = { ...next, headlineScale: clamp(next.headlineScale * 1.18, 0.7, 1.6) }; changes.push('made the text bigger'); }
  if (/\b(?:smaller|tinier)\b.*\b(?:text|headline|words|font)\b|\b(?:text|headline|words|font)\b.*\b(?:smaller|tinier)\b/.test(m)) { next = { ...next, headlineScale: clamp(next.headlineScale * 0.85, 0.7, 1.6) }; changes.push('made the text smaller'); }
  if (/\b(?:luxur\w+|elegant|premium|upscale|classy)\b/.test(m)) { next = { ...next, pairing: pairing('elegant-serif'), caps: false, air: Math.max(next.air, 1.2), elements: [...new Set([...next.elements, 'keyline_frame' as const, 'rule' as const])] }; changes.push('made it more luxurious (serif type, a fine frame, more space)'); }
  else if (/\b(?:playful|fun|friendly|cheerful)\b/.test(m)) { next = { ...next, pairing: pairing('friendly-script'), accentWord: true }; changes.push('made it more playful'); }
  else if (/\b(?:bold|strong|punchy|loud)\b/.test(m)) { next = { ...next, pairing: pairing('bold-condensed'), caps: true, headlineScale: clamp(next.headlineScale * 1.1, 0.7, 1.6) }; changes.push('made it bolder'); }
  else if (/\b(?:minimal|simpler|simple|clean(?:er)?|plain)\b/.test(m)) { next = { ...next, elements: next.elements.filter((e) => e.startsWith('logo')), accentWord: false, air: Math.max(next.air, 1.2) }; changes.push('made it more minimal'); }
  if (/\b(?:square|1:1)\b/.test(m)) aspect = '1:1'; else if (/\b(?:story|stories|9:16|tall)\b/.test(m)) aspect = '9:16'; else if (/\b(?:4:5|portrait)\b/.test(m)) aspect = '4:5';
  if (aspect) changes.push(`changed the shape to ${aspect}`);
  return { style: next, changes, understood: changes.length > 0, ...(aspect ? { aspect } : {}) };
}

/** A follow-up to a styled post: the same reference, changed as asked. Returns null when the message is not a change to it. */
export async function refineStyledPost({ tenant, message, session, deps }: { tenant: { id: string }; message: string; session: DesignSession; deps: Deps }): Promise<Created | null> {
  const storage = deps.storage ?? getMediaStorage(); const kit = await loadBrandKit(tenant.id); const analysis = await loadReferenceImage(tenant.id, session.referenceId); if (!analysis || !session.postStyle) return null;
  const asked = refine(session.blueprint, session.original, message); const style = refineStyle(session.postStyle, session.originalPostStyle ?? session.postStyle, message, kit);
  if (!style.understood && !asked.understood) return null;
  const item = await getContent(tenant.id, session.itemId); if (!item) return null; const input = await deps.loadInput();
  let photoId = session.photoId; let photoLabel = session.photoLabel; let photoNote = ''; const changes = [...style.changes];
  if (asked.photo === 'none') { photoId = null; photoLabel = null; changes.push('took the photo out'); }
  else if (asked.photo) { const { pickPhoto } = await import('./create.js'); const found = await pickPhoto({ tenantId: tenant.id, query: asked.photo, input, headline: session.copy.headline, storage, exclude: asked.photo === '*' ? session.photoId : null, any: asked.photo === '*' }); if (found) { photoId = found.id; photoLabel = found.label; changes.push('used your own photo'); photoNote = ` I used your photo “${found.label}”.`; } else photoNote = ` I couldn’t find a photo of “${asked.photo === '*' ? 'another one' : asked.photo}” in your Photos.`; }
  if (asked.headline) changes.push('changed the headline');
  const ownerWords = [session.request, input.brief.businessName, input.brief.services.join(' ')].join(' '); const forbidden = buildImageBlueprint(analysis, ownerWords).forbidden; const aspect = style.aspect ?? session.postAspect ?? '4:5';
  const design = await createDesignedPost({ tenantId: tenant.id, hook: asked.headline ?? session.copy.headline, cta: session.copy.cta, topic: session.subject, businessName: input.brief.businessName, businessType: input.brief.businessType, photo: photoId ? { url: `/api/marketing/assets/${photoId}`, prompt: photoLabel ?? '', source: 'photo' } : null, message: session.request, aspect, style: style.style, forbidden, refCopy: { headline: asked.headline ?? session.copy.headline, subline: session.copy.subline, cta: session.copy.cta }, storage, facts: { services: input.brief.services, sellingPoints: input.brief.sellingPoints } });
  const checks = await checkOutput(design.bytes, design.copy, analysis, buildImageBlueprint(analysis, ownerWords)); await removePostMedia(tenant.id, item.image, storage);
  const updated: ContentItem = { ...item, image: { ...design.image, prompt: item.image?.prompt ?? design.image.prompt } }; await saveContent(tenant.id, updated);
  const next: DesignSession = { ...session, postStyle: style.style, postAspect: aspect, copy: { ...session.copy, headline: design.copy.headline }, photoId, photoLabel, imageId: design.image.url.split('/').pop()!.replace(/\.jpg$/, ''), updatedAt: new Date().toISOString() }; await saveDesignSession(tenant.id, next);
  return { item: updated, session: next, checks, decision: null, message: `${changes.length ? `Done: I ${changes.join(' and ')}.` : 'I made no visible change.'} It still follows your reference’s structure and style.${photoNote} Want anything else changed?` };
}
