/**
 * Marketing Creative Mode, step one: noticing that the owner is asking Pilot to MAKE marketing content (a video, a TikTok, an
 * Instagram post, a reel, a story, an ad, a commercial, a promotion...). This is plain, repeatable code (no AI call), so the same
 * words always give the same answer and it costs nothing. It only decides yes or no and says what it saw.
 *
 * It looks for two things together: an intent to make something, and a marketing thing to make. A word like "post" or "video" on
 * its own is not enough ("post this invoice", "video call with Sam", "reel in new customers" are not creative requests).
 */
export type CreativeFormat = 'video' | 'tiktok' | 'reel' | 'story' | 'social_post' | 'ad' | 'commercial' | 'promotion' | 'graphic' | 'caption' | 'something_creative';
export type CreativePlatform = 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'youtube';
export type CreativeDetection = {
  isCreative: boolean;
  formats: CreativeFormat[];
  platform: CreativePlatform | null;
  /** The words that triggered it, so the owner and the logs can see why. */
  matched: string[];
};

const NOT_CREATIVE: CreativeDetection = { isCreative: false, formats: [], platform: null, matched: [] };

// something the owner wants made, or wants help making
const MAKE = /\b(?:make|making|create|creating|build|produce|design|generate|write|draft|shoot|film|edit|prepare|put together|come up with|cook up|whip up|i need|i want|i['’]d like|need|want|give me|can you do|could you do|do me|let['’]s make|let['’]s do)\b/;
const NOUN_VIDEO = /\b(?:videos?|clips?|short videos?|shorts?)\b/;

// things that look like marketing words but are something else
const EXCLUDE = [
  /\bvideo\s*(?:call|calls|meeting|chat|conference|visit|tour|consultation)\b/, /\b(?:zoom|teams|facetime)\b.{0,12}\bvideo\b/,
  /\bpost\s+(?:a\s+|the\s+|this\s+|that\s+)?(?:job|jobs|opening|listing|payment|payments|invoice|entry|journal|transaction|bail|bond)\b/,
  /\breel(?:s)?\s+in\b|\breeling\b/, /\bad\s+hoc\b/, /\bpost\s*(?:office|code|al)\b/,
];

type Rule = { format: CreativeFormat; pattern: RegExp; label: string; platform?: CreativePlatform };
const NOUN_RULES: Rule[] = [
  { format: 'tiktok', pattern: /\btik\s?toks?\b/, label: 'TikTok', platform: 'tiktok' },
  { format: 'reel', pattern: /\breels?\b/, label: 'reel', platform: 'instagram' },
  { format: 'story', pattern: /\b(?:instagram|facebook|fb|insta|ig)\s+stor(?:y|ies)\b|\bsocial\s+stor(?:y|ies)\b|\bstor(?:y|ies)\s+(?:for|on)\s+(?:instagram|facebook|insta|ig)\b/, label: 'story' },
  { format: 'social_post', pattern: /\b(?:instagram|facebook|fb|insta|ig|linkedin|social(?:\s+media)?)\s+(?:post|posts|content|carousel|graphic)\b|\b(?:post|posts)\s+(?:for|on)\s+(?:instagram|facebook|fb|insta|ig|linkedin|social)\b|\b(?:a|an|some|the)\s+(?:new\s+)?post\s+(?:for|about)\b|\b(?:make|create|write|do)\s+(?:me\s+|us\s+)?(?:a|an|another|some)\s+(?:\w+\s+)?post\b/, label: 'social post' },
  { format: 'caption', pattern: /\b(?:instagram|facebook|fb|insta|ig|linkedin|social(?:\s+media)?)\s+captions?\b|\bcaptions?\s+for\s+(?:instagram|facebook|insta|ig|a post|my post)\b/, label: 'caption' },
  { format: 'ad', pattern: /\b(?:an?|the|our|my|new|some)\s+(?:\w+\s+)?(?:ads?|adverts?|advertisements?)\b(?!\s*hoc)|\b(?:ads?|adverts?)\s+(?:for|about)\b|\b(?:facebook|instagram|google|tiktok)\s+ads?\b/, label: 'ad' },
  { format: 'commercial', pattern: /\b(?:a|an|the|our|my|short|quick|tv|video)\s+commercials?\b(?!\s+(?:pool|property|properties|customers?|clients?|accounts?|buildings?|jobs?|quotes?|services?|cleaning|rates?|use|space|zone|revenue|work|contracts?))/, label: 'commercial' },
  { format: 'graphic', pattern: /\b(?:flyers?|posters?|banners?|social graphics?|promo graphics?)\b/, label: 'graphic' },
  { format: 'promotion', pattern: /\b(?:promote|promoting|advertis(?:e|ing)|market(?:ing)?\s+(?:our|my|the|this|a|an|new))\b(?!\s+(?:share|research|rate|value|price))|\b(?:a|an|the|new)\s+promo(?:tion)?\b|\bpromo\s+(?:video|post|for)\b/, label: 'promotion' },
  { format: 'something_creative', pattern: /\b(?:something|anything|stuff|content)\s+(?:creative|fun|catchy|eye[- ]catching|for\s+(?:valentine|christmas|halloween|easter|black friday|mother|father|summer|spring|fall|winter|the holidays?|this weekend|tomorrow|a promotion|our promotion|the weekend))|\bsurprise me\b|\b(?:be|get)\s+creative\b/, label: 'something creative' },
];

const PLATFORMS: Array<[CreativePlatform, RegExp]> = [
  ['tiktok', /\btik\s?tok\b/], ['instagram', /\binstagram\b|\binsta\b|\big\b|\breels?\b/], ['facebook', /\bfacebook\b|\bfb\b/], ['linkedin', /\blinkedin\b/], ['youtube', /\byoutube\b|\byt shorts?\b/],
];

export function detectCreativeRequest(message: string): CreativeDetection {
  const text = message.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  if (!text) return NOT_CREATIVE;
  const cleaned = EXCLUDE.reduce((rest, pattern) => rest.replace(pattern, ' '), text);

  const intent = MAKE.test(cleaned) || /^(?:pilot[, ]+)?(?:an?\s+|some\s+)?(?:\w+\s+){0,2}(?:post|video|reel|tiktok|ad|story|commercial)\s+(?:for|about)\b/.test(cleaned);
  const formats: CreativeFormat[] = []; const matched: string[] = [];
  for (const rule of NOUN_RULES) { const hit = cleaned.match(rule.pattern); if (hit) { formats.push(rule.format); matched.push(hit[0].trim()); } }
  const video = cleaned.match(NOUN_VIDEO);
  if (video && !formats.includes('tiktok') && !formats.includes('reel')) { formats.push('video'); matched.push(video[0]); }

  // "promote" and "advertise" are requests on their own; every other format needs an intent to make something
  const standalone = formats.includes('promotion') && /\b(?:promote|advertis(?:e|ing))\b/.test(cleaned);
  if (!formats.length || (!intent && !standalone)) return NOT_CREATIVE;
  const platform = PLATFORMS.find(([, pattern]) => pattern.test(cleaned))?.[0] ?? null;
  return { isCreative: true, formats: [...new Set(formats)], platform, matched: [...new Set(matched)] };
}

const formatWords: Record<CreativeFormat, string> = { video: 'a video', tiktok: 'a TikTok', reel: 'a reel', story: 'a story', social_post: 'a social post', ad: 'an ad', commercial: 'a commercial', promotion: 'a promotion', graphic: 'a graphic', caption: 'a caption', something_creative: 'something creative' };
const platformWords: Record<CreativePlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube' };

/** "a TikTok for Instagram", "a social post for Instagram", "an ad": how the request is described back to the owner. */
export function describeRequest(detection: CreativeDetection): string {
  const kinds = detection.formats.filter((format) => !(format === 'video' && detection.formats.some((other) => other === 'tiktok' || other === 'reel')));
  const things = kinds.length > 1 ? `${kinds.slice(0, -1).map((format) => formatWords[format]).join(', ')} and ${formatWords[kinds[kinds.length - 1]]}` : formatWords[kinds[0] ?? 'something_creative'];
  const alreadyNamed = detection.platform && (detection.formats.includes('tiktok') && detection.platform === 'tiktok');
  return detection.platform && !alreadyNamed ? `${things} for ${platformWords[detection.platform]}` : things;
}
