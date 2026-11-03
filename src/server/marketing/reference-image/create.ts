import { randomUUID } from 'node:crypto';
import type { ContentItem, PlatformId, PostImage } from '@/lib/marketing-content.js';
import { cleanLine } from '../explainer/storyboard.js';
import { generatePiece, type Complete, type MarketingInput } from '../generate.js';
import { findSuitablePhoto, removePostMedia } from '../image.js';
import { ensureGeneratedVisual, realisticImagesEnabled, type PictureMakerLike } from '../generated-visual.js';
import { pickLogo } from '../standard-video/business-assets.js';
import { getMediaStorage, type MediaStorage } from '../standard-video/storage.js';
import { createContent, getContent, loadBrandKit, saveContent } from '../store.js';
import { loadDesignSession, saveDesignSession, clearDesignSession, loadReferenceImage, type Copy, type DesignSession } from './index.js';
import { refine, refineWithModel, looksLikeRefinement } from './refine.js';
import { renderDesign } from './render.js';
import { drawableKind, drawProduct, DRAWN_NOTE } from './drawn-product.js';
import { buildImageBlueprint, type ImageDesignBlueprint } from './blueprint.js';
import { frameOf } from './analyze.js';
import { nearestWindow, LOGO_MATCH } from '../reference/logo.js';
import { findReferenceText, redact, type Violation } from '../reference/protect.js';
import { resolveProductAsset, type ProductAssetDecision } from '../product-asset.js';
import type { Blueprint, ReferenceImageAnalysis } from './style.js';

/**
 * REFERENCE IMAGE → DESIGN BLUEPRINT → NEW PICTURE. The reference contributes only its design blueprint (layout, tone, type, spacing, accents). The words come
 * from the owner's request and business information; the picture is the owner's own photo (found in Photos by what the owner asked for), else a realistic
 * generated image when that is switched on, else the words carry the design. The reference image is not read again here, so its pixels, words and logos cannot appear.
 */
export type Deps = {
  complete: Complete; loadInput: () => Promise<MarketingInput>; storage?: MediaStorage; make?: PictureMakerLike;
};
export type Created = { item: ContentItem; message: string; session: DesignSession; checks: OutputChecks; decision: ProductAssetDecision | null };
/** What was checked on the finished picture: none of the reference's brand names, words or lines in any text, and none of its logo in the picture. */
export type OutputChecks = { referenceText: Violation[]; logo: { checked: boolean; similarity: number; found: boolean } };

/** Keeps the reference's brand names, slogans and lifted lines out of the words: anything found is removed; a headline left empty falls back to the business's own name. */
export function protectCopy(copy: Copy, subject: string, design: ImageDesignBlueprint | undefined, businessName: string): { copy: Copy; removed: Violation[] } {
  if (!design) return { copy, removed: [] };
  const forbidden = design.forbidden; const removed: Violation[] = [];
  const fix = (where: string, text: string) => { const hits = findReferenceText([{ where, text }], forbidden); if (!hits.length) return text; removed.push(...hits); return redact(text, forbidden).replace(/\s{2,}/g, ' ').trim(); };
  const out = { headline: fix('headline', copy.headline), subline: fix('subline', copy.subline), cta: fix('cta', copy.cta) };
  if (!out.headline) out.headline = findReferenceText([{ where: 'headline', text: subject }], forbidden).length ? businessName : subject || businessName;
  return { copy: { headline: out.headline, subline: out.subline, cta: out.cta || 'Learn more' }, removed };
}

export async function checkOutput(bytes: Buffer, copy: Copy, analysis: Pick<ReferenceImageAnalysis, 'logoPrint'>, design: ImageDesignBlueprint | undefined): Promise<OutputChecks> {
  const referenceText = design ? findReferenceText([{ where: 'headline', text: copy.headline }, { where: 'subline', text: copy.subline }, { where: 'cta', text: copy.cta }], design.forbidden) : [];
  if (!analysis.logoPrint) return { referenceText, logo: { checked: false, similarity: 0, found: false } };
  const frame = await frameOf(bytes); const hit = nearestWindow(frame.rgba, frame.width, frame.height, analysis.logoPrint, 4);
  return { referenceText, logo: { checked: true, similarity: Math.round(hit.confirmed * 100) / 100, found: hit.confirmed >= LOGO_MATCH } };
}

const COPY_SYSTEM = `You write the words for a single social media picture for ONE small business, and name the subject of the picture. The picture's DESIGN is already decided; you only write the words.
Reply with ONLY JSON: {"subject": "what the picture is about, 2 to 6 words", "headline": "up to 6 words", "subline": "up to 10 words, a complete thought", "cta": "up to 3 words, e.g. Order today", "photo_search": "the product or service the owner wants shown, 1 to 5 words, or empty"}.
Use only facts from the business information and the owner's request. Never invent prices, discounts, numbers, dates, awards, reviews, phone numbers, web addresses or claims. Do not use digits. Write in the business's own voice. Do not mention any reference image.`;

const strip = (message: string) => message.replace(/\b(?:please|pilot|can you|could you)\b[,:]?/gi, '').replace(/\b(?:make|create|design|do|build|give)\s+(?:me\s+)?(?:an?\s+|another\s+)?(?:instagram\s+|facebook\s+)?(?:post|image|picture|graphic|ad|promo\w*(?:\s+image)?|something)?\s*(?:like|similar to|based on|inspired by|with)\s+(?:this|that|the same|it)(?:\s+(?:one|image|picture|design|style))?/gi, '').replace(/\buse this (?:as|for) (?:inspiration|a reference|reference)\b/gi, '').replace(/\s+/g, ' ').trim();

export async function writeCopy({ message, input, analysis, complete }: { message: string; input: MarketingInput; analysis: Pick<ReferenceImageAnalysis, 'style'>; complete: Complete }): Promise<Copy & { subject: string; photoSearch: string }> {
  const b = input.brief; const known = [message, b.businessName, b.businessType, b.location, b.services.join(' '), b.description, b.promotions, b.sellingPoints.join(' ')].join(' ');
  const topic = strip(message) || `a post for ${b.businessName}`;
  const prompt = `BUSINESS\nName: ${b.businessName}\nType: ${b.businessType}\nPlace: ${b.location || 'not given'}\nServices/products: ${b.services.slice(0, 10).join(', ') || 'not listed'}\nAbout: ${b.description.slice(0, 400) || 'not given'}\nCurrent promotions: ${b.promotions.slice(0, 200) || 'none'}\nVoice: ${b.brandVoice?.tone || 'friendly and plain'}\n\nTHE OWNER ASKED\n"${message.slice(0, 400)}"\n\nDESIGN DIRECTION (mood only): ${analysis.style.mood}`;
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(/\{[\s\S]*\}/.exec(await complete(COPY_SYSTEM, prompt))?.[0] ?? '{}') as Record<string, unknown>; } catch { /* the plain fallback below is used */ }
  const headline = cleanLine(raw.headline, 48, known) || cleanLine(topic, 48, known) || b.businessName;
  return { headline, subline: cleanLine(raw.subline, 80, known), cta: cleanLine(raw.cta, 22, known) || 'Learn more', subject: cleanLine(raw.subject, 60, known) || topic.slice(0, 60), photoSearch: cleanLine(raw.photo_search, 60, known) };
}

/** The owner's own photo for what was asked (never one Pilot generated unless nothing else exists), or null. */
export async function pickPhoto({ tenantId, query, input, headline, storage, exclude, any }: { tenantId: string; query: string; input: MarketingInput; headline: string; storage: MediaStorage; exclude?: string | null; any?: boolean }): Promise<{ id: string; label: string } | null> {
  const found = query && query !== '*' ? await findSuitablePhoto({ tenantId, brief: input.brief, topic: query, hook: headline, storage, exclude: exclude ?? undefined }) : null;
  const id = found?.url.split('/').pop();
  if (id) { const meta = await storage.getAssetMeta(tenantId, id); if (meta) return { id: meta.id, label: meta.label }; }
  if (any) { // "use a different photo": the newest of the owner's own pictures that is not the current one
    const own = (await storage.listAssets(tenantId)).filter((asset) => asset.kind !== 'logo' && !asset.tags.includes('generated') && asset.id !== exclude).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (own) return { id: own.id, label: own.label };
  }
  return null;
}

async function draw({ tenantId, session, storage, input }: { tenantId: string; session: Pick<DesignSession, 'blueprint' | 'copy' | 'photoId' | 'design' | 'drawnKind'>; storage: MediaStorage; input: MarketingInput }): Promise<{ imageId: string; bytes: Buffer }> {
  const kit = await loadBrandKit(tenantId); const assets = await storage.listAssets(tenantId);
  const logoId = pickLogo(assets, kit.logoUrl); const logo = logoId && logoId !== 'logo' ? await (await storage.openAsset(tenantId, logoId))?.read() ?? null : null;
  const photo = session.photoId ? await (await storage.openAsset(tenantId, session.photoId))?.read() ?? null : null;
  const design = session.design; const roles = design?.colourRoles;
  // no photo of it: the product drawn with the ready-made illustrations, lit and coloured like the reference
  const drawn = !photo && session.drawnKind ? await drawProduct({ kind: session.drawnKind, tint: design?.palette.glow }) : null;
  const bytes = await renderDesign({ blueprint: session.blueprint, copy: session.copy, businessName: input.brief.businessName || kit.name, kit, photo, logo, ...(drawn ? { drawn } : {}), ...(design ? { palette: design.palette, light: design.lighting.direction as never, lighting: design.lighting } : {}), ...(design?.background.horizon !== null && design?.background.horizon !== undefined && roles?.separated ? { floor: { horizon: design.background.horizon, colour: roles.floor } } : {}) });
  const imageId = randomUUID(); await storage.putImage(tenantId, imageId, bytes);
  return { imageId, bytes };
}

const designNote = (analysis: Pick<ReferenceImageAnalysis, 'style'>) => `${analysis.style.mood || 'clean'}, ${analysis.style.blueprint.tone} background, ${analysis.style.layout}`.slice(0, 160);

export async function createFromReferenceImage({ tenant, message, analysis, deps }: { tenant: { id: string; businessName: string; businessType: string }; message: string; analysis: ReferenceImageAnalysis; deps: Deps }): Promise<Created> {
  // a reference analysed with the post structure (see style.ts) is rebuilt by the post designer in its style; an older analysis keeps the original drawing
  if (analysis.style.post && process.env.PILOT_STYLE_TRANSFER !== 'off') { const { createStyledPost } = await import('./create-post.js'); return createStyledPost({ tenant, message, analysis, deps }); }
  const storage = deps.storage ?? getMediaStorage(); const input = await deps.loadInput();
  // anything the owner said about the design in the same breath ("…Instagram square", "…more luxurious", "…use our cake photo")
  const original = analysis.style.blueprint; const asked = refine(original, original, message); const blueprint = asked.reset ? original : asked.blueprint;
  const words = await writeCopy({ message, input, analysis, complete: deps.complete });
  // the structured blueprint: the reference's design (colours by role, light, type, spacing, rules) with its own words and logo marked off-limits
  const ownerWords = [message, input.brief.businessName, input.brief.businessType, input.brief.location, input.brief.services.join(' '), input.brief.description, input.brief.promotions, input.brief.sellingPoints.join(' ')].join(' ');
  const design: ImageDesignBlueprint = { ...buildImageBlueprint(analysis, ownerWords), layout_: blueprint };
  const protectedCopy = protectCopy({ headline: asked.headline ?? words.headline, subline: words.subline, cta: words.cta }, words.subject, design, input.brief.businessName);
  const copy: Copy = protectedCopy.copy;
  // the product picture, one explicit decision: the owner's own matching photo > a realistic generated image (only when switched on) > nothing drawn as if it were theirs
  const wantsNone = asked.photo === 'none';
  const subjectQuery = asked.photo && asked.photo !== 'none' && asked.photo !== '*' ? asked.photo : words.photoSearch || words.subject;
  let photo: { id: string; label: string } | null = null; let how: 'own' | 'ai' | 'none' = 'none'; let aiLabel: string | null = null; let decision: ProductAssetDecision | null = null;
  if (!wantsNone) {
    decision = await resolveProductAsset({ tenantId: tenant.id, subject: subjectQuery, business: { businessName: input.brief.businessName, businessType: input.brief.businessType }, storage });
    if (decision.found && decision.asset) { photo = decision.asset; how = 'own'; }
    else if (asked.photo === '*') { photo = await pickPhoto({ tenantId: tenant.id, query: '*', input, headline: copy.headline, storage, any: true }); how = photo ? 'own' : 'none'; }
    else if ((deps.make || realisticImagesEnabled()) && words.subject) {
      const visual = await ensureGeneratedVisual({ tenantId: tenant.id, subject: words.subject, kit: await loadBrandKit(tenant.id), business: { businessName: input.brief.businessName, businessType: input.brief.businessType, location: input.brief.location, services: input.brief.services, description: input.brief.description } as never, storage, ...(deps.make ? { make: deps.make } : {}) }).catch(() => null);
      if (visual?.kind === 'ai-image') { photo = { id: visual.asset.id, label: visual.asset.label }; how = 'ai'; aiLabel = visual.asset.label; decision = { ...decision, mode: 'generated_image', asset: photo }; }
    }
  }
  // no photo and nothing generated: a product with a ready-made illustration is drawn (the owner is told it is only a drawing); anything else stays type-led
  const drawnKind = !wantsNone && !photo ? drawableKind(subjectQuery || words.subject) : null;
  if (drawnKind && decision) decision = { ...decision, mode: 'drawn_product', reason: `${decision.reason} Drawn with the ready-made ${drawnKind} illustration.` };
  // a photo-less reference design that needs a picture to make sense keeps its words large; a design with a picture but none available becomes type-led
  const finalBlueprint: Blueprint = photo || drawnKind ? blueprint : { ...blueprint, subject: { ...blueprint.subject, placement: blueprint.subject.placement === 'full_bleed' ? 'center' : blueprint.subject.placement }, background: { ...blueprint.background, kind: blueprint.background.kind === 'photo' ? 'gradient' : blueprint.background.kind } };
  const platform: PlatformId = 'instagram';
  const session: DesignSession = { referenceId: analysis.id, design: { ...design, layout_: finalBlueprint }, productMode: how === 'own' ? 'own_photo' : how === 'ai' ? 'generated_image' : 'drawn_product', original, blueprint: finalBlueprint, copy, request: message.slice(0, 400), subject: words.subject, photoId: photo?.id ?? null, photoLabel: photo?.label ?? null, drawnKind, itemId: '', imageId: '', platform, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const { imageId, bytes } = await draw({ tenantId: tenant.id, session, storage, input }); session.imageId = imageId;
  const checks = await checkOutput(bytes, copy, analysis, design);
  // the caption, hashtags and the rest of the post come from the normal post writer
  const piece = await generatePiece({ kind: 'post', platform, topic: words.subject || copy.headline }, input, deps.complete);
  const { imagePrompt: _imagePrompt, ...postWords } = piece; piece.topic = (words.subject || copy.headline).slice(0, 200);
  const image: PostImage = { url: `/api/marketing/media/images/${imageId}.jpg`, prompt: `Designed from a reference: ${designNote(analysis)}`.slice(0, 400), source: 'graphic' };
  const item = await createContent(tenant.id, { ...postWords, topic: piece.topic, image, evidence: piece.evidence, status: 'draft', scheduledFor: null, approvedAt: null, publishedAt: null, campaign: null });
  session.itemId = item.id; await saveDesignSession(tenant.id, session);
  const used = how === 'own' ? `I used your own photo “${photo!.label}”.` : how === 'ai' ? `I didn’t find a photo of that in your Photos, so I generated a realistic image for it (“${aiLabel}”). It is an AI image, not a photo of your real work. Upload your own photo and say “use our actual photo” to replace it.` : (words.photoSearch || asked.photo) && asked.photo !== 'none' ? `I couldn’t find a photo of “${words.photoSearch || asked.photo}” in your Photos${decision?.considered[0] ? ` (the closest, “${decision.considered[0].label}”, doesn’t show it)` : ''}. ${drawnKind ? DRAWN_NOTE(drawnKind) : 'so I didn’t draw one: this one is built from your words, logo and brand.'} Upload a photo and say “use our actual photo”.` : 'I built it from your words and brand colours.';
  const changes = asked.changes.length ? ` (${asked.changes.join(', ')})` : '';
  return { item, session, checks, decision, message: `Here’s your Instagram post, designed in the style of your reference (${designNote(analysis)})${changes}. Only the design was borrowed (layout, light, type and the look of the colours): the words, logo and pictures are your own. ${used} Check the words before you post it. You can ask me to change it: “make the text bigger”, “make it darker”, “use our actual product photo”, “make it Instagram square”.` };
}

/** A follow-up change to the picture just made. Returns null when the message is not a change to it (so the normal handling carries on). */
export async function refineLatestDesign({ tenant, message, deps, newerThan }: { tenant: { id: string }; message: string; deps: Deps; /** a video job or newer thing made after the picture: then "make it darker" is about that, not this */ newerThan?: string | null }): Promise<Created | null> {
  const session = await loadDesignSession(tenant.id);
  if (!session || !looksLikeRefinement(message)) return null;
  if (session.postStyle) { const { refineStyledPost } = await import('./create-post.js'); return refineStyledPost({ tenant, message, session, deps }); }
  // a video made after the picture owns ambiguous changes ("make it darker"); words that can only mean the picture still go to the picture
  const pictureOnly = /\b(?:photo|picture|image|text|headline|font|logo|button|cta|square|instagram|post|frame|border|caption)\b/i.test(message) && !/\b(?:video|scene|music|clip|reel|seconds?)\b/i.test(message);
  if (newerThan && Date.parse(newerThan) > Date.parse(session.updatedAt) && !pictureOnly) return null;
  const storage = deps.storage ?? getMediaStorage();
  let change = refine(session.blueprint, session.original, message);
  if (!change.understood) {
    // a message that is really a new request (a video, ideas, a caption) is not a change to the picture
    if (message.trim().split(/\s+/).length > 16 || /\b(?:video|reel|ideas?|caption|calendar|schedule|plan|week)\b/i.test(message)) return null;
    change = await refineWithModel(session.blueprint, session.original, message, deps.complete); if (!change.understood) return null;
  }
  const item = await getContent(tenant.id, session.itemId);
  if (!item) { await clearDesignSession(tenant.id); return null; }
  const input = await deps.loadInput();
  const next: DesignSession = { ...session, blueprint: change.blueprint, copy: protectCopy({ ...session.copy, ...(change.headline ? { headline: change.headline } : {}) }, session.subject, session.design, input.brief.businessName).copy, ...(session.design ? { design: { ...session.design, layout_: change.blueprint } } : {}), updatedAt: new Date().toISOString() };
  let photoNote = '';
  if (change.photo === 'none') { next.photoId = null; next.photoLabel = null; next.productMode = 'drawn_product'; next.drawnKind = null; }
  else if (change.photo) {
    const found = await pickPhoto({ tenantId: tenant.id, query: change.photo, input, headline: next.copy.headline, storage, exclude: change.photo === '*' ? session.photoId : null, any: change.photo === '*' });
    if (found) { next.photoId = found.id; next.photoLabel = found.label; next.productMode = 'own_photo'; photoNote = ` I used your photo “${found.label}”.`; change.changes.push('used your own photo'); }
    else { const have = (await storage.listAssets(tenant.id)).filter((a) => a.kind !== 'logo' && !a.tags.includes('generated')).slice(0, 5).map((a) => `“${a.label}”`); photoNote = ` I couldn’t find a photo of “${change.photo === '*' ? 'another one' : change.photo}” in your Photos${have.length ? ` (I have: ${have.join(', ')})` : ''}, so I kept the current picture. Upload one and ask again.`; }
  }
  if (next.photoId === null && session.photoId === null && change.blueprint.subject.placement === 'full_bleed') next.blueprint = { ...next.blueprint, subject: { ...next.blueprint.subject, placement: 'center' } };
  const { imageId, bytes } = await draw({ tenantId: tenant.id, session: next, storage, input });
  const source = await loadReferenceImage(tenant.id, session.referenceId); const checks = await checkOutput(bytes, next.copy, source ?? {}, next.design);
  await removePostMedia(tenant.id, item.image, storage);
  const updated: ContentItem = { ...item, image: { url: `/api/marketing/media/images/${imageId}.jpg`, prompt: item.image?.prompt ?? '', source: 'graphic' } };
  await saveContent(tenant.id, updated); next.imageId = imageId; await saveDesignSession(tenant.id, next);
  return { item: updated, session: next, checks, decision: null, message: `${change.changes.length ? `Done: I ${change.changes.join(' and ')}.` : 'I made no visible change.'} It still follows your reference’s design.${photoNote} Want anything else changed?` };
}
