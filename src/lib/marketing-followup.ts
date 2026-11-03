import { detectCreativeRequest } from './marketing-creative-mode';

/**
 * While Pilot is waiting on a brief ("Does this look right?"), what the owner's next message means. Plain, repeatable code (no AI),
 * so the same words always get the same answer:
 *  - confirm      "yes", "looks good", "go ahead", "create it", "make it": the brief is right
 *  - change       "make it darker", "make it 20 seconds", "change the ending", "more luxurious": the brief needs adjusting
 *  - new_request  a fresh request for something else ("make me an Instagram post for our cupcakes")
 *  - other        anything else, which is left to the normal chat
 * A message that confirms AND asks for a change ("yes but make it darker") is a change: nothing is confirmed that is being altered.
 */
export type FollowUp = 'confirm' | 'change' | 'new_request' | 'other';

/** Pilot's own confirmation messages contain one of these, so the chat can tell it is still in Marketing Creative Mode. */
export const MODE_MARKERS = ['Marketing Creative Mode is on', 'Marketing Creative Mode: confirmed'] as const;
export const isModeMessage = (assistantText: string) => MODE_MARKERS.some((marker) => assistantText.includes(marker));
/** True when the last thing Pilot said in the conversation was a Marketing Creative Mode message. */
export function lastAssistantInMode(messages: Array<{ role: string; content: string }>): boolean {
  const last = [...messages].reverse().find((message) => message.role === 'assistant');
  return !!last && isModeMessage(last.content);
}

const FILLER = new Set(['please', 'thanks', 'thank', 'you', 'pilot', 'now', 'then', 'and', 'also', 'so']);
const CONFIRM_VOCAB = new Set(['yes', 'yep', 'yeah', 'yup', 'sure', 'ok', 'okay', 'confirm', 'confirmed', 'approve', 'approved', 'perfect', 'great', 'good', 'fine', 'correct', 'right', 'proceed', 'looks', 'look', 'sounds', 'sound', 'that', 'thats', 'this', 'its', 'it', 'is', 'go', 'ahead', 'for', 'do', 'create', 'make', 'lets', 'let', 'us', 'happy', 'with', 'all', 'i', 'im', 'am', 'works', 'work', 'exactly', 'definitely', 'absolutely', 'totally']);
const CONFIRM_ANCHOR = /\b(?:yes|yep|yeah|yup|sure|ok|okay|confirm(?:ed)?|approved?|perfect|great|good|fine|correct|right|proceed|ahead|works?|exactly|definitely|absolutely|happy)\b|\b(?:make it|create it|do it|go for it|let'?s go|lets go)\b/;

export function isConfirmation(message: string): boolean {
  const normal = message.toLowerCase().replace(/['’]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = normal.split(' ').filter((word) => word && !FILLER.has(word));
  if (!words.length || words.length > 8) return false;
  return words.every((word) => CONFIRM_VOCAB.has(word)) && CONFIRM_ANCHOR.test(words.join(' '));
}

// pointing back at what was just shown ("make IT darker", "change THE ENDING")
const ANAPHORA = /\b(?:it|this|that|these|those|the\s+(?:video|post|brief|ending|end|opening|start|intro|music|text|style|look|colou?rs?|length|duration|pacing|tone|subject|caption|cta|song|sound|visuals?))\b/;
// words that ask for a change; the strong ones are enough on their own, the weak ones need to point back at the brief
const STRONG_CUE = /\b(?:more|less|darker|brighter|lighter|longer|shorter|faster|slower|bigger|smaller|bolder|simpler|cleaner|louder|quieter|calmer|change|swap|replace|add|remove|drop|instead|update|adjust|tweak|switch|rather|without)\b/;
const WEAK_CUE = /\b(?:make|use|include|exclude|keep|with|only|but|no|not|actually|rather)\b/;
const DURATION = /\b\d{1,3}\s*-?\s*(?:seconds?|secs?|s)\b/;
const STYLE_WORD = /\b(?:dark|bright|luxur\w*|elegant|minimal\w*|fun|playful|cinematic|retro|modern|bold|dramatic|professional|calm|energetic|expensive|premium|3d|christmas|halloween|valentine\w*|summer|tiktok|instagram|reel|story|video|post|people|logo|photos?|pictures?|colou?rs?|music|text|captions?)\b/;

// asking Pilot to make something FOR the owner ("make me a...", "I need a..."), as opposed to "make IT a TikTok", which changes the brief
const ASKS_FOR_NEW = /\b(?:(?:make|create|write|build|produce|design|generate|do)\s+(?:me|us)\b|i\s+(?:need|want)\b|i'?d\s+like\b|give\s+(?:me|us)\b|can\s+you\s+(?:make|create|write|build|do)\s+(?:me|us|a|an)\b|could\s+you\s+(?:make|create|write|build|do)\s+(?:me|us|a|an)\b)/;

export function classifyFollowUp(message: string): FollowUp {
  const text = message.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
  if (!text) return 'other';
  if (isConfirmation(text)) return 'confirm';
  const words = text.split(' ').length;
  if (words > 40) return 'other';
  // "Make ME a TikTok about pool closing. Make IT dark." asks for something new, even though it also says "make it"
  if (ASKS_FOR_NEW.test(text) && detectCreativeRequest(text).isCreative) return 'new_request';
  const wantsChange = (ANAPHORA.test(text) && (STRONG_CUE.test(text) || WEAK_CUE.test(text) || DURATION.test(text))) || DURATION.test(text) && words <= 14;
  if (wantsChange) return 'change';
  // "Make me an Instagram post for our cupcakes" asks for something else; it does not point back at this brief
  if (detectCreativeRequest(text).isCreative) return 'new_request';
  if (words <= 14 && (STRONG_CUE.test(text) || (WEAK_CUE.test(text) && STYLE_WORD.test(text)))) return 'change';
  return 'other';
}
