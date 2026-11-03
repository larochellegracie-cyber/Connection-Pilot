import { removeUngrounded } from '../standard-video/planner.js';
import { stripUnsupportedClaims } from '@/lib/marketing-content.js';
import { slotName, type Blueprint } from '../reference/style.js';

/**
 * The storyboard of an explainer video: a short list of scenes, each with what is shown and what the voice says. A text model writes it from the
 * business's own information; plain code then checks every string (no invented numbers, prices, links, phone numbers or customer names; short
 * labels; the scene kinds Pilot can draw; photos only by name) before anything is drawn. The model never writes code for this path.
 */
export type ExplainerScene =
  | { type: 'intro'; headline: string; subtext: string; labels: string[]; narration: string }
  | { type: 'orbit'; headline: string; subtext: string; labels: string[]; narration: string }
  | { type: 'chaos'; headline: string; subtext: string; labels: string[]; narration: string }
  | { type: 'form'; title: string; fields: Array<[string, string]>; button: string; success: string; narration: string }
  | { type: 'schedule'; title: string; entries: Array<[string, number, string]>; narration: string }
  | { type: 'chat'; title: string; messages: Array<['customer' | 'business', string]>; narration: string }
  | { type: 'steps'; headline: string; items: string[]; photo: string | null; narration: string }
  | { type: 'photo'; headline: string; subtext: string; photo: string; narration: string }
  | { type: 'swap'; lead: string; words: string[]; tail: string; card: 'bars' | 'list' | 'line'; items: string[]; brandLine: string; cta: string; narration: string }
  | { type: 'cta'; headline: string; photo: string | null; narration: string };
export type ExplainerStoryboard = { title: string; character: 'pilot' | 'logo'; scenes: ExplainerScene[]; theme?: 'light' | 'dark'; glow?: number };

export const sceneTypes = ['orbit', 'swap', 'intro', 'chaos', 'form', 'schedule', 'chat', 'steps', 'photo', 'cta'] as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GENERIC_VALUE = /^(?:(?:next |this )?(?:mon|tues|wednes|thurs|fri|satur|sun)day(?: morning| afternoon)?|next available|this week|any day|morning|afternoon|as soon as possible)$/i;

/** Words that make a request an explainer (a walk-through with a voice), as opposed to an ordinary promo. */
const ASKED = /\b(?:explain\w*|explainer|walk[- ]?through|how (?:\w+ ){0,3}(?:works?|helps?|can help|saves?)|voice[- ]?over|narrat\w+|tutorial|demo(?:nstrat\w+)?|promo video|product video)\b/i;
export const wantsExplainer = (message: string) => ASKED.test(message);
/** PILOT_EXPLAINER_VIDEO: request (default, only when the owner asks for an explainer or voiceover), default (every free video), off. */
export const explainerMode = (): 'off' | 'request' | 'default' => { const value = (process.env.PILOT_EXPLAINER_VIDEO ?? 'request').trim().toLowerCase(); return value === 'off' || value === 'default' ? value : 'request'; };
export const useExplainer = (message: string) => { const mode = explainerMode(); return mode !== 'off' && (mode === 'default' || wantsExplainer(message)); };

const SYSTEM = `You are Pilot's explainer-video writer. You write the storyboard for a short, clean, friendly explainer video for a small business, shown as animated scenes with a voiceover.
Reply with ONLY JSON: {"title": string, "scenes": [scene, ...]} with 5 to 7 scenes. Scene kinds (use "type" exactly):
- "intro": {"headline", "subtext", "labels": [up to 6 short task names]}: the opening; a friendly character with faint floating task bubbles.
- "orbit": {"headline", "subtext", "labels": [5 to 8 short service or task names, 3 words at most]}: the character in the middle with glowing discs, one per label, circling it in 3D-style depth, then the headline.
- "chaos": {"headline", "subtext", "labels": [10 to 14 short, real tasks of this kind of business]}: "so many things to do": task bubbles pile up, then the answer arrives as the headline.
- "form": {"title", "fields": [[label, value], ...up to 3], "button", "success"}: a booking or enquiry form that fills itself in. Values must be the business's own name, a service it offers, or a day and time of day such as "Next Tuesday morning". Never invent a customer's name, phone number or address.
- "schedule": {"title", "entries": [[day, slot, label], ...up to 7]}: a week that builds itself. day is Mon, Tue, Wed, Thu or Fri; slot is 0 (morning) to 4 (evening); label is a service name of at most 14 characters.
- "chat": {"title", "messages": [["customer"|"business", text], ...3 or 4]}: a short conversation: a customer asks, the business (answering through its assistant) replies helpfully and ends with the booking confirmed.
- "steps": {"headline", "items": [up to 4 short steps], "photo": null or a photo name}
- "photo": {"headline", "subtext", "photo": a photo name}: only if a photo is listed
- "swap": {"lead", "words": [2 to 5 single words], "tail", "card": "bars"|"list"|"line", "items": [up to 4 short labels], "brandLine", "cta"}: a headline whose key word changes ("lead" + one of "words", e.g. lead "Run your", words ["bookings","schedule","reminders"]) over a clean interface card, then a closing line ("tail", e.g. "all in one place"), a short brand line and a button label. Lead and tail are 1 to 4 words each. Each of the "words" must be a single plain noun that completes the lead sentence naturally (for example lead "Run your" with bookings, schedule, reminders; never a verb or an adjective).
- "cta": {"headline", "photo": null or a photo name}: the ending, always last.
Every scene also has "narration": what the voice says over it, one or two short natural sentences (10 to 20 words in all), warm and plain, written to be heard (contractions are fine).
Rules: use only facts about the business that you are given. Never invent prices, discounts, numbers, years, awards, reviews, phone numbers, web addresses or claims. Do not use digits at all. Do not name real people. Keep every label to 4 words or fewer and every headline to 8 words or fewer; a subtext is one short phrase (up to 8 words) that is a complete thought. Aim for the length given in total (about 6 to 8 seconds per scene). Start with an intro or chaos scene and end with cta. Use a "form" or "schedule" or "chat" scene whenever the subject is about booking, scheduling or answering customers. Use "photo" scenes only for listed photos.`;

export type StoryboardInput = {
  /** the structure to copy from the owner's reference video, when there is one */ blueprint?: Blueprint | null;
  request: string; business: { name: string; type: string; location: string; services: string[]; description: string; tone: string }; photos: Array<{ name: string; label: string }>; character: 'pilot' | 'logo'; targetSeconds: number;
};
export type CompleteText = (system: string, prompt: string) => Promise<string>;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/[‐-―]/g, '-').trim().slice(0, max) : '');

/** Text a viewer will see or hear, with any number, link or phone the business did not give removed, and claims it did not make softened. */
export function cleanLine(value: unknown, max: number, known: string): string {
  const raw = text(value, max * 2); if (!raw) return '';
  const grounded = removeUngrounded(stripUnsupportedClaims(raw), known).text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '').replace(/\b(?:[a-z0-9-]+\.)+(?:com|ca|net|org|io|co|app|biz|info)\b(?:\/\S*)?/gi, '') // emails and bare web addresses
    .replace(/[$€£]\s*\d*[\d.,]*/g, '').replace(/\d+/g, (digits) => (new RegExp(`(^|\\D)${digits}(\\D|$)`).test(known) ? digits : '')) // a number the owner or the business actually gave ("24-hour") stays; any other goes
    .replace(/(^|\s)\d+\s*\/(?=\s|$)/g, '$1').replace(/(^|\s)\/\s*\d+(?=\s|$)/g, '$1') // "24/" and "/7": what is left of a fraction-like claim once one half is gone
    .replace(/\s{2,}/g, ' ').trim()
    .replace(/^[\s/|•·\-–—]+|[\s/|•·\-–—]+$/g, ''); // what is left of "24/7" or "24-hour" once the number is gone is not a word: no dangling slash or dash
  return trimTo(grounded, max);
}

/** Cuts at a word boundary and never ends on a dangling word ("...with a"). */
export function trimTo(value: string, max: number): string {
  if (value.length <= max) return value;
  const words = value.slice(0, max + 1).replace(/\s+\S*$/, '').split(' ');
  while (words.length > 1 && /^(?:a|an|the|and|or|of|to|with|for|in|on|at|by|from|that|your|our|its|is|are|as|so)$/i.test(words[words.length - 1])) words.pop();
  return words.join(' ').replace(/[,;:\-–—]+$/, '');
}

/** Checks and cleans a model's storyboard. Returns null when too little of it is usable (the caller then uses an ordinary video). */
export function sanitizeStoryboard(raw: unknown, input: StoryboardInput): ExplainerStoryboard | null {
  const body = (raw && typeof raw === 'object' ? raw : {}) as { title?: unknown; scenes?: unknown };
  if (!Array.isArray(body.scenes)) return null;
  const known = [input.request, input.business.name, input.business.type, input.business.location, input.business.services.join(' '), input.business.description].join(' ');
  const names = new Set(input.photos.map((photo) => photo.name));
  const photo = (value: unknown) => (typeof value === 'string' && names.has(value) ? value : null);
  const label = (value: unknown, max = 30) => cleanLine(value, max, known);
  const labels = (value: unknown, max: number) => (Array.isArray(value) ? value : []).map((item) => label(item)).filter((item) => item.length >= 3).filter((item, i, all) => all.indexOf(item) === i).slice(0, max);
  const scenes: ExplainerScene[] = [];
  for (const entry of body.scenes.slice(0, 8)) {
    const s = (entry && typeof entry === 'object' ? entry : {}) as Record<string, any>;
    const narration = cleanLine(s.narration, 240, known);
    if (!narration && input.blueprint?.voice !== false) continue;
    switch (s.type) {
      case 'intro': { const headline = label(s.headline, 60); if (headline) scenes.push({ type: 'intro', headline, subtext: label(s.subtext, 70), labels: labels(s.labels, 6), narration }); break; }
      case 'orbit': { const headline = label(s.headline, 60); const items = labels(s.labels, 10); if (headline && items.length >= 4) scenes.push({ type: 'orbit', headline, subtext: label(s.subtext, 70), labels: items.map((item) => item.split(' ').slice(0, 3).join(' ')), narration }); break; }
      case 'chaos': { const headline = label(s.headline, 60); const items = labels(s.labels, 14); if (headline && items.length >= 5) scenes.push({ type: 'chaos', headline, subtext: label(s.subtext, 70), labels: items, narration }); break; }
      case 'form': {
        const fields = (Array.isArray(s.fields) ? s.fields : []).map((f: unknown) => (Array.isArray(f) ? [label(f[0], 18), text(f[1], 40)] : ['', ''])).filter(([a]) => a).map(([a, b]) => {
          // a value is only the business's own words or a day and time of day; anything else is left empty rather than invented
          const ok = b && (GENERIC_VALUE.test(b) || known.toLowerCase().includes(b.toLowerCase())) && !/\d/.test(b); return [a, ok ? b : ''] as [string, string]; }).slice(0, 3);
        if (fields.length) scenes.push({ type: 'form', title: label(s.title, 34) || 'Booking form', fields, button: label(s.button, 18) || 'Book it', success: label(s.success, 18) || 'Booked', narration }); break;
      }
      case 'schedule': {
        const entries = (Array.isArray(s.entries) ? s.entries : []).map((e: unknown) => (Array.isArray(e) ? ([text(e[0], 3), Math.round(Number(e[1])), label(e[2], 14)] as [string, number, string]) : null)).filter((e): e is [string, number, string] => !!e && DAYS.includes(e[0]) && Number.isFinite(e[1]) && !!e[2]).map(([d, slot, l]) => [d, Math.max(0, Math.min(4, slot)), l] as [string, number, string]).slice(0, 7);
        if (entries.length >= 2) scenes.push({ type: 'schedule', title: label(s.title, 30) || 'This week', entries, narration }); break;
      }
      case 'chat': {
        const messages = (Array.isArray(s.messages) ? s.messages : []).map((m: unknown) => (Array.isArray(m) && (m[0] === 'customer' || m[0] === 'business') ? [m[0], cleanLine(m[1], 90, known)] : null)).filter((m): m is ['customer' | 'business', string] => !!m && m[1].length >= 3).slice(0, 4);
        if (messages.length >= 2) scenes.push({ type: 'chat', title: label(s.title, 30) || input.business.name, messages, narration }); break;
      }
      case 'steps': { const headline = label(s.headline, 50); const items = labels(s.items, 4); if (headline && items.length >= 2) scenes.push({ type: 'steps', headline, items, photo: photo(s.photo), narration }); break; }
      case 'photo': { const p = photo(s.photo); const headline = label(s.headline, 50); if (p && headline) scenes.push({ type: 'photo', headline, subtext: label(s.subtext, 70), photo: p, narration }); break; }
      case 'swap': {
        const lead = label(s.lead, 24); const words = labels(s.words, 5).map((word) => word.split(' ').slice(0, 2).join(' ')).filter((word, i, all) => word && all.indexOf(word) === i);
        const card = s.card === 'list' || s.card === 'line' ? s.card : 'bars';
        if (lead && words.length >= 2) scenes.push({ type: 'swap', lead, words, tail: label(s.tail, 24), card, items: labels(s.items, 4), brandLine: label(s.brandLine, 44), cta: label(s.cta, 18), narration }); break;
      }
      case 'cta': { const headline = label(s.headline, 44); if (headline) scenes.push({ type: 'cta', headline, photo: photo(s.photo), narration }); break; }
      default: break;
    }
  }
  if (scenes.length < (input.blueprint ? Math.min(3, input.blueprint.slots.length) : 4)) return null;
  // it ends on one call to action, and has only one
  const withoutCta = scenes.filter((scene) => scene.type !== 'cta');
  const cta = scenes.filter((scene) => scene.type === 'cta').at(-1) ?? ({ type: 'cta', headline: 'Book today', photo: null, narration: `Ready when you are. Book with ${input.business.name}.` } as ExplainerScene);
  return { title: text(body.title, 80) || input.request.slice(0, 60), character: input.character, scenes: [...withoutCta.slice(0, 6), cta], ...(input.blueprint ? { theme: input.blueprint.theme, glow: input.blueprint.look.glow } : {}) };
}

/** One call to the model, with one retry if the reply is not usable. */
/** How many scenes of a storyboard are not the kind the reference has in the same place. */
export const blueprintMisses = (storyboard: ExplainerStoryboard, blueprint: Blueprint) => Math.max(storyboard.scenes.length, blueprint.slots.length) - storyboard.scenes.filter((scene, i) => blueprint.slots[i]?.type === scene.type).length;

const blueprintPrompt = (blueprint: Blueprint) => `\n\nSTRUCTURE TO FOLLOW. The owner gave a reference video and wants a new one in the same style, so use EXACTLY these scenes, in this order, each of this kind (the look is ${blueprint.theme}${blueprint.look.glow > 1.3 ? ' with strong glow' : ''}${blueprint.look.depth ? ' and layered depth' : ''}, the pace ${blueprint.pacing}, the text style ${blueprint.textTreatment.replace(/_/g, ' ')}). Write the words for this business; do not copy or imitate any words from the reference (you have not seen them). Only the kind, count and length are given: never write a description of the design (nothing about logos, orbits, layout or motion) as on-screen words:\n${blueprint.slots.map((slot, i) => `${i + 1}. "${slot.type}" (${slotName(slot.type)}, about ${slot.seconds} seconds${slot.type === 'swap' ? `, ${Math.max(2, Math.min(5, slot.parts))} swapping words, card "${slot.card}"` : slot.type === 'orbit' ? `, exactly ${slot.geo.count} labels${slot.geo.shape === 'icon' ? ' (each names something a small symbol can show: a service, a tool, a season)' : ''}` : slot.type === 'chaos' ? `, about ${Math.max(8, Math.min(14, slot.geo.count + 2))} labels` : ''})`).join('\n')}${blueprint.voice ? '' : '\nThere is no voiceover: still write a short "narration" for each scene (it is not spoken).'}`;

export async function writeExplainerStoryboard(input: StoryboardInput, complete: CompleteText): Promise<ExplainerStoryboard | null> {
  const b = input.business;
  const prompt = `BUSINESS\nName: ${b.name}\nType: ${b.type}\nPlace: ${b.location || 'not given'}\nServices: ${b.services.slice(0, 8).join(', ') || 'not listed'}\nAbout: ${b.description.slice(0, 400) || 'not given'}\nVoice: ${b.tone || 'friendly and plain'}\n\nPHOTOS YOU MAY USE (by name)\n${input.photos.length ? input.photos.map((photo) => `${photo.name}: ${photo.label}`).join('\n') : 'none'}\n\nTHE REQUEST\n"${input.request.slice(0, 400)}"\nLength: about ${input.targetSeconds} seconds in total. Character: ${input.character === 'pilot' ? 'Pilot, the friendly assistant' : "the business's own logo"}.`;
  const full = input.blueprint ? prompt + blueprintPrompt(input.blueprint) : prompt;
  let closest: ExplainerStoryboard | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reply = await complete(SYSTEM, full);
      const parsed = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? '');
      const storyboard = sanitizeStoryboard(parsed, input);
      if (storyboard && input.blueprint && blueprintMisses(storyboard, input.blueprint) > 1) { closest = closest && blueprintMisses(closest, input.blueprint) <= blueprintMisses(storyboard, input.blueprint) ? closest : storyboard; continue; } // off the reference's structure: ask once more
      if (storyboard) return storyboard;
    } catch { /* try once more */ }
  }
  return closest;
}
