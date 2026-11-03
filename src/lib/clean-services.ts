/**
 * A list of services or products as it comes out of a website scrape or a loose text field can hold whole FAQ sentences
 * ("you service Windsor and surrounding areas? Question How far in advance should I book?") instead of names. Pilot writes
 * captions and plans videos from this list, so only things that look like names of services or products are kept:
 *  - short (up to 6 words, 50 characters),
 *  - not a question or a sentence (no question marks, question words, or "you / we / I" talk),
 *  - not a link, an email, a phone number or page furniture ("click here", "read more", "contact us").
 * Anything else is dropped, so the list can come out empty. That is correct: an empty list means "services unknown", which Pilot
 * handles, whereas a made-up or garbled service would end up in a caption.
 */
const QUESTION_WORDS = /\b(?:how|what|when|where|why|who|which|should|could|would|can|do|does|did|is|are|will|am)\b/i;
const TALK = /\b(?:you|your|yours|we|our|ours|i|my|me|us|they|their)\b/i;
const FURNITURE = /\b(?:click here|read more|learn more|contact us|call us|book now|get a quote|sign up|log ?in|privacy|terms|cookies?|faq|frequently asked|question|questions|answer|answers|copyright|all rights reserved|menu|home|about us|http|www\.|@)\b|https?:|\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/i;

export function isServiceName(candidate: string): boolean {
  const text = candidate.trim();
  if (text.length < 3 || text.length > 50) return false;
  if (text.split(/\s+/).length > 6) return false;
  if (/[?!]|[.:;]\s*\S/.test(text)) return false; // a question, or more than one sentence
  if (QUESTION_WORDS.test(text) && text.split(/\s+/).length > 3) return false;
  if (TALK.test(text) || FURNITURE.test(text)) return false;
  return /\p{L}/u.test(text);
}

/** Splits loose text into pieces that could be names: on commas, semicolons, new lines, bullets, the word "Question", and question marks. */
export function splitServiceText(text: string): string[] {
  return text.split(/[,\n;•·|]+|\bQuestion\b|\?/i).map((piece) => piece.replace(/^[\s\-–—*\d.)]+|[\s.]+$/g, '').trim()).filter(Boolean);
}

/** The service names in a list of raw entries (each may itself be a lump of text), deduplicated, in order. */
export function cleanServiceList(raw: string[], max = 20): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const entry of raw) {
    const pieces = /[,\n;•·|?]|\bQuestion\b/i.test(entry) ? splitServiceText(entry) : [entry.trim()]; // a lump is split; a single name is kept as it is
    for (const piece of pieces) {
      if (!isServiceName(piece)) continue;
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); out.push(piece);
      if (out.length >= max) return out;
    }
  }
  return out;
}
