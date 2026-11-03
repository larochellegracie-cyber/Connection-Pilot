import type { Pattern } from './layouts.js';
import type { PostAspect } from './tokens.js';

/** Which layout pattern a post gets, from what it is about and what photos exist. Plain rules, so the same request gives the same kind of design. */
const SEASONS: Array<{ re: RegExp; label: string; colour: string }> = [
  { re: /\b(?:christmas|xmas|holiday|festive|new year)s?\b/i, label: 'Holiday', colour: '#B3262E' }, { re: /\b(?:halloween|spooky)\b/i, label: 'Halloween', colour: '#D9661F' },
  { re: /\b(?:valentine|valentines|galentine)s?\b/i, label: 'Valentine’s', colour: '#C2185B' }, { re: /\b(?:easter|spring)\b/i, label: 'Spring', colour: '#D96A93' },
  { re: /\b(?:mother'?s day|father'?s day)\b/i, label: 'Special day', colour: '#B5476B' }, { re: /\b(?:summer|beach|patio)\b/i, label: 'Summer', colour: '#E08A00' },
  { re: /\b(?:fall|autumn|thanksgiving|pumpkin)\b/i, label: 'Fall', colour: '#B8561B' }, { re: /\b(?:winter|snow|closing season)\b/i, label: 'Winter', colour: '#2F6DB5' },
];
export const seasonOf = (text: string) => SEASONS.find((s) => s.re.test(text)) ?? null;
const ANNOUNCE = /\b(?:now open|grand opening|opening day|announc\w*|new (?:hours|location|service|menu)|we(?:'|’)re (?:open|closed|hiring)|hiring|sale|special|offer|discount|free|join us|workshop|event|booking|book now|limited|closed|welcome)\b/i;
const MENU = /\b(?:menu|flavou?rs|collection|line-?up|our products|range|favou?rites|bestsellers?|all our)\b/i;

const BENEFITS = /\b(?:why choose|why us|benefits?|features?|what you get|reasons?|what(?:'|’)s included|includes?|our promise|what we (?:do|offer)|our services)\b/i;
const GALLERY = /\b(?:gallery|collage|behind the scenes|our work|recent (?:work|jobs|projects)|a look at|photos|meet the team|our kitchen|fresh from)\b/i;
const QUOTEWORDS = /\b(?:quote|testimonial|review|what (?:our )?customers? (?:say|said)|customer (?:says|said)|said|says)\b/i;
const SPOTLIGHT = /\b(?:spotlight|introducing|meet our|new (?:flavou?r|product|arrival|item)|favou?rite of the week|star of|featured?|new this week)\b/i;
const EVENT = /\b(?:event|grand opening|open house|workshop|class|launch|festival|fair|party|pop-?up|market|tasting|meet(?:-| )?and(?:-| )?greet)\b/i;

/** A price or offer the owner wrote, exactly as they wrote it (never made up): "20% off", "$25", "Buy one, get one", "Free quote". */
export function extractOffer(text: string): { big: string; small: string } | null {
  const t = text.replace(/\s+/g, ' ');
  const pct = /\b(\d{1,2})\s?%\s*off\b/i.exec(t); if (pct) return { big: `${pct[1]}% off`, small: smallAfter(t, pct.index + pct[0].length) };
  const free = /\bfree\s+(quote|estimate|delivery|shipping|consultation|inspection|gift|cupcake|upgrade)s?\b/i.exec(t); if (free) return { big: `Free ${free[1].toLowerCase()}`, small: smallAfter(t, free.index + free[0].length) };
  const bogo = /\b(?:buy one,? get one(?: free| half off)?|bogo|2 for 1|two for one)\b/i.exec(t); if (bogo) return { big: bogo[0].replace(/^./, (c) => c.toUpperCase()).replace(/bogo/i, 'Buy one, get one'), small: smallAfter(t, bogo.index + bogo[0].length) };
  const price = /(?:\bfrom\s+|\bonly\s+|\bjust\s+|\bfor\s+)?\$\s?(\d{1,4}(?:\.\d{2})?)(?:\s?(?:\/|per\s|each|a\s)\s?[a-z]+)?/i.exec(t); if (price) return { big: `$${price[1]}`, small: /each|per|\/|\ba\b/i.test(price[0]) ? price[0].replace(/^.*?\d(?:\.\d{2})?\s?/, '').replace('/', 'per ').trim() : smallAfter(t, price.index + price[0].length) };
  return null;
}
function smallAfter(text: string, from: number): string { const rest = text.slice(from).replace(/^[\s,.:;—–-]+/, '').split(/[.!?:]|\bmake\b|\bpost\b/i)[0] ?? ''; const w = rest.split(' ').filter(Boolean).slice(0, 6).join(' '); return /\d{3}|@|http|%/i.test(w) ? '' : w; }

/** Words the owner gave to quote ("…" with who said it), or null. Nothing is ever written for them: a testimonial is only ever the owner's own. */
export function extractQuote(text: string): { text: string; by: string } | null {
  const m = /[“"]([^”"]{20,260})[”"]\s*(?:[-–—]\s*|by\s+|from\s+|said\s+|says\s+)?([A-Z][A-Za-z.'’ ]{1,28})?/.exec(text); if (!m) return null; const by = (m[2] ?? '').trim().split(/\s+/).slice(0, 3).join(' ');
  return QUOTEWORDS.test(text) || m[1].split(' ').length >= 6 ? { text: m[1].trim(), by } : null;
}
/** What and when, from the owner's own words: the day or date and the time, exactly as written, and nothing after it. */
export function extractEvent(text: string): { label: string; line: string } | null {
  const e = EVENT.exec(text); if (!e) return null; const label = e[0].split(/[\s-]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const day = '(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?)'; const time = '\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)(?:\\s?(?:to|-|–|until)\\s?\\d{1,2}(?::\\d{2})?\\s?(?:am|pm))?';
  const m = new RegExp(`\\b(${day})(?:,?\\s+(?:at\\s+|from\\s+)?(${time}))?|\\b(${time})`, 'i').exec(text); let line = m ? m[0].trim() : ''; line = line.charAt(0).toUpperCase() + line.slice(1);
  return { label, line };
}

/** The owner asked for a graphic, a poster, a typographic post, shapes or icons: no photo is wanted. */
export const GRAPHIC_ASK = /\b(?:graphic|illustrat\w*|poster|typograph\w*|no photo|without (?:a )?photo|just (?:text|words|type)|shapes?|icons?|vector|abstract|infographic|text[- ]only|type[- ]only)\b/i;
export type Choice = { pattern: Pattern; season: { label: string; colour: string } | null; why: string };
export function choosePattern({ text, seasonText, photos, products, offer = false, quote = false, points = 0, gallery = 0, graphic = false, motif = false }: { /** the owner asked for a graphic or poster */ graphic?: boolean; /** the subject has a motif to draw */ motif?: boolean; text: string; /** what the owner asked for (a season in the post's own wording is not enough to dress a post for it) */ seasonText?: string; photos: number; /** distinct product photos that could fill a grid */ products: number; offer?: boolean; quote?: boolean; points?: number; /** the owner's own photos that could fill a collage */ gallery?: number }): Choice {
  const ask = seasonText ?? text; const season = seasonOf(ask);
  if (graphic && !quote && !offer) return { pattern: 'poster', season: null, why: 'the owner asked for a graphic post, so the picture is drawn from shapes and icons' };
  if (quote) return { pattern: 'quote', season: null, why: 'the owner gave words to quote' };
  if (offer) return { pattern: 'offer', season: null, why: 'the owner gave a price or an offer, so it is the biggest thing in the post' };
  if (BENEFITS.test(ask) && points >= 2) return { pattern: 'benefits', season: null, why: 'it is about what the business offers, and there are short points to list' };
  if (GALLERY.test(ask) && gallery >= 2) return { pattern: 'collage', season: null, why: `it is about the business's own work, and there are ${Math.min(3, gallery)} photos to show together` };
  if (EVENT.test(ask)) return { pattern: 'banner', season, why: 'it is an event, so it gets a bold banner' };
  if (MENU.test(text) && products >= 2) return { pattern: 'grid', season: null, why: 'it is about several products and there are photos of more than one' };
  if (season && photos > 0) return { pattern: 'seasonal', season, why: `it is about a season (${season.label.toLowerCase()}) and has a photo` };
  if (SPOTLIGHT.test(ask) && photos > 0) return { pattern: 'spotlight', season: null, why: 'it spotlights one thing, so the photo is as big as the post allows' };
  if (photos === 0 && motif && !ANNOUNCE.test(text)) return { pattern: 'poster', season: null, why: 'there is no photo, so the picture is drawn from shapes and icons about the subject' };
  if (ANNOUNCE.test(text) || photos === 0) return { pattern: 'announcement', season: null, why: photos === 0 ? 'there is no photo, so the words carry a clean announcement card' : 'it is an announcement or offer' };
  return { pattern: 'product_focus', season: null, why: 'it is about one thing and there is a photo of it' };
}

/** The shape of the post from the owner's words: a story is tall, a square post square; otherwise the feed's 4:5. */
export const aspectFrom = (text: string): PostAspect => (/\b(?:story|stories|reel cover|9:16|tall)\b/i.test(text) ? '9:16' : /\b(?:square|1:1)\b/i.test(text) ? '1:1' : '4:5');
/** A font the owner asked for, in a word or two ("use a script font", "make it elegant", "Oswald"), or ''. */
export function fontFrom(text: string): string {
  const t = text.toLowerCase(); if (/\b(?:lobster|script|handwritten|cursive|playful font|fun font)\b/.test(t)) return 'Lobster'; if (/\b(?:playfair|serif|elegant font|elegant|luxur\w+)\b/.test(t)) return 'Playfair Display'; if (/\bdm serif|editorial\b/.test(t)) return 'DM Serif Display';
  if (/\b(?:oswald|condensed|bold font|strong font|athletic)\b/.test(t)) return 'Oswald'; if (/\b(?:inter|clean font|sans|modern font|minimal)\b/.test(t)) return 'Inter'; return '';
}
