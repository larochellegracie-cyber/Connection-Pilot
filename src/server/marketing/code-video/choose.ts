import { stems, subjectTerms } from '../asset-selection.js';

/**
 * When Pilot writes its own video code. Pre-built scene templates suit what a business normally promotes (its services, with its own photos). The code
 * path is for what they do not suit: a request that asks for something creative or original, or a subject the business's information and photos say nothing
 * about (a chocolate cake for a pool company). Then Pilot writes a Python function that draws the video itself, in the sandbox.
 *
 * PILOT_CODE_VIDEO: "primary" (the default: custom code is the main path for every creative, styled, reference-based or higher-quality request; only plain, simple
 * requests that the templates fit keep the stable template path), "auto" (only for requests that ask for something custom or that the templates do not fit),
 * "request" (only when the owner asks for custom or code-written animation), "default" (every free video), "off" (never).
 */
export type CodeVideoMode = 'off' | 'request' | 'auto' | 'primary' | 'default';
export const codeVideoMode = (): CodeVideoMode => { const value = (process.env.PILOT_CODE_VIDEO ?? 'primary').trim().toLowerCase(); return value === 'off' || value === 'request' || value === 'default' || value === 'auto' ? value : 'primary'; };

const ASKED = /\b(?:custom(?:ised|ized)?[- ](?:animation|animated|video)|code[- ](?:drawn|written|based|animation|video)|(?:write|writes|written|generate)\s+(?:the\s+)?(?:animation|code|script)|python|manim|motion[- ]design(?:ed)?)\b/i;
export const wantsCodeVideo = (message: string) => ASKED.test(message);
/** Words that ask for something made up rather than a standard promo. */
const CREATIVE = /\b(?:creative(?:ly)?|invent\w*|original|unique|one[- ]of[- ]a[- ]kind|artistic|illustrat\w+|animated (?:story|illustration|scene|cartoon)|cartoon|surprise me|something (?:different|new|fun|special|unusual)|imaginative|storytell\w*|story[- ]?driven|from scratch|draw(?:n)? (?:it|the|a))\b/i;
export const wantsCreative = (message: string) => CREATIVE.test(message);

/**
 * Words that ask for more than a plain promo: a look, a feel, motion, effects, a higher standard, or to match something. A request with none of these (and
 * no reference) is "simple" and keeps the stable template path in primary mode.
 */
const POLISH = /\b(?:cinematic|premium|high[- ]?(?:quality|end|production)|polished|professional|luxur\w+|stunning|eye[- ]catching|slick|sleek|dramatic|epic|trend(?:y|ing)|viral|aesthetic|vibe|moody|bold|dynamic|energetic|punchy|fast[- ]paced|motion|kinetic|parallax|ken burns|zoom|transitions?|effects?|overlay|film|grain|colou?r[- ]?grade|slow[- ]?mo\w*|time[- ]?lapse|reveal|before (?:and|&) after|reels?|ads?|advert\w*|commercial|teaser|trailer|showcase|storyboard|scenes?|like (?:this|that|the)|similar to|same (?:style|look|vibe|feel)|recreate|inspired by|reference)\b/i;
export const wantsPolish = (message: string) => POLISH.test(message);

/**
 * Which look a custom video has. PHOTO: a realistic photograph is the main visual and code supplies the camera, light, grade and type. MOTION: invented graphics (task chips,
 * app cards that fill themselves in, counters, check and cross lists, gradient cards, cursors) with continuous motion and clean type, the way a product explainer or an offer
 * post is built; photos are optional and only used where one is clearly the right payoff. Motion is chosen when the request is explanatory or about an offer, price, steps,
 * features or a list, or when there is no photograph of the subject (and no ready-made prop to draw it with).
 */
export type CodeLook = 'photo' | 'motion';
const MOTION = /\b(?:explain\w*|how (?:it|this|we) works?|pric(?:e|es|ing)|plans?|offers?|deals?|features?|benefits?|steps?|process|compar\w+|vs\.?|ui|app|dashboard|infographic|motion[- ]graphics?|graphics?|stats?|numbers?|counter|checklist|lists?|before (?:and|&) after|why (?:choose|us)|booking|schedule|quote|invoice)\b/i;
export const wantsMotion = (message: string) => MOTION.test(message);
export const lookFor = ({ message, hasHeroPhoto, hasProp = false }: { message: string; hasHeroPhoto: boolean; hasProp?: boolean }): CodeLook => (wantsMotion(message) || (!hasHeroPhoto && !hasProp) ? 'motion' : 'photo');

export type BusinessWords = { businessName: string; businessType: string; services: string[]; description?: string; promotions?: string; sellingPoints?: string[] };
/** Whether the business's own information says anything about the subject (its services, description, offers). A subject with no specific words fits anything. */
export function subjectFits(subject: string, business: BusinessWords): boolean {
  const terms = subjectTerms(subject, business); if (!terms.length) return true;
  const known = new Set(stems([business.services.join(' '), business.description ?? '', business.promotions ?? '', (business.sellingPoints ?? []).join(' ')].join(' ')));
  const words = [...known];
  // "closing" and "closings" reduce to different stems, so a word also fits when one stem begins the other
  return terms.some((term) => known.has(term.stem) || (term.stem.length >= 4 && words.some((word) => word.startsWith(term.stem) || (word.length >= 4 && term.stem.startsWith(word)))));
}

export type CodeChoice = { use: boolean; /** write the scenes from drawing shapes (invent) rather than only arrange the scene library's */ invent: boolean; why: string };
export function chooseCodeVideo({ message, forced = false, invented = false, subject, business, hasPhotoMatch, hasReference = false, mode = codeVideoMode() }: { message: string; /** the owner attached a reference video or image to follow */ hasReference?: boolean; forced?: boolean; /** an earlier version of this video was invented, so a redo is too */ invented?: boolean; subject: string; business: BusinessWords; hasPhotoMatch: boolean; mode?: CodeVideoMode }): CodeChoice {
  if (mode === 'off') return { use: false, invent: false, why: 'off' };
  const creative = wantsCreative(message); const misfit = !hasPhotoMatch && !subjectFits(subject, business);
  const invent = invented || creative || misfit;
  if (forced) return { use: true, invent, why: 'earlier version was code-written' };
  if (wantsCodeVideo(message)) return { use: true, invent, why: 'the owner asked for custom animation' };
  if (mode === 'primary' && (hasReference || wantsPolish(message) || creative || misfit)) return { use: true, invent: true, why: hasReference ? 'a reference was given: the video is written as code to follow it' : creative || misfit ? 'the request is creative or the templates do not fit it' : 'the request asks for a styled, higher-quality video: custom code is the main path' };
  if (mode === 'default') return { use: true, invent, why: 'every free video is code-written' };
  if (mode === 'auto' && (creative || misfit)) return { use: true, invent: true, why: creative ? 'the request asks for something creative' : 'the business’s information and photos say nothing about this subject' };
  return { use: false, invent: false, why: 'the templates fit' };
}
