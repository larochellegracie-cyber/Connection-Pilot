import type { ContentKind, PlatformId } from './marketing-content';

/**
 * Reads what the owner typed and works out what Pilot should make, so they never pick formats themselves.
 * It only chooses between a post and a Standard Video. AI Video (Runway) is never chosen from words alone, because
 * it costs more: it stays a deliberate choice inside a video's own screen.
 */
export function readRequest(request: string): { kind: ContentKind; platform: PlatformId | null } {
  const text = request.toLowerCase();
  const video = /\b(videos?|reels?|clips?|tiktoks?|shorts?|commercials?|slideshows?|animation|animated)\b/.test(text) || /\b\d{1,2}\s*-?\s*(seconds?|secs?|s)\b/.test(text);
  const platform: PlatformId | null = /\binstagram\b|\binsta\b|\big\b/.test(text) ? 'instagram' : /\bfacebook\b|\bfb\b/.test(text) ? 'facebook' : /\btiktok\b/.test(text) ? 'tiktok' : /\blinkedin\b/.test(text) ? 'linkedin' : null;
  return { kind: video || platform === 'tiktok' ? 'video' : 'post', platform };
}

export const greetingFor = (timezone: string, now = new Date()) => {
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now)) % 24;
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
};

/** The few ideas shown under the box. They are examples to click, never required. */
export const requestExamples = ['Create a video for our new product', 'Make a post for this weekend', 'Create a Halloween promotion'];

// ---- talking to Pilot like an employee ---------------------------------------------------------------------------------

export type PilotAction = 'ideas' | 'make_idea' | 'plan_week' | 'create' | 'clarify';
/** ai_image is only ever chosen when the owner asks for an AI-generated picture in so many words. */
export type Medium = 'post' | 'video' | 'ai_video' | 'ai_image';
export type Understood = { action: PilotAction; medium: Medium | null; ideaNumber: number | null; platform: PlatformId | null; topic: string; when: string | null };

const ordinals: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6 };
const whenWords = /\b(this weekend|this week|next week|today|tomorrow|tonight|this month|next month)\b/;
const aiWords = /\b(realistic|cinematic|photo-?realistic|ai[- ]generated|generated (?:video|footage)|ai (?:video|footage|clip)|real footage|runway)\b/i;
/** "AI picture", "AI-generated image", "generate an AI photo": an explicit request for an AI-made picture. Never guessed from other words. */
const aiImageWords = /\b(?:ai|a\.i\.)[- ]?(?:generated\s+)?(?:pictures?|images?|photos?|photographs?|illustrations?)\b|\b(?:generate|generated)\s+(?:me\s+|us\s+)?(?:an?\s+)?(?:realistic\s+)?(?:pictures?|images?|photos?)\b/i;
const videoAsked = /\b(videos?|reels?|clips?|tiktoks?|shorts?|commercials?)\b|\b\d{1,2}\s*-?\s*(?:seconds?|secs?|s)\b/i;
const LEAD = new Set(['pilot', 'please', 'can', 'could', 'would', 'you', 'i', 'want', 'need', 'id', 'like', 'lets', 'make', 'create', 'write', 'give', 'build', 'design', 'produce', 'generate', 'do', 'me', 'us', 'my', 'our', 'a', 'an', 'the', 'some', 'something', 'anything', 'for', 'about', 'on', 'regarding', 'promoting', 'promote', 'to', 'of', 'and']);
const KIND = new Set(['post', 'posts', 'video', 'videos', 'reel', 'reels', 'clip', 'clips', 'ad', 'ads', 'advert', 'content', 'instagram', 'insta', 'facebook', 'tiktok', 'linkedin', 'ai', 'realistic', 'cinematic', 'something', 'anything', 'picture', 'pictures', 'image', 'images', 'generated', 'aigenerated']);
const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What the request is about, with the request words taken out: "pool closing service", "Halloween", or nothing at all. */
function subjectOf(text: string, businessName: string): string {
  let rest = text;
  if (businessName) {
    rest = rest.replace(new RegExp(`\\b${businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
    const first = businessName.split(/\s+/)[0];
    if (first.length >= 4) rest = rest.replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  }
  const words = rest.split(/\s+/).filter(Boolean).filter((word) => !KIND.has(bare(word)) && !/^\d{1,2}-?(seconds?|secs?|s)$/i.test(word) && !/^\d{1,2}$/.test(word));
  while (words.length && LEAD.has(bare(words[0]))) words.shift();
  const subject = words.join(' ').replace(/[\s,.!?;:]+$/g, '').replace(/^[\s,.!?;:]+/g, '').trim();
  return subject.length < 3 ? '' : subject;
}

/**
 * Works out what the owner is asking for, in plain words. It decides between ideas, "make idea #3", a week plan, or making
 * something, and (for making something) a post, a video or an AI video. Standard Video is the default for every video.
 * AI video needs the owner to ask for realistic, cinematic or AI-generated footage in so many words. It is never guessed.
 */
export function understand(message: string, businessName = ''): Understood {
  const text = message.trim();
  const lower = text.toLowerCase();
  const { kind, platform } = readRequest(text);
  const aiImage = aiImageWords.test(text) && !videoAsked.test(text);
  const medium: Medium | null = aiImage ? 'ai_image' : aiWords.test(text) ? 'ai_video' : /\b(videos?|reels?|clips?|tiktoks?|shorts?|commercials?)\b/.test(lower) || /\b\d{1,2}\s*-?\s*(seconds?|secs?|s)\b/.test(lower) ? 'video' : /\b(posts?|captions?)\b/.test(lower) ? 'post' : null;

  const numbered = lower.match(/(?:#|\bidea\s*#?|\bnumber\s*|\bno\.?\s*|\boption\s*)(\d{1,2})\b/) ?? lower.match(/^\s*(?:pilot[, ]*)?(?:make|do|create|use|go with|let['’]s do)?\s*(\d{1,2})\s*[.!]?\s*$/);
  const ordinal = lower.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\s+(?:one|idea|option)\b/);
  const ideaNumber = numbered ? Number(numbered[1]) : ordinal ? ordinals[ordinal[1]] : null;
  const makesSomething = /\b(make|create|do|use|go with|build|write|let['’]s do|i['’]ll take|i want)\b/.test(lower) || /^\s*#?\d{1,2}\s*[.!]?\s*$/.test(lower);
  if (ideaNumber && makesSomething) return { action: 'make_idea', medium, ideaNumber, platform, topic: '', when: null };

  if (/\bplan\b.*\b(week|month|content|posts?)\b|\bcontent (plan|calendar)\b|\bplan (my|the|our) (week|month)\b/.test(lower)) return { action: 'plan_week', medium: null, ideaNumber: null, platform, topic: '', when: null };
  if (!/\b(make|create|write|build)\s+(me\s+|us\s+)?(a|an|the)\s/.test(lower) && /\bideas?\b|what should (i|we) (post|share|make|create|do)|what (can|could) (i|we) post|suggest|recommend|inspir|brainstorm/.test(lower)) return { action: 'ideas', medium: null, ideaNumber: null, platform, topic: '', when: null };

  const when = lower.match(whenWords)?.[1] ?? null;
  // for an AI picture the subject is what the owner described: "... picture of a pool technician closing a pool"
  const described = aiImage ? text.match(/\b(?:pictures?|images?|photos?|photographs?|illustrations?)\s+(?:of|showing|with|depicting)\s+(.+?)[\s.!?]*$/i)?.[1]?.trim() : undefined;
  const subject = described || subjectOf(when ? text.replace(new RegExp(`\\b${when}\\b`, 'i'), ' ') : text, businessName);
  // a greeting or a question about Pilot is not a request: ask one short question instead of guessing
  if (!medium && !when && /^\s*(pilot[, ]*)?(hi|hello|hey|help|thanks?|thank you|yes|yep|yeah|yup|ok|okay|sure|no|nope|go ahead|looks good|that looks good|perfect|great|what can you do\??|\?+)\s*[.!?]*\s*$/i.test(text)) return { action: 'clarify', medium: null, ideaNumber: null, platform, topic: '', when: null };
  return { action: 'create', medium: medium ?? (kind === 'video' ? 'video' : 'post'), ideaNumber: null, platform, topic: subject, when };
}

const addDays = (day: string, days: number) => { const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); };

/** A sensible day to suggest when the owner asked for something "this weekend" or "tomorrow". They can always change it. */
export function suggestedDay(message: string, today: string): string {
  const lower = message.toLowerCase();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  if (/\bthis weekend\b/.test(lower)) return addDays(today, weekday === 6 ? 0 : weekday === 0 ? 0 : 6 - weekday);
  if (/\bnext week\b/.test(lower)) return addDays(today, ((8 - weekday) % 7) || 7);
  return today;
}
