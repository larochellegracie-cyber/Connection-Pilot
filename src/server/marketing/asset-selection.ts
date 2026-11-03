import type { CreativeBrief } from './creative-brief.js';

/**
 * Asset-first selection: before anything new is made, look at the business's OWN uploaded media and decide which of it (if any)
 * fits what the brief is about. Plain, repeatable code (no AI call, no cost), so the same media and brief always give the same answer.
 *
 * How it ranks:
 *  1. The brief's main_subject is turned into its meaningful words ("closing pools" -> close, pool). Filler words are dropped, and so
 *     are words that describe the whole business (its name and kind of business: "pool" for a pool company), because they would make
 *     every photo look relevant.
 *  2. Words are reduced to a stem so "closing", "closed" and "close" match each other, and "pools" matches "pool".
 *  3. Each photo or video is scored by where those words appear: in its label (3 points), its tags (2), its description (1) or its
 *     file name (1). Each subject word counts once, at its best place.
 *  4. A photo is a GOOD match when it covers at least half of the subject's words AND scores at least 3 (so one word in the label is
 *     enough, but one stray word in a description is not).
 *  5. The best good matches (up to 3) are selected, highest score first, then newest. Logos are brand assets, not subject photos, and
 *     are never selected.
 * If nothing is a good match, nothing is selected and fallback_needed is true. A weak match is never presented as a good one.
 */
export type SelectedAsset = { id: string; label: string; description: string; type: 'photo' | 'video'; reason: string; score: number };

export type AssetSelection = {
  selected_assets: SelectedAsset[];
  /** True when at least one of the owner's own media files fits the subject. */
  has_good_match: boolean;
  /** True when no suitable owner media was found, so something new would be needed for this job. */
  fallback_needed: boolean;
  /** One plain sentence saying why (including the closest miss), for the reply and for later steps. */
  note: string;
  /** When the selection was made, ISO. */
  selected_at: string;
};

/** What the selector needs to know about each uploaded file. */
export type SelectableMedia = { id: string; kind: string; label: string; description: string; tags: string[]; mime: string; originalName: string; createdAt: string };

const MAX_SELECTED = 3;
const GOOD_COVERAGE = 0.5;
const GOOD_SCORE = 3;
const W = { label: 3, tags: 2, description: 1, file: 1 } as const;

const STOP = new Set(['the', 'and', 'for', 'our', 'new', 'with', 'your', 'this', 'that', 'from', 'about', 'into', 'all', 'are', 'you', 'can', 'get', 'now', 'one', 'out', 'any', 'has', 'have', 'was', 'were', 'its', 'their', 'them', 'these', 'those', 'than', 'then', 'also', 'more', 'some', 'such', 'only', 'very', 'make', 'made', 'post', 'posts', 'video', 'videos', 'reel', 'reels', 'tiktok', 'instagram', 'facebook', 'promotion', 'promote', 'promoting', 'general', 'add', 'adding', 'added', 'use', 'using', 'used', 'get', 'getting', 'try', 'trying', 'need', 'needs', 'want', 'wants', 'like', 'check', 'start', 'ready', 'real', 'actual', 'uploaded', 'today', 'tomorrow', 'tonight', 'weekend', 'week', 'month', 'year', 'best', 'great', 'good', 'nice', 'top', 'photo', 'photos', 'picture', 'pictures', 'image', 'images', 'jpg', 'jpeg', 'png', 'img', 'dsc']);

/** Reduces a word to a stem so closely related forms match: closing/closed/closes/close -> clos, pools -> pool, cakes -> cake. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([a-z])\1$/.test(w) && !w.endsWith('ss') && !w.endsWith('ll')) w = w.slice(0, -1); // "pouring"->"pour", "running"->"run"
  return w;
}

/** The meaningful words of a piece of text, as stems. */
export function stems(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((word) => word.length >= 3 && !STOP.has(word)).map(stem).filter((word) => word.length >= 2))];
}

/**
 * The words of the subject that can be matched, each with the owner's own spelling for display. A subject with no specific topic
 * ("general promotion of <the business>") gives nothing to match photos against.
 */
export function subjectTerms(subject: string, business: { businessName: string; businessType: string }): Array<{ stem: string; word: string }> {
  const shared = new Set(stems(`${business.businessName} ${business.businessType}`));
  const terms = new Map<string, string>();
  for (const word of subject.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (word.length < 3 || STOP.has(word)) continue;
    const root = stem(word);
    if (root.length >= 2 && !shared.has(root) && !terms.has(root)) terms.set(root, word);
  }
  return [...terms].map(([root, word]) => ({ stem: root, word }));
}

const isVideo = (mime: string) => mime.toLowerCase().startsWith('video/');

type Scored = { media: SelectableMedia; score: number; matched: string[]; places: Map<string, keyof typeof W>; coverage: number };

function score(media: SelectableMedia, wanted: string[]): Scored {
  const where: Record<keyof typeof W, Set<string>> = { label: new Set(stems(media.label)), tags: new Set(stems(media.tags.join(' '))), description: new Set(stems(media.description)), file: new Set(stems(media.originalName.replace(/\.[A-Za-z0-9]{2,5}$/, ''))) };
  const places = new Map<string, keyof typeof W>(); let total = 0;
  for (const word of wanted) {
    const best = (Object.keys(W) as Array<keyof typeof W>).filter((place) => where[place].has(word)).sort((a, b) => W[b] - W[a])[0];
    if (best) { places.set(word, best); total += W[best]; }
  }
  return { media, score: total, matched: [...places.keys()], places, coverage: wanted.length ? places.size / wanted.length : 0 };
}

const placeWords: Record<keyof typeof W, string> = { label: 'label', tags: 'tags', description: 'description', file: 'file name' };

export function selectAssets({ brief, media, business, now = new Date() }: { brief: Pick<CreativeBrief, 'main_subject'>; media: SelectableMedia[]; business: { businessName: string; businessType: string }; now?: Date }): AssetSelection {
  const stamp = now.toISOString();
  const candidates = media.filter((item) => item.kind !== 'logo');
  const subject = brief.main_subject.trim();
  const terms = subjectTerms(subject, business);
  const wanted = terms.map((term) => term.stem);
  const shown = new Map(terms.map((term) => [term.stem, term.word]));
  const quote = (roots: string[]) => roots.map((root) => `“${shown.get(root) ?? root}”`).join(' and ');
  if (!candidates.length) return { selected_assets: [], has_good_match: false, fallback_needed: true, note: 'You haven’t uploaded any photos or videos yet, so there is nothing of yours to use.', selected_at: stamp };
  if (!wanted.length) return { selected_assets: [], has_good_match: false, fallback_needed: true, note: `The request doesn’t name a specific subject (“${subject || 'none'}”), so I can’t tell which of your ${candidates.length} file${candidates.length === 1 ? '' : 's'} fits.`, selected_at: stamp };

  const ranked = candidates.map((item) => score(item, wanted)).sort((a, b) => b.score - a.score || b.coverage - a.coverage || b.media.createdAt.localeCompare(a.media.createdAt));
  const good = ranked.filter((item) => item.coverage >= GOOD_COVERAGE && item.score >= GOOD_SCORE).slice(0, MAX_SELECTED);
  if (good.length) {
    return {
      selected_assets: good.map((item) => ({
        id: item.media.id, label: item.media.label, description: item.media.description, type: isVideo(item.media.mime) ? 'video' : 'photo', score: item.score,
        reason: `Its ${[...new Set([...item.places.values()].map((place) => placeWords[place]))].join(' and ')} mention${item.matched.length === 1 && new Set(item.places.values()).size === 1 ? 's' : ''} ${quote(item.matched)}${item.coverage < 1 ? `, but not ${quote(wanted.filter((word) => !item.matched.includes(word)))}` : ''}.`,
      })),
      has_good_match: true, fallback_needed: false,
      note: `${good.length === 1 ? 'One of your files fits' : `${good.length} of your files fit`} “${subject}”.`, selected_at: stamp,
    };
  }
  const closest = ranked[0];
  const miss = closest.score > 0
    ? `The closest, “${closest.media.label}”, only loosely relates (it matches ${quote(closest.matched)} but not ${quote(wanted.filter((word) => !closest.matched.includes(word)))}).`
    : candidates.length === 1 ? `“${closest.media.label}” doesn’t relate to it.` : `“${closest.media.label}” and the others don’t relate to it.`;
  return { selected_assets: [], has_good_match: false, fallback_needed: true, note: `None of your ${candidates.length} file${candidates.length === 1 ? '' : 's'} fit “${subject}” well. ${miss}`, selected_at: stamp };
}

/** Checks a selection read back from storage: wrong shapes are dropped, never trusted. */
export function cleanSelection(value: unknown): AssetSelection | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const assets: SelectedAsset[] = (Array.isArray(v.selected_assets) ? v.selected_assets : []).slice(0, MAX_SELECTED).flatMap((item): SelectedAsset[] => {
    const a = item as Record<string, unknown>;
    return typeof a?.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(a.id) ? [{ id: a.id, label: text(a.label, 120), description: text(a.description, 300), type: a.type === 'video' ? 'video' : 'photo', reason: text(a.reason, 300), score: Number.isFinite(Number(a.score)) ? Number(a.score) : 0 }] : [];
  });
  const good = assets.length > 0;
  return { selected_assets: assets, has_good_match: good, fallback_needed: !good, note: text(v.note, 400), selected_at: text(v.selected_at, 40) };
}
