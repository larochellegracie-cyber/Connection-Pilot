import type { Pattern, PostCopy } from './layouts.js';

/**
 * The social-media standards every post's words meet, so nothing is cluttered or hard to take in at a glance: a short headline, a short supporting line, a button of a few words,
 * notes only when they are real and balanced, and the business's name shown once (not as a label AND as a logo). Applied after the words are written and before the post is drawn.
 */
const words = (value: string) => value.split(/\s+/).filter(Boolean);
const TAIL = /\b(?:and|or|but|with|for|to|of|in|on|at|the|a|an|your|our|that|which|is|are)$/i;
const cut = (text: string, max: number): string => {
  const w = words(text); if (w.length <= max) return text.trim();
  // prefer the first clause or sentence when it is a complete thought of reasonable length
  const clause = text.split(/(?<=[.!?])\s+|\s+[-–—]\s+|:\s+|;\s+|,\s+/)[0] ?? ''; const cw = words(clause); if (cw.length >= 2 && cw.length <= max) return clause.replace(/[.,;:\-–—]+$/, '').trim();
  let head = w.slice(0, max); while (head.length > 2 && TAIL.test(head[head.length - 1])) head = head.slice(0, -1); return head.join(' ').replace(/[.,;:\-–—]+$/, '');
};
/** Notes that name a thing nobody needs pointed out (a board, a plate, the background), so they are not worth an arrow. */
const GENERIC_NOTE = /^(?:(?:white|black|plain|the|a|an|small|large)\s+)*(?:board|plate|cake board|background|backdrop|table|surface|tray|box|bag|case|paper|cup|container|bowl|stand|base|cake stand|wrapper|liner)$/i;

export function tidyCopy(copy: PostCopy, ctx: { pattern: Pattern; hasLogo: boolean; hasPhoto: boolean; businessName: string }): { copy: PostCopy; notes: string[] } {
  const notes: string[] = []; const out: PostCopy = { ...copy };
  if (words(copy.headline).length > 7) { out.headline = cut(copy.headline, 7); notes.push('The headline was shortened so it reads at a glance.'); }
  const sub = copy.subline ? cut(copy.subline, 11) : ''; if (sub !== copy.subline) { out.subline = sub; notes.push('The supporting line was shortened.'); }
  if (words(copy.cta).length > 4) { out.cta = cut(copy.cta, 4); }
  const seen = new Set<string>(); const good = copy.callouts.map((c) => c.trim()).filter((c) => c && !GENERIC_NOTE.test(c) && words(c).length <= 4 && !seen.has(c.toLowerCase()) && !!seen.add(c.toLowerCase())).slice(0, 3);
  if (good.length !== copy.callouts.length) notes.push(good.length >= 2 ? 'Notes that only name an obvious thing were left out.' : copy.callouts.length ? 'Too few worthwhile notes, so none are drawn.' : '');
  out.callouts = good.length >= 2 ? good : [];
  // the business's name once: a label above AND a logo below is clutter
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, ''); if (copy.eyebrow && ctx.hasLogo && ctx.hasPhoto && ['product_focus', 'seasonal', 'spotlight', 'collage', 'grid', 'benefits'].includes(ctx.pattern) && norm(ctx.businessName).includes(norm(copy.eyebrow).slice(0, 8))) { out.eyebrow = ''; notes.push('The name label was left out because the logo already shows it.'); }
  return { copy: out, notes: notes.filter(Boolean) };
}
