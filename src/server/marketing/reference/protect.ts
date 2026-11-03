/**
 * Reference-text protection. A reference video has its own brand and wording (its business name, its headlines, its product names). Pilot keeps what it saw
 * as a structured list, and NOTHING on that list may appear in a video made from the reference unless the owner's own request or business information uses
 * the same word. This does not rely on a prompt: every piece of text that will be on screen or in the post (the concept, the caption, the hashtags, the words
 * in the drawing script) is checked against the list, and a violation is revised or the text is regenerated before the video is accepted.
 */
export type ReferenceText = {
  /** brand and business names seen */ brands: string[]; /** words that belong to a brand name */ words: string[];
  /** identifying lines: slogans, taglines, and anything that names the brand, a place, a number or a contact. Strictly kept out: the whole line, and any two of its words in a row. */ slogans?: string[];
  /** ordinary descriptive or marketing lines ("Layers assemble"). Free to use in new wording; only lifting a whole line of four or more words word for word is refused. */ phrases: string[];
};
export type TextSource = { where: string; text: string };
export type Violation = { where: string; found: string; kind: 'brand' | 'word' | 'phrase'; text: string };

const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'our', 'you', 'are', 'from', 'that', 'this', 'new', 'more', 'all', 'get', 'now', 'one', 'out', 'can', 'how', 'its', 'has', 'was', 'but', 'not', 'any', 'free', 'best', 'good', 'great', 'made', 'make', 'day', 'time', 'life', 'love']);
const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const unique = (list: string[]) => list.filter((item, i) => item && list.findIndex((other) => norm(other) === norm(item)) === i);

/**
 * Whether a line of the reference is identifying (a slogan or a line that names the brand) rather than ordinary descriptive wording. The vision step says which when it
 * can; otherwise a line is identifying when it holds a brand word, a number, a web or contact detail, or is long enough to be a tagline (eight words or more).
 */
export function isIdentifying(line: string, brands: string[]): boolean {
  const n = norm(line); const tokens = new Set(brands.flatMap((b) => norm(b).split(' ')).filter((t) => t.length >= 3 && !STOP.has(t)));
  return /\d/.test(line) || /@|https?:|www\.|\.(com|ca|net|org)\b/i.test(line) || n.split(' ').some((w) => tokens.has(w)) || n.split(' ').length >= 8;
}

/** Cleans what the vision step reported it saw. A line is either text or {text, kind: "slogan" | "descriptive"}. */
export function cleanReferenceText(raw: unknown): ReferenceText {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (value: unknown, count: number, max: number) => unique((Array.isArray(value) ? value : []).map((item) => clean(item, max)).filter((item) => item.length >= 3)).slice(0, count);
  const brands = list(v.brand_names ?? v.brands, 8, 60); const slogans: string[] = []; const phrases: string[] = [];
  for (const item of (Array.isArray(v.phrases) ? v.phrases : []).slice(0, 24)) {
    const text = clean(typeof item === 'object' && item ? (item as { text?: unknown }).text : item, 120); if (text.length < 3) continue;
    const kind = typeof item === 'object' && item ? String((item as { kind?: unknown }).kind ?? '') : '';
    (kind === 'slogan' || (kind !== 'descriptive' && isIdentifying(text, brands)) ? slogans : phrases).push(text);
  }
  return { brands, words: list(v.words, 24, 40).filter((w) => !STOP.has(norm(w))), slogans: unique(slogans).slice(0, 12), phrases: unique(phrases).slice(0, 16) };
}

/** What stays forbidden for this owner: anything the owner's own words use (their request, their business name, products and services) is allowed. */
export function forbiddenFor(text: ReferenceText | undefined, ownerWords: string): ReferenceText {
  const own = norm(ownerWords); const ownSet = new Set(own.split(' '));
  const used = (word: string) => norm(word).split(' ').every((part) => ownSet.has(part));
  // hard bans: brand names (and each word of them), and the reference's lines. Ordinary single words from its captions ("warm", "light") are not banned: a line is
  // forbidden as a whole and by any two words in a row from it, which is what copying wording looks like.
  const brands = (text?.brands ?? []).filter((w) => !used(w));
  const tokens = brands.flatMap((b) => norm(b).split(' ')).filter((t) => t.length >= 3 && !ownSet.has(t) && !STOP.has(t));
  const words = [...tokens, ...(text?.words ?? []).filter((w) => !used(w) && norm(w).length >= 4 && brands.some((b) => norm(b).split(' ').includes(norm(w))))];
  // lines from an older analysis (not yet sorted into slogans and descriptive lines) are sorted here
  const lines = [...(text?.slogans ?? []).map((t) => ({ t, slogan: true })), ...(text?.phrases ?? []).map((t) => ({ t, slogan: text?.slogans === undefined && isIdentifying(t, brands) }))].filter((l) => !own.includes(norm(l.t)));
  return { brands, words: words.filter((w, i) => words.findIndex((o) => norm(o) === norm(w)) === i), slogans: lines.filter((l) => l.slogan).map((l) => l.t), phrases: lines.filter((l) => !l.slogan).map((l) => l.t) };
}

/** Everything in `sources` that contains the reference's brand, words or lines. Whole words only, case and punctuation ignored. */
export function findReferenceText(sources: TextSource[], forbidden: ReferenceText): Violation[] {
  const out: Violation[] = [];
  for (const source of sources) {
    const text = norm(source.text); if (!text) continue;
    for (const brand of forbidden.brands) if (new RegExp(`(^|\\s)${escape(norm(brand))}(\\s|$)`).test(text)) out.push({ where: source.where, found: brand, kind: 'brand', text: source.text.slice(0, 120) });
    for (const word of forbidden.words) if (norm(word).length >= 4 && new RegExp(`(^|\\s)${escape(norm(word))}(\\s|$)`).test(text)) out.push({ where: source.where, found: word, kind: 'word', text: source.text.slice(0, 120) });
    // an ordinary descriptive line is only refused when a whole line of four or more words is lifted word for word
    for (const phrase of forbidden.phrases) { const p = norm(phrase); if (p.split(' ').length >= 4 && text.includes(p)) out.push({ where: source.where, found: phrase, kind: 'phrase', text: source.text.slice(0, 120) }); }
    // an identifying line (a slogan, or one that names the brand) is refused whole, and by any two of its words in a row
    for (const phrase of forbidden.slogans ?? []) {
      const p = norm(phrase); const parts = p.split(' '); if (parts.length < 2) continue;
      const whole = text.includes(p) || (text.length >= 8 && p.includes(text) && text.split(' ').length >= 2);
      // any two words in a row from the line (not filler pairs such as "the first")
      const pair = !whole && parts.slice(0, -1).some((w, i) => w.length >= 3 && parts[i + 1].length >= 3 && !STOP.has(w) && !STOP.has(parts[i + 1]) && text.includes(`${w} ${parts[i + 1]}`));
      if (whole || pair) out.push({ where: source.where, found: phrase, kind: 'phrase', text: source.text.slice(0, 120) });
    }
  }
  return out;
}

/** The text of a Python drawing script that could end up on screen: its string literals (short option names such as "center" or "prop:cake" are not text). */
export function scriptStrings(script: string): string[] { return [...script.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1')).filter((s) => /\s|[A-Z]/.test(s) && s.length >= 3 && !/^prop:/.test(s)); }

/** Removes the offending words and lines from a text (the last resort when regenerating did not clear it). */
export function redact(text: string, forbidden: ReferenceText): string {
  let out = text;
  for (const phrase of [...(forbidden.slogans ?? []), ...forbidden.phrases]) out = out.replace(new RegExp(escape(phrase), 'gi'), '');
  for (const word of [...forbidden.brands, ...forbidden.words]) out = out.replace(new RegExp(`\\b${escape(word)}\\b`, 'gi'), '');
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?:;])/g, '$1').replace(/\s*[:;,\-–—]+\s*$/, '').replace(/^\s*[:;,\-–—]+\s*/, '').trim();
}
