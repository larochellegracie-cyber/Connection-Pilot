import { describeRequest, type CreativeDetection } from '@/lib/marketing-creative-mode.js';
import type { AssetSelection } from './asset-selection.js';
import type { CreativeBrief } from './creative-brief.js';
import { generatedArtEnabled } from './generated-art.js';
import { realisticImagesEnabled } from './generated-visual.js';
import { loadBrandKit, loadBusinessBrief, type BusinessBrief } from './store.js';
import { getMediaStorage, type AssetMeta, type MediaStorage } from './standard-video/storage.js';

/**
 * Everything Pilot needs to know before it makes marketing content for a business, loaded for ONE business only (the id comes
 * from the signed-in session, never from the message): what the business is, how it looks, and the full list of media it has
 * uploaded. Nothing is generated here. Later steps (the brief, the planning, the making) start from this.
 */
export type MediaSummary = { id: string; kind: AssetMeta['kind']; originalName: string; label: string; description: string; tags: string[]; mime: string; width: number; height: number; bytes: number; createdAt: string; link: string };

export type CreativeContext = {
  business: BusinessBrief;
  brand: { name: string; primary: string; secondary: string; accent: string; hasLogoOnWebsite: boolean };
  media: {
    /** Every uploaded picture, newest first, including logos. */
    all: MediaSummary[];
    photos: MediaSummary[];
    logos: MediaSummary[];
    /** Uploaded videos. Video upload does not exist yet, so this is always empty for now, and Pilot says so rather than guessing. */
    videos: MediaSummary[];
  };
  /** Plain statements of what is missing, so Pilot never pretends to know or have something it does not. */
  gaps: string[];
};

const summary = (asset: AssetMeta): MediaSummary => ({ id: asset.id, kind: asset.kind, originalName: asset.originalName, label: asset.label, description: asset.description, tags: asset.tags, mime: asset.mime, width: asset.width, height: asset.height, bytes: asset.bytes, createdAt: asset.createdAt, link: `/api/marketing/assets/${asset.id}` });

export async function loadCreativeContext(tenantId: string, { storage = getMediaStorage() }: { storage?: MediaStorage } = {}): Promise<CreativeContext> {
  const [business, kit, assets] = await Promise.all([loadBusinessBrief(tenantId), loadBrandKit(tenantId), storage.listAssets(tenantId)]);
  const all = assets.map(summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const logos = all.filter((asset) => asset.kind === 'logo');
  const photos = all.filter((asset) => asset.kind !== 'logo');
  const gaps: string[] = [];
  if (!business.hasBusinessInformation) gaps.push('I don’t have much about what the business offers yet (no description, services or website notes).');
  if (!photos.length) gaps.push('No photos have been uploaded yet.');
  if (!logos.length && !kit.logoUrl) gaps.push('No logo has been added.');
  gaps.push('No videos have been uploaded (video upload isn’t available yet).');
  return { business, brand: { name: kit.name, primary: kit.primary, secondary: kit.secondary, accent: kit.accent, hasLogoOnWebsite: !!kit.logoUrl }, media: { all, photos, logos, videos: [] }, gaps };
}

const describePlatform = (platform: NonNullable<CreativeDetection['platform']>) => ({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube' })[platform];
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const names = (list: MediaSummary[], max = 6) => list.slice(0, max).map((item) => `“${item.label}”`).join(', ') + (list.length > max ? `, and ${list.length - max} more` : '');

const platformWords = { tiktok: 'TikTok', instagram: 'Instagram', general: 'no platform named', other: 'another platform' } as const;
const typeWords = { video: 'a video', still: 'a still image (a post or picture)', both: 'a video and a still image' } as const;

/** The brief in plain words, one line each, so the owner can see exactly what Pilot understood. */
export function briefLines(brief: CreativeBrief, detection?: CreativeDetection): string[] {
  const platform = brief.platform === 'other' && detection?.platform ? describePlatform(detection.platform) : platformWords[brief.platform];
  return [
    `Platform: ${platform}`,
    `Type: ${typeWords[brief.content_type]}${brief.length_seconds ? `, about ${brief.length_seconds} seconds` : ''}`,
    `About: ${brief.main_subject || 'not specified'}`,
    `Style: ${brief.style.length ? brief.style.join(', ') : 'not specified, so I would choose'}`,
    ...(brief.key_instructions.length ? [`Your instructions: ${brief.key_instructions.join('; ')}`] : []),
  ];
}

/**
 * What Pilot says when it enters Marketing Creative Mode. With a brief, it confirms what it understood (platform, type, subject,
 * style, length, instructions), what it knows about the business and its media, says nothing has been generated, and asks the owner
 * to confirm or adjust. Without one it only confirms the mode. It creates nothing either way.
 */
export function creativeModeReply(detection: CreativeDetection, context: CreativeContext, { format = 'markdown', brief, jobSaved = true, changes, planLines, closing, costNote, selection }: { format?: 'markdown' | 'plain'; brief?: CreativeBrief; jobSaved?: boolean; /** what making the video will cost, said before the owner confirms */ costNote?: string; /** which of the owner's own media will be used */ selection?: AssetSelection | null; /** set when this brief is a revision: what changed from the one before */ changes?: string[]; /** for a change to a finished video: what will be redone, what stays, and what it costs */ planLines?: string[]; /** replaces the last line */ closing?: string } = {}): string {
  const { business, media } = context;
  const name = business.businessName || context.brand.name || 'your business';
  const known = [
    business.businessType && business.businessType,
    business.location && `in ${business.location}`,
    business.services.length ? count(business.services.length, 'service') + ' on file' : '',
    business.promotions && 'a current promotion',
    business.brandVoice.tone && `a ${business.brandVoice.tone.toLowerCase()} brand voice`,
    business.websiteNotes.length && 'notes from your website',
  ].filter(Boolean).join(', ');
  const mediaLine = `**Your media:** ${count(media.photos.length, 'photo')}${media.photos.length ? ` (${names(media.photos)})` : ''}, ${count(media.logos.length, 'logo')}, ${count(media.videos.length, 'video')}.`;
  const gaps = context.gaps.length ? `**Missing:** ${context.gaps.join(' ')}` : '';
  const lines = brief ? [
    changes ? '**Marketing Creative Mode is on.** Here’s the updated brief:' : '**Marketing Creative Mode is on.** Here’s what I understood:',
    briefLines(brief, detection).map((line) => `• ${line}`).join('\n'),
    changes ? `**What changed:** ${changes.length ? changes.join('; ') : 'nothing I could tell, so tell me more about what you’d like different'}.` : '',
    `**What I know about ${name}:** ${known || 'not much yet'}.`,
    mediaLine, gaps,
    ...(selection ? [selectionLines(selection)] : []),
    ...(planLines ? [`**What I would do:** ${planLines.join(' ')}`] : []),
    ...(costNote ? [`**Cost:** ${costNote}`] : []),
    jobSaved ? '' : 'I couldn’t save this request just now, so you may need to ask again later.',
    closing ?? 'I haven’t made anything yet. Does this look right? Tell me what to confirm or change.',
  ] : [
    '**Marketing Creative Mode is on.**',
    `I understood that you want ${describeRequest(detection)}.`,
    `**What I know about ${name}:** ${known || 'not much yet'}.`,
    mediaLine, gaps,
    'I haven’t made anything yet. This step only confirms what you asked for and what I have to work with.',
  ];
  const text = lines.filter(Boolean).join('\n\n');
  return format === 'plain' ? text.replace(/\*\*/g, '') : text; // the Marketing page shows plain text
}

/** A short list of things the business already offers, to suggest when the request has no subject. */
function suggestions(context: CreativeContext): string[] {
  const fromBusiness = [...context.business.services.slice(0, 3), ...(context.business.promotions ? [context.business.promotions.slice(0, 50)] : [])];
  return fromBusiness.length ? fromBusiness : ['a service you offer', 'a seasonal reminder', 'a special or promotion'];
}

/**
 * The one question Pilot asks instead of starting: the request names no subject (only the business). Everything else has a default
 * (15 seconds, vertical, Pilot's choice of style), so this is the only thing it needs.
 */
export function subjectQuestion(brief: CreativeBrief, context: CreativeContext, detection: CreativeDetection, { format = 'markdown' }: { format?: 'markdown' | 'plain' } = {}): string {
  const text = [
    '**Marketing Creative Mode is on.** I need one thing before I start.',
    `So far: ${briefLines(brief, detection).filter((line) => /^(?:Platform|Type)/.test(line)).join(', ').replace(/^Platform: /, '').replace(/, Type: /, ', ')}.`,
    `**What should the video be about?** For example: ${suggestions(context).join(', ')}. Or say “surprise me”.`,
  ].join('\n\n');
  return format === 'plain' ? text.replace(/\*\*/g, '') : text;
}

/** What Pilot says about the owner's own media for this job: which files it plans to use, or that none fit well. */
export function selectionLines(selection: AssetSelection): string {
  if (selection.has_good_match) {
    const items = selection.selected_assets.map((asset) => `• “${asset.label}” (${asset.type}): ${asset.reason}`).join('\n');
    return `**Your media for this:** I plan to use ${selection.selected_assets.length === 1 ? `this ${selection.selected_assets[0].type}` : 'these'} of yours:\n${items}\nI won’t make up a replacement for ${selection.selected_assets.length === 1 ? 'it' : 'them'}.`;
  }
  return `**Your media for this:** ${selection.note} I’ll make a new visual for this one: ${realisticImagesEnabled() ? 'a realistic image generated for this subject (AI-generated, costs about 1–2 US cents, and saved in your Photos labelled “AI image”)' : generatedArtEnabled() ? 'brand-coloured artwork drawn for this subject (saved in your Photos, labelled “Made by Pilot”)' : 'a branded graphic made from your colours and words'}. It will not be passed off as a photo of your own work.`;
}

/** The owner said the brief is right. Pilot says it is locked in, which of their own media it plans to use, and that it is ready for the next step. Nothing has been generated. */
export function confirmedReply(brief: CreativeBrief, { format = 'markdown', already = false, selection, selectionFailed = false, closing }: { format?: 'markdown' | 'plain'; already?: boolean; selection?: AssetSelection | null; selectionFailed?: boolean; /** replaces the last line (for example, that the video is being made) */ closing?: string } = {}): string {
  const lines = [
    already ? '**Marketing Creative Mode: confirmed.** This brief is already confirmed:' : '**Marketing Creative Mode: confirmed.** This brief is locked in:',
    briefLines(brief).map((line) => `• ${line}`).join('\n'),
    selection ? selectionLines(selection) : selectionFailed ? '**Your media for this:** I couldn’t check your photos just now, so I haven’t picked any yet.' : '',
    closing ?? 'I’m ready for the next step. I haven’t made anything yet. If you want to change something first, just tell me.',
  ];
  const text = lines.filter(Boolean).join('\n\n');
  return format === 'plain' ? text.replace(/\*\*/g, '') : text;
}
