import type { CreativeBrief } from './creative-brief.js';
import { costWords, estimateCredits } from './iteration.js';
import { planScenes } from './storyboard.js';

/**
 * Which way a video is made, and what the owner is told about it.
 *
 *  animated  (the default) Pilot's own free animation: the owner's photos when they match, brand colours, text overlays, simple motion and
 *            transitions, drawn on this server, with original music. No outside service, so it costs nothing and starts straight away.
 *  runway    the optional premium path: AI-generated footage from Runway. It costs credits, so it is only used when the owner asks for it in so
 *            many words (cinematic, AI video, Runway, realistic...), the cost is shown first, and Pilot waits for a "yes".
 * Nothing else ever reaches Runway. The choice is plain code that reads the owner's own words, so it is repeatable and free.
 */
export type VideoEngine = 'animated' | 'runway';

const PREMIUM = /\b(?:cinematic|ai[- ]?generated|ai[- ]video|ai[- ]footage|ai[- ]clips?|runway|realistic|photo-?realistic|hyper-?realistic|lifelike|real footage|live[- ]action|text[- ]to[- ]video|generated (?:video|footage)|premium video)\b/i;
/** Plain words that put a video on the free path even if it was premium before ("make it animated"). */
const FREE = /\b(?:animated|animation|motion graphics|no credits|without runway|don['’]?t use runway|do not use runway|not runway|the free (?:one|version|way)|free version|no ai)\b/i;

export const premiumRequested = (message: string, style: string[] = []) => PREMIUM.test(message) || style.some((word) => word === 'cinematic' || word === 'realistic');

/**
 * The engine for a job. A first request is animated unless the owner asked for the premium look. A change to a finished video keeps the
 * engine it was made with, unless they ask to switch ("make it cinematic" goes premium; "make it animated" goes free).
 */
export function engineFor({ message, style, earlier }: { message: string; style: string[]; earlier?: VideoEngine | null }): VideoEngine {
  if (FREE.test(message)) return 'animated';
  // the style words the brief carries ("cinematic") count for a new request or a Runway video, but a free video does not turn premium just
  // because its brief still says "cinematic"; only the owner's new words can switch it
  if (premiumRequested(message, earlier === 'animated' ? [] : style)) return 'runway';
  return earlier ?? 'animated';
}

/** A request with nothing to make a video about: only the business, no subject. (Missing length or platform are not ambiguous; they have defaults.) */
export function isAmbiguous(brief: Pick<CreativeBrief, 'main_subject' | 'style'>): boolean {
  if (brief.style.includes('surprise me')) return false; // "surprise me": Pilot chooses
  const subject = brief.main_subject.trim();
  return !subject || /^general promotion of\b/i.test(subject);
}

// ---- what the owner is told ------------------------------------------------------------------------------------------------

/** Seconds of new Runway footage a whole new video of this length would use. */
export const footageSeconds = (lengthSeconds: number | null) => planScenes(lengthSeconds).seconds.slice(0, -1).reduce((a, b) => a + b, 0);

/** Said when a free video starts: which path is being used, and that it costs nothing. */
export const ANIMATED_STARTING = 'Creating a free animated video… I’ll use your photos where they fit, your brand colours, text and motion, and original music. It uses no Runway credits and takes about a minute.';
/** Said on the finished card for a free video. */
export const animatedNote = (music: string | null) => `Made with Pilot’s free animation: your photos where they fit, brand colours, text and motion. No Runway credits were used.${music ? ` Music: ${music}. It was made for this video, so there’s nothing to license.` : ''}`;

/** The warning shown BEFORE Runway is used, so the owner knows the cost and can say yes (or ask for the free version instead). */
export function runwayWarning(brief: Pick<CreativeBrief, 'length_seconds'>): string {
  const seconds = footageSeconds(brief.length_seconds);
  return `Using Runway: this will cost ${costWords(seconds)} (${seconds} seconds of AI-generated footage). The caption, the music and the ending card cost nothing extra. Say yes to go ahead, or say “make it animated” for the free version.`;
}

/** When Runway starts after a yes. */
export function runwayStarting(brief: Pick<CreativeBrief, 'length_seconds'>): string {
  return `Using Runway: this will cost ${costWords(footageSeconds(brief.length_seconds))}. I’ll plan about ${planScenes(brief.length_seconds).roles.length} short scenes, make each one, add a branded ending and original music, and join them into one vertical video. This usually takes a few minutes.`;
}

export { estimateCredits };
