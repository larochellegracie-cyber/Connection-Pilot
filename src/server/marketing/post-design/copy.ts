import { cleanLine } from '../explainer/storyboard.js';
import type { PostCopy, Pattern } from './layouts.js';
import { iconFor } from './layouts-extra.js';

/**
 * The words of a designed post. The headline and button come from the post's own words; the small label is the business's name; and the call-outs (the small
 * notes with arrows, such as "Chocolate buttercream") are only ever taken from what the owner's own photo's label, description and tags say about the product, so nothing
 * is invented. Short on purpose: a clean post has a few words, in a clear order.
 */
const words = (value: string, max: number) => value.split(/\s+/).filter(Boolean).slice(0, max).join(' ');
const sentence = (value: string) => value.replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim();

/** The hook split where a person would: the first sentence (or clause) is the headline, what follows is the supporting line. */
export function splitHook(hook: string): { headline: string; rest: string } {
  const clean = sentence(hook).replace(/\s+[-–—]\s+/g, '. ').replace(/[‑‐]/g, '-');
  const parts = clean.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  let head = parts[0] ?? clean; let rest = parts.slice(1).join(' ');
  if (head.split(' ').length > 8) { const cut = head.split(/,\s+|:\s+|;\s+/)[0]; if (cut && cut.split(' ').length >= 2 && cut.split(' ').length <= 8) { rest = `${head.slice(cut.length).replace(/^[,:;]\s*/, '')} ${rest}`.trim(); head = cut; } else { head = words(head, 8); } }
  const up = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return { headline: up(head.replace(/[.!,;:]+$/, '')), rest: up(words(rest, 14).replace(/[,;:]+$/, '')) };
}
export function headlineOf(hook: string, businessName: string): string { return splitHook(hook).headline || businessName; }
/** The button words: the action, cut before where, how or the phone number (never mid-phrase). */
export function buttonOf(cta: string): string { const first = (sentence(cta).split(/[.!?](?:\s|$)/)[0] ?? '').split(/\s+(?:at|on|or|by|online|via|through|using|call|with|in)\s+/i)[0] ?? ''; const all = first.replace(/[:,;]+$/, '').split(/\s+/).filter(Boolean); const short = all.length <= 6 ? all.join(' ') : ''; return short.length > 34 || /\d{3}/.test(short) ? '' : short; }

const FILLER = /\b(?:photo|picture|image|made by pilot|ai image|from website)\b/gi;
/** Short notes about the product, only from the words the business's own photo carries. */
export function calloutsFrom(info: { label: string; description: string; tags: string[] }): string[] {
  const source = [info.description, ...info.tags].map((s) => s.replace(FILLER, '').replace(/[()]/g, '')).filter(Boolean);
  const parts = source.flatMap((s) => s.split(/\s*(?:,|;| with | and | on | in | topped with | filled with )\s*/i)).map((p) => sentence(p).replace(/^(?:a|an|the)\s+/i, ''));
  const out: string[] = []; for (const p of parts) { const short = words(p, 3); if (short.length >= 4 && short.length <= 26 && !out.some((o) => o.toLowerCase() === short.toLowerCase()) && short.toLowerCase() !== info.label.toLowerCase()) out.push(short.charAt(0).toUpperCase() + short.slice(1)); if (out.length === 4) break; }
  return out.length >= 2 ? out : [];
}

export function buildCopy({ pattern, hook, cta, businessName, topic, season, product, items, subline, extra }: { /** what the owner gave: an offer, words to quote, an event, the business's points */ extra?: Pick<PostCopy, 'offer' | 'quote' | 'event' | 'points' | 'graphic'>; pattern: Pattern; hook: string; cta: string; businessName: string; topic: string; season: { label: string; colour: string } | null; product: { label: string; description: string; tags: string[] } | null; items: Array<{ label: string; photo: Buffer | null }>; subline?: string }): PostCopy {
  const known = [hook, cta, businessName, topic, product?.label, product?.description, ...(product?.tags ?? [])].join(' ');
  return {
    eyebrow: words(businessName.replace(/\s*&.*$/, ''), 3),
    headline: cleanLine(dedupe(headlineOf(hook, businessName), extra?.offer?.big), 60, known).replace(/\s*%\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[:\s-]+|[:\s-]+$/g, '') || businessName, subline: subline ?? (pattern === 'product_focus' || pattern === 'seasonal' ? '' : offerSafe(cleanLine(splitHook(hook).rest, 90, known), extra?.offer)), cta: buttonOf(cta), callouts: pattern === 'product_focus' && product ? calloutsFrom(product) : [], items, ...(season && (pattern === 'seasonal' || pattern === 'banner') ? { season } : {}), ...(extra ?? {}),
  };
}

/** Two to four short points from what the business says about itself (its selling points first, then its services): never made up. */
export function pointsFrom(facts: { sellingPoints?: string[]; services?: string[] }): Array<{ label: string; detail: string; icon: string }> {
  const raw = [...(facts.sellingPoints ?? []), ...(facts.services ?? [])].map((p) => sentence(p).replace(/[.;]+$/, '')).filter((p) => p.length >= 4 && p.length <= 90 && !/\d{3}|@|http/i.test(p));
  const out: Array<{ label: string; detail: string; icon: string }> = [];
  for (const p of raw) {
    const full = p.replace(/^(?:we|our|the)\s+/i, ''); const cut = /^(.{6,34}?)\s+(?:to|for|with|that|which|in|by|so|and|from|across|throughout)\s+(.+)$/i.exec(full); const dash = full.split(/\s+[-–—:]\s+|:\s+|,\s+/);
    let label = dash.length > 1 ? dash[0] : cut ? cut[1] : full; let detail = dash.length > 1 ? dash.slice(1).join(', ') : cut ? cut[2] : '';
    if (label.split(' ').length > 5) { detail = `${label.split(' ').slice(5).join(' ')} ${detail}`.trim(); label = words(label, 4); }
    label = label.replace(/[.,;:]+$/, ''); if (!label || out.some((o) => o.label.toLowerCase() === label.toLowerCase())) continue;
    out.push({ label: label.charAt(0).toUpperCase() + label.slice(1), detail: words(detail.replace(/[.,;:]+$/, ''), 7), icon: iconFor(p) }); if (out.length === 4) break;
  }
  return out.length >= 2 ? out : [];
}

/** A headline that already says the offer ("Free quote for pool openings" over a "Free quote" panel) keeps only what the panel does not say. */
function dedupe(headline: string, big?: string): string { if (!big) return headline; const rest = headline.replace(new RegExp(big.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/^\s*(?:for|on|at|with|of|this|our|your)\s+/i, '').replace(/\s+/g, ' ').trim(); return rest.split(' ').length >= 2 ? rest.charAt(0).toUpperCase() + rest.slice(1) : headline; }
/** The supporting line of an offer post must not repeat the offer, or carry a number the owner did not give. */
function offerSafe(line: string, offer?: { big: string; small: string }): string { if (!offer) return line; const bad = /\d|%|\boff\b|\bfree\b|\$/i.test(line) || line.toLowerCase().includes(offer.small.toLowerCase()) && offer.small.length > 3; return bad ? '' : line; }
