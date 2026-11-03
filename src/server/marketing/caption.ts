import { fitToPlatform, platformSpecs, stripUnsupportedClaims, type PlatformId } from '@/lib/marketing-content.js';
import type { CreativeBrief } from './creative-brief.js';
import { briefText, type Complete, type MarketingInput } from './generate.js';
import { stems } from './asset-selection.js';
import { parseJson } from './trends.js';

/**
 * The caption for a finished video, written as its own step so it can be held to a standard:
 *  - the first line is a HOOK that stops the scroll (a specific question, a bold fact or a clear benefit), never a restatement of the
 *    topic ("Adding salt to your pool.") and never the business's name or a stock opener ("Check out", "Introducing"...),
 *  - it sounds like the business (its brand voice) and like the brief's style (dark and cinematic reads differently from fun),
 *  - a short body with one real fact from the business, then a call to action built only from real contact details,
 *  - a few relevant hashtags kept apart from the words (niche topic, place, brand), not generic filler.
 * The draft is checked in code. If it falls short, the AI gets the specific problems and one more try; if that fails too, a plain but
 * honest caption is built from the facts, so a video always has a usable caption.
 */
export type CaptionResult = { caption: string; hashtags: string[]; cta: string; end_card_text: string; source: 'ai' | 'retry' | 'fallback'; problems: string[] };

const HOOK_LIMIT: Record<string, number> = { tiktok: 90, instagram: 110, facebook: 120, linkedin: 120 };
const OPENERS = /^(?:introducing|check out|are you ready|we(?:'re| are) (?:excited|proud|thrilled|pleased|happy)|did you know that|looking for|welcome to|here at|at [A-Z][\w' ]+,|hey (?:there|guys|everyone)|attention)/i;
const GENERIC = /\b(?:world[- ]class|best[- ]in[- ]class|top[- ]notch|look no further|game[- ]?changer|one[- ]stop[- ]shop|elevate your|unlock the|dive (?:in|into)|take your .{1,25} to the next level|state[- ]of[- ]the[- ]art|cutting[- ]edge|second to none|your satisfaction is our|we pride ourselves)\b/i;
const BANNED_TAGS = new Set(['love', 'instagood', 'photooftheday', 'follow', 'followme', 'like4like', 'likeforlike', 'picoftheday', 'viral', 'trending', 'explore']);
const EMOJI = /\p{Extended_Pictographic}/u;

/** The voice to write in: the brief's style words and the business's own brand voice, as plain instructions. */
export function captionVoice(style: string[], brandTone: string): { text: string; emoji: boolean } {
  const words = style.join(' ').toLowerCase();
  const parts: string[] = [];
  if (brandTone) parts.push(`the business's own voice (${brandTone})`);
  if (/\b(?:dark|cinematic|dramatic|moody)\b/.test(words)) parts.push('short, punchy lines with a confident, dramatic edge');
  if (/\b(?:luxury|elegant|premium|expensive)\b/.test(words)) parts.push('refined and understated, never pushy');
  if (/\b(?:fun|playful|cheerful|summer|christmas|valentine)\b/.test(words)) parts.push('light, warm and a little playful');
  if (/\b(?:fast|high energy|energetic|bold|attention-grabbing)\b/.test(words)) parts.push('quick, energetic, very short sentences');
  if (/\b(?:calm|slow|peaceful)\b/.test(words)) parts.push('calm and reassuring');
  if (/\b(?:professional|corporate|minimal)\b/.test(words)) parts.push('clear and professional');
  return { text: parts.length ? parts.join('; ') : 'natural, friendly and plain-spoken', emoji: /\b(?:fun|playful|cheerful|summer|christmas|valentine)\b/.test(words) || /\b(?:fun|playful|friendly|warm)\b/i.test(brandTone) };
}

const SYSTEM = `You write the caption for ONE small business's short social video, in that business's own voice.
Structure (strict):
- Line 1 is the HOOK, one short line that makes someone stop scrolling: a specific question, a surprising or useful fact from the business facts, or a clear benefit. It must NOT just restate the topic, must NOT start with the business name, and must NOT open with "Introducing", "Check out", "Are you ready", "Looking for", "We're excited" or similar.
- Then 1 to 3 short lines: what the viewer gets, using ONE real fact from the business information (a real service, place, or detail).
- Then one call-to-action line using ONLY real contact details or website from the business information. If there are none, say to send a message.
- Hashtags are NOT part of the caption. Give them separately.
Hashtags: relevant and specific, no generic filler (#love, #instagood, #viral): one or two for the topic, one for the place, one for the business name.
Honesty (strict): use only facts you are given. Never invent offers, prices, awards, results, customers or testimonials. No "viral", no guarantees. No cliches such as "world-class", "look no further", "game-changer", "elevate your".
Plain language, natural, like a person wrote it. No hashtags or emoji inside the first line.
Reply with JSON only: {"caption": "the hook, then the lines, then the call to action, separated by blank lines", "hashtags": ["..."], "cta": "the call to action line on its own", "end_card_text": "max 80 characters for the video's closing card: the call to action"}`;

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const firstLine = (caption: string) => caption.split(/\n+/)[0]?.trim() ?? '';

/** Hashtags as clean tags: one word each, no spaces or symbols, no generic filler, no duplicates. */
export function cleanHashtags(tags: unknown[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const body = tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (body.length < 3 || body.length > 30 || BANNED_TAGS.has(body.toLowerCase()) || out.some((t) => t.toLowerCase() === `#${body}`.toLowerCase())) continue;
    out.push(`#${body}`);
  }
  return out;
}

const camel = (text: string) => text.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const lastWord = (text: string) => text.split(/\s+/).filter(Boolean).pop() ?? '';

export type CaptionContext = { brief: CreativeBrief; input: MarketingInput; platform: PlatformId };

/** What is wrong with a caption, in plain words. An empty list means it meets the standard. */
export function checkCaption(caption: string, hashtags: string[], ctx: CaptionContext): string[] {
  const { brief, input, platform } = ctx; const problems: string[] = [];
  const hook = firstLine(caption);
  const limit = HOOK_LIMIT[platform] ?? 110;
  const voice = captionVoice(brief.style, input.brief.brandVoice.tone);
  if (hook.length < 12) problems.push('The first line is too short to be a hook.');
  if (hook.length > limit) problems.push(`The first line is ${hook.length} characters; a hook must be ${limit} or fewer.`);
  const topic = new Set(stems(brief.main_subject)); const hookWords = stems(hook);
  if (topic.size && hookWords.length && hookWords.filter((w) => !topic.has(w)).length <= 1) problems.push('The first line only restates the topic. Make it a question, a specific fact or a clear benefit.');
  if (OPENERS.test(hook)) problems.push('The first line opens with a stock phrase. Start with something specific.');
  if (input.brief.businessName && hook.toLowerCase().startsWith(input.brief.businessName.toLowerCase().slice(0, 12))) problems.push('The first line starts with the business name. Lead with the viewer’s interest.');
  if (/#\w/.test(caption)) problems.push('Hashtags belong in the hashtag list, not in the caption.');
  if (GENERIC.test(caption)) problems.push('It uses a generic marketing phrase. Say something specific.');
  if (!voice.emoji && EMOJI.test(caption)) problems.push('Remove the emoji; they do not fit this voice.');
  const hasContact = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}|\b[a-z0-9-]+\.(?:com|ca|net|org|co)\b|\b(?:call|book|visit|message|dm|text|order)\b/i.test(caption);
  if (!hasContact) problems.push('There is no call to action. Say how to book or get in touch, using real details.');
  if (caption.split(/\n+/).filter(Boolean).length < 2) problems.push('It needs a hook, a short body and a call to action on separate lines.');
  const lastLine = caption.split(/\n+/).filter(Boolean).pop() ?? '';
  if (hasContact && !/\b(?:call|book|visit|message|dm|text|order|shop|reserve|schedule|ask|get a quote|contact|email)\b/i.test(lastLine)) problems.push('The last line should tell people what to do (call, book, visit or message), not just give a number or address.');
  // the caption has to be about the video: it mentions the subject ("salt", "closing"...), not just the business in general
  const shared = new Set(stems(`${input.brief.businessName} ${input.brief.businessType}`));
  const subjectTerms = stems(brief.main_subject).filter((word) => !shared.has(word) && word.length >= 4);
  const captionStems = stems(caption);
  if (subjectTerms.length && !subjectTerms.some((term) => captionStems.some((word) => word.startsWith(term) || (word.length >= 4 && term.startsWith(word))))) problems.push(`It never mentions what the video is about (${brief.main_subject}). Work the subject into the hook or the body.`);
  const wanted = platform === 'tiktok' ? [3, 5] : [4, 8];
  if (hashtags.length < wanted[0]) problems.push(`It needs at least ${wanted[0]} relevant hashtags.`);
  return problems;
}

/** A plain, honest caption built from the facts, for when the AI cannot meet the standard. */
export function fallbackCaption(ctx: CaptionContext): { caption: string; hashtags: string[]; cta: string; end_card_text: string } {
  const { brief, input } = ctx; const b = input.brief;
  const subject = brief.main_subject.replace(/^general promotion of .*/i, '').trim();
  const place = b.location ? ` in ${b.location}` : '';
  const hook = subject ? `Thinking about ${subject}? Here’s what to know.` : `Here’s how ${b.businessName || 'we'} can help${place}.`;
  const fact = b.services.length ? `${b.businessName || 'We'} handle${b.businessName ? 's' : ''} ${b.services.slice(0, 3).join(', ').toLowerCase()}${place}.` : `${b.businessName || 'We'} ${b.businessName ? 'is' : 'are'} here to help${place}.`;
  const contact = /\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/.exec(`${b.hours} ${b.description} ${b.websiteNotes.join(' ')} ${b.learned.join(' ')}`)?.[0];
  const cta = b.website ? `Book at ${b.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}${contact ? ` or call ${contact}` : ''}.` : contact ? `Call ${contact} to book.` : 'Send us a message to book.';
  const tags = cleanHashtags([...stems(subject).slice(0, 2).map((w) => (w.length > 3 ? w : '')), b.businessType ? camel(lastWord(b.businessType)) : '', b.location ? camel(b.location.split(',')[0].replace(/\s+/g, '')) : '', b.businessName ? camel(b.businessName) : '', subject ? camel(subject.split(/\s+/).slice(0, 2).join(' ')) : '']);
  return { caption: `${hook}\n\n${fact}\n\n${cta}`, hashtags: tags.slice(0, brief.platform === 'tiktok' ? 5 : 8), cta, end_card_text: cta.replace(/\.$/, '').slice(0, 80) };
}

export type CaptionRequest = CaptionContext & { complete: Complete; scenes?: string[]; /** the owner's change to the caption, when this is a rewrite */ instruction?: string; previous?: { caption: string; hashtags: string[] } };

export async function writeCaption(request: CaptionRequest): Promise<CaptionResult> {
  const { brief, input, platform, complete } = request;
  const voice = captionVoice(brief.style, input.brief.brandVoice.tone);
  const spec = platformSpecs[platform];
  const base = [
    briefText(input),
    `The video is about: ${brief.main_subject}.${request.scenes?.length ? ` What happens in it: ${request.scenes.join(' ')}` : ''}`,
    `Platform: ${spec.label}. ${spec.style}`,
    `Voice to write in: ${voice.text}.${voice.emoji ? ' A single emoji is fine, but never in the first line.' : ' No emoji.'}`,
    brief.key_instructions.length ? `The owner also asked for: ${brief.key_instructions.join('; ')}.` : '',
    request.instruction ? `The owner asked for this change to the caption: "${request.instruction.slice(0, 300)}". Previous caption:\n${request.previous?.caption ?? ''}` : '',
  ].filter(Boolean).join('\n\n');

  const attempt = async (feedback: string[]) => {
    const raw = parseJson(await complete(SYSTEM, feedback.length ? `${base}\n\nYour last draft had these problems. Fix every one:\n- ${feedback.join('\n- ')}` : base));
    // claims are removed line by line, so the hook / body / call-to-action layout survives (the stripper joins sentences with spaces)
    const caption = clean(raw.caption, 2400).split('\n').map((line) => (line.trim() ? stripUnsupportedClaims(line) : '')).join('\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const hashtags = cleanHashtags(Array.isArray(raw.hashtags) ? raw.hashtags : []);
    if (!caption) throw new Error('empty');
    return { caption, hashtags, cta: clean(raw.cta, 200), endText: clean(raw.end_card_text, 80) };
  };
  const finish = (draft: { caption: string; hashtags: string[]; cta: string; endText: string }, source: 'ai' | 'retry', problems: string[]): CaptionResult => {
    const fitted = fitToPlatform(platform, { caption: draft.caption, hashtags: draft.hashtags });
    return { caption: fitted.caption, hashtags: fitted.hashtags, cta: draft.cta || lastLineOf(fitted.caption), end_card_text: draft.endText || (draft.cta || lastLineOf(fitted.caption)).replace(/\.$/, '').slice(0, 80), source, problems };
  };
  const lastLineOf = (caption: string) => caption.split(/\n+/).filter(Boolean).pop() ?? '';

  let problems: string[] = [];
  try {
    const first = await attempt([]);
    problems = checkCaption(first.caption, first.hashtags, request);
    if (!problems.length) return finish(first, 'ai', []);
    const second = await attempt(problems);
    const remaining = checkCaption(second.caption, second.hashtags, request);
    if (!remaining.length) return finish(second, 'retry', []);
    problems = remaining;
  } catch { /* fall back below */ }
  const plain = fallbackCaption(request);
  const fitted = fitToPlatform(platform, { caption: plain.caption, hashtags: plain.hashtags });
  return { caption: fitted.caption, hashtags: fitted.hashtags, cta: plain.cta, end_card_text: plain.end_card_text, source: 'fallback', problems };
}

const END_SYSTEM = `You write the words for the closing card of a short social video for ONE small business: a call to action of at most 80 characters, using ONLY real contact details or website from the business information. No hashtags, no emoji, no guarantees.
Reply with JSON only: {"end_card_text": "..."}`;

/** New words for the ending when the owner asked to change it without saying what to put. Keeps the old words if the AI cannot be asked. */
export async function reviseEndText({ previous, instruction, input, complete }: { previous: string; instruction: string; input: MarketingInput; complete: Complete }): Promise<string> {
  try {
    const raw = parseJson(await complete(END_SYSTEM, `${briefText(input)}\n\nThe closing card says now: "${previous}"\nThe owner asked: "${instruction.slice(0, 300)}". Write different words that follow their request.`));
    const text = clean(raw.end_card_text, 80).replace(/\n/g, ' ');
    if (text && text.toLowerCase() !== previous.toLowerCase()) return text;
  } catch { /* the old words are kept */ }
  return previous;
}

