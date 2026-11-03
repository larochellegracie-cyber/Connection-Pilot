import { contrast, type Box, type PostResult } from './layouts.js';
import { MARGIN } from './tokens.js';

/** The design check every post passes before it is shown: the rules in tokens.ts, as measurable facts about where things were drawn. Returns what is wrong (empty when the post is clean). */
export function lintPost(post: Pick<PostResult, 'boxes' | 'width' | 'height' | 'pattern' | 'palette' | 'margin'>): string[] {
  const { boxes, width: W, height: H } = post; const m = post.margin ?? W * MARGIN; const issues: string[] = []; const tol = 3;
  const texts = boxes.filter((b) => b.kind === 'text'); const photos = boxes.filter((b) => b.kind === 'photo');
  for (const b of boxes) {
    if (b.kind === 'photo') { if (b.bleed) continue; if (b.x < m - tol - W * 0.03 || b.y < 0 || b.x + b.w > W - m + tol * 2 + W * 0.02 || b.y + b.h > H) issues.push(`the photo (${b.id}) is outside the page margin`); continue; }
    if (b.kind === 'icon' || b.kind === 'graphic') continue;
    if (b.x < m - tol || b.x + b.w > W - m + tol) issues.push(`“${b.id}” is closer than the margin to the edge`);
    if (b.id !== 'bandlabel' && (b.y < m * 0.4 || b.y + b.h > H - m * 0.3)) issues.push(`“${b.id}” is too close to the top or bottom edge`);
  }
  for (const t of texts) {
    if ((t.size ?? 0) < W * 0.022) issues.push(`“${t.id}” is too small to read (${t.size}px)`);
    if (t.colour && t.on) { const need = (t.size ?? 0) >= W * 0.04 ? 3 : 4.5; const c = contrast(t.colour, t.on); if (c < need - 0.01 && !/^callout/.test(t.id)) issues.push(`“${t.id}” has too little contrast with what is behind it (${c.toFixed(1)} to 1, needs ${need})`); else if (c < 3 && /^callout/.test(t.id)) issues.push(`“${t.id}” is too faint (${c.toFixed(1)} to 1)`); }
  }
  for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) { const a = texts[i]; const b = texts[j]; const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); const oy = Math.min(a.y + a.h * 0.9, b.y + b.h * 0.9) - Math.max(a.y, b.y); if (ox > 2 && oy > 2) issues.push(`“${a.id}” overlaps “${b.id}”`); }
  if (post.pattern !== 'overlay') for (const t of texts) for (const p of photos) { if (/^callout/.test(t.id)) continue; const ox = Math.min(t.x + t.w, p.x + p.w) - Math.max(t.x, p.x); const oy = Math.min(t.y + t.h * 0.9, p.y + p.h) - Math.max(t.y, p.y); if (ox > 2 && oy > 2) issues.push(`“${t.id}” runs over the photo`); }
  // a clean break: a block of words never ends on a single stray word, and the headline is big enough to read at a glance
  const blocks = new Map<string, Box[]>(); for (const t of texts) { const k = /^(headline|sub|quote)(\d+)$/.exec(t.id); if (k) blocks.set(k[1], [...(blocks.get(k[1]) ?? []), t]); }
  for (const [name, lines] of blocks) { if (lines.length >= 2) { const total = lines.reduce((n, l) => n + (l.str ?? '').split(/\s+/).filter(Boolean).length, 0); const last = (lines[lines.length - 1].str ?? '').split(/\s+/).filter(Boolean).length; const prev = lines.length >= 2 ? (lines[lines.length - 2].str ?? '').split(/\s+/).filter(Boolean).length : 0; if (total >= 4 && last === 1 && prev >= 3) issues.push(`the ${name} ends on a single stray word`); } if (name === 'headline' && Math.min(...lines.map((l) => l.size ?? 999)) < W * 0.048) issues.push('the headline is too small to read at a glance'); }
  // empty space is part of a good design, but not a hole: no big gap between things, and no big empty end
  { const spans = boxes.filter((b) => (b.kind === 'text' || b.kind === 'photo' || b.kind === 'button' || b.kind === 'graphic') && b.id !== 'bandlabel').map((b) => [b.y, b.y + b.h] as const).sort((a, b2) => a[0] - b2[0]); const logo = boxes.find((b) => b.kind === 'logo'); const floor = logo ? logo.y : H - m; let top = m; let worst = 0; for (const [a, b2] of spans) { if (a > top) worst = Math.max(worst, a - top); top = Math.max(top, b2); } worst = Math.max(worst, floor - top); if (post.pattern !== 'overlay' && spans.length && worst > H * 0.3) issues.push('a large empty area in the layout'); }
  const hero = photos.find((p) => p.id === 'hero'); if (hero && ['product_focus', 'seasonal', 'spotlight'].includes(post.pattern) && hero.w * hero.h < W * H * (hero.tight ? 0.11 : 0.2)) issues.push('the product photo is too small: it should be the largest thing in the post');
  return issues;
}
