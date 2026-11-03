import { findReferenceText, redact, type ReferenceText, type Violation } from '../reference/protect.js';
import type { PostCopy } from './layouts.js';

/** Keeps the reference's own brand names, slogans and lifted lines out of a post's words: anything found is removed; a headline left empty falls back to the business's name. */
export function protectPostCopy(copy: PostCopy, forbidden: ReferenceText | undefined, businessName: string): { copy: PostCopy; removed: Violation[] } {
  if (!forbidden) return { copy, removed: [] };
  const removed: Violation[] = []; const fix = (where: string, text: string) => { if (!text) return text; const hits = findReferenceText([{ where, text }], forbidden); if (!hits.length) return text; removed.push(...hits); return redact(text, forbidden).replace(/\s{2,}/g, ' ').trim(); };
  const out: PostCopy = { ...copy, headline: fix('headline', copy.headline), subline: fix('subline', copy.subline), cta: fix('cta', copy.cta), eyebrow: fix('eyebrow', copy.eyebrow), callouts: copy.callouts.map((c) => fix('callout', c)).filter(Boolean) };
  if (!out.headline) out.headline = businessName; return { copy: out, removed };
}
