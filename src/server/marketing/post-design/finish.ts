import { alpha, mix, type Ctx } from './draw-utils.js';

/**
 * The finishing touches that make a post feel designed and not merely laid out: a page with soft light and gentle edges instead of a flat fill, a trace of paper grain,
 * a fine keyline frame, soft glows behind the product, and photo edges with a hairline rim and a shadow tinted by the page. All deterministic (the same post always
 * looks the same), all drawn behind or around the content, and none of it changes where anything sits.
 */
const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** A fine, even grain over the page (the way printed paper has a surface). `amount` is a fraction of full brightness. */
export function grain(ctx: Ctx, W: number, H: number, amount: number, seed = 7): void {
  const img = ctx.getImageData(0, 0, W, H); const d = img.data; const r = rng(seed); const amp = amount * 255;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 2 * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}

/** The page: the colour gradient, then (unless the photo's own backdrop must match it exactly) a soft pool of light and gently darker edges, then a trace of grain. */
export function paintBackdrop(ctx: Ctx, W: number, H: number, pal: { bgTop: string; bgBottom: string; accent: string }, opts: { seamless: boolean; card: boolean; /** a clean flat page (no pool of light, no darker edges) */ flat?: boolean; /** the grain strength (default: a trace) */ grain?: number }): void {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal.bgTop); g.addColorStop(1, pal.bgBottom); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (!opts.seamless && !opts.flat) {
    const cx = W * 0.5; const cy = H * 0.34; const R = Math.max(W, H) * 0.78; const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    light.addColorStop(0, opts.card ? alpha(mix(pal.accent, '#FFFFFF', 0.4), 0.15) : 'rgba(255,255,255,0.38)'); light.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = light; ctx.fillRect(0, 0, W, H);
    const edge = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.82); edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, opts.card ? 'rgba(0,0,0,0.15)' : 'rgba(60,30,20,0.06)'); ctx.fillStyle = edge; ctx.fillRect(0, 0, W, H);
  }
  const amount = opts.grain ?? (opts.seamless ? 0.01 : opts.card ? 0.022 : 0.016); if (amount > 0) grain(ctx, W, H, amount);
}

/** A fine keyline frame set inside the page edge. */
export function keyline(ctx: Ctx, W: number, H: number, inset: number, colour: string, a: number): void {
  ctx.save(); ctx.strokeStyle = alpha(colour, a); ctx.lineWidth = Math.max(2, W * 0.002); ctx.beginPath(); ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, W * 0.024); ctx.stroke(); ctx.restore();
}

/** A soft round glow (no hard edge). */
export function softDisc(ctx: Ctx, cx: number, cy: number, r: number, colour: string, a: number): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, alpha(colour, a)); g.addColorStop(0.55, alpha(colour, a * 0.45)); g.addColorStop(1, alpha(colour, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}

/** Two hairlines either side of a centred label, the way a printed menu sets a small heading. */
export function flankedLabel(ctx: Ctx, W: number, y: number, textWidth: number, size: number, colour: string, a = 0.38): void {
  const gap = size * 0.9; const len = Math.min(W * 0.1, size * 3.6); const cy = y + size * 0.62; ctx.save(); ctx.strokeStyle = alpha(colour, a); ctx.lineWidth = Math.max(1.5, W * 0.0016); ctx.lineCap = 'round';
  for (const side of [-1, 1]) { const x0 = W / 2 + side * (textWidth / 2 + gap); ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + side * len, cy); ctx.stroke(); }
  ctx.restore();
}
