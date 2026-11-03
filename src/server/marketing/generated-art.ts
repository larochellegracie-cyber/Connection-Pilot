import { createHash } from 'node:crypto';
import { saveBusinessImage } from './standard-video/business-assets.js';
import { paletteFor } from './standard-video/plan-layout.js';
import { getMediaStorage, type AssetMeta, type MediaStorage } from './standard-video/storage.js';
import type { BrandKit } from './standard-video/templates.js';

/**
 * Generated artwork, for when nothing the business uploaded or imported from its website fits what a post or video is about.
 *
 * Pilot draws it on this server (no image service, no cost, no Runway): a designed piece of brand-coloured art whose look comes from the
 * subject, for example moving pool-light caustics for anything about water, drifting snow and cool light for closing or winter, warm light
 * shafts for opening or summer, glints for cleaning. It uses the brand's own base and accent colours, has no text, people, products or
 * places in it (so it cannot be mistaken for the business's real work), and is saved in the business's Photos labelled "Made by Pilot" so
 * the owner can see it, reuse it or delete it. The same subject and brand always give the same artwork, so a second request reuses it.
 *
 * An AI-generated picture (OpenAI) is a separate, explicit request (see image.ts); it is not what this does.
 */
export type ArtTheme = { base: 'water' | 'flow'; snow: boolean; sun: boolean; sparkle: boolean; words: string };

const has = (text: string, pattern: RegExp) => pattern.test(text);

/** What the subject is about, in terms of the look: a water scene or flowing colour, plus optional snow, sun and sparkle. */
export function themeFor(text: string): ArtTheme {
  const t = text.toLowerCase();
  const water = has(t, /\b(?:pools?|swim\w*|water|spa|hot ?tub|wash\w*|rinse|splash|lake|beach|boat|marina|irrigation|plumb\w*|fountain|rain)\b/);
  const snow = has(t, /\b(?:clos(?:e|ing|ed|ure)|winter\w*|freez\w*|frost|cold|snow|ice|cover(?:ing)?|off[- ]?season|holiday|christmas)\b/);
  const sun = has(t, /\b(?:open(?:ing|ed)?|summer|spring|sun\w*|season start|party|bbq|barbecue|garden|lawn|patio|outdoor|vacation|beach)\b/);
  const sparkle = has(t, /\b(?:clean\w*|sparkl\w*|shin\w*|fresh\w*|polish\w*|spotless|detail\w*|pressure|power ?wash\w*|wash\w*)\b/);
  const words = [water && 'water', snow && 'winter', sun && 'sunlit', sparkle && 'sparkling'].filter(Boolean).join(' ');
  return { base: water ? 'water' : 'flow', snow: snow && !sun, sun: sun && !snow, sparkle, words: words || 'brand colour' };
}

// ---- drawing -------------------------------------------------------------------------------------------------------------------

const hexRgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mulberry = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** 2D gradient noise (Perlin), seeded by the same random source as the rest of the art. Returns roughly -1..1. */
function perlin(rand: () => number): (x: number, y: number) => number {
  const perm = new Uint8Array(512); const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h: number, x: number, y: number) => { const g = h & 7; const u = g < 4 ? x : y; const v = g < 4 ? y : x; return ((g & 1) ? -u : u) + ((g & 2) ? -2 * v : 2 * v); };
  return (x, y) => {
    const xi = Math.floor(x) & 255; const yi = Math.floor(y) & 255; const xf = x - Math.floor(x); const yf = y - Math.floor(y); const u = fade(xf); const v = fade(yf);
    const aa = perm[perm[xi] + yi]; const ab = perm[perm[xi] + yi + 1]; const ba = perm[perm[xi + 1] + yi]; const bb = perm[perm[xi + 1] + yi + 1];
    const l1 = grad(aa, xf, yf) + (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) * u; const l2 = grad(ab, xf, yf - 1) + (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1)) * u;
    return (l1 + (l2 - l1) * v) * 0.45;
  };
}

export type ArtColours = { deep: string; mid: string; light: string; accent: string };

/** The art's four colours, taken from the brand: a deep base, a mid tone, a light tone for highlights, and the brand accent. */
export function artColours(kit: BrandKit): ArtColours {
  const p = paletteFor(kit);
  return { deep: p.bgB, mid: p.bgA, light: p.glow, accent: p.accent };
}

/**
 * Draws the artwork as a JPEG (portrait 1080x1920 by default: it is cropped for squares and wide formats). Deterministic for a seed.
 * Layers: a deep brand gradient; for water, caustic light (the web of bright lines a pool bottom shows); light shafts or soft bokeh; optional
 * snow, sun glow and glints; a gentle vignette and film grain so it reads as finished, designed art rather than a flat fill.
 */
export async function renderArt({ theme, colours, width = 1080, height = 1920, seed = 1 }: { theme: ArtTheme; colours: ArtColours; width?: number; height?: number; seed?: number }): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height); const ctx = canvas.getContext('2d');
  const rand = mulberry(seed);
  const deep = hexRgb(colours.deep); const mid = hexRgb(colours.mid); const light = mix(hexRgb(colours.light), [255, 255, 255], 0.35); const accent = hexRgb(colours.accent);
  const cool = theme.snow ? mix(mid, [90, 130, 175], 0.25) : mid;

  // 1. the deep brand gradient
  const g = ctx.createLinearGradient(0, 0, width * 0.25, height);
  g.addColorStop(0, `rgb(${mix(cool, deep, 0.15).map(Math.round)})`); g.addColorStop(1, `rgb(${deep.map(Math.round)})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);

  // 2. light on water (or soft flowing light for anything else): domain-warped ridged noise, which makes the thin, bright, organic web of lines a
  //    pool bottom shows. Drawn at half size and scaled up, which also softens it.
  const noise = perlin(rand);
  const sw = Math.ceil(width / 2); const sh = Math.ceil(height / 2);
  const small = createCanvas(sw, sh); const sctx = small.getContext('2d'); const img = sctx.createImageData(sw, sh); const px = img.data;
  const tint = mix(light, accent, 0.12); const water = theme.base === 'water'; const strength = water ? (theme.snow ? 0.5 : 0.78) : 0.3;
  const ox = rand() * 100; const oy = rand() * 100; const f1 = 3.2 / sw; const f2 = 5.4 / sw;
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      let v: number;
      if (water) {
        const wx = noise(x * f1 * 0.7 + ox, y * f1 * 0.7 + oy) * 1.6; const wy = noise(x * f1 * 0.7 + oy, y * f1 * 0.7 - ox) * 1.6;           // domain warp: the ripple of the surface
        const a = 1 - Math.abs(noise(x * f1 + wx + ox, y * f1 + wy)) * 1.9; const b = 1 - Math.abs(noise(x * f2 + wy - oy, y * f2 + wx + 7));
        const patch = 0.55 + 0.45 * (noise(x * f1 * 0.35 + 3, y * f1 * 0.35 + 9) + 0.5);   // slow bright and dim patches, like sun reaching the water unevenly
        v = (Math.pow(Math.max(0, a), 11) * 1.5 + Math.pow(Math.max(0, b), 13) * 0.8) * patch;
        v *= 0.5 + 0.5 * Math.pow(1 - y / sh, 0.9);                                                                                          // brighter near the surface, fading into depth
      } else {
        const a = noise(x * f1 * 0.6 + ox, y * f1 * 0.9 + oy); v = Math.pow(Math.max(0, a * 1.3), 2.2);
      }
      v = Math.min(1, v * strength);
      const o = (y * sw + x) * 4; px[o] = tint[0]; px[o + 1] = tint[1]; px[o + 2] = tint[2]; px[o + 3] = Math.round(255 * v);
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(small, 0, 0, width, height);

  const glow = (cx: number, cy: number, r: number, rgb: number[], a: number) => { const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, `rgba(${rgb.map(Math.round)},${a})`); rg.addColorStop(1, `rgba(${rgb.map(Math.round)},0)`); ctx.fillStyle = rg; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); };

  // 3. a soft pool of brand light, and the accent as a warm counter-glow
  glow(width * 0.8, height * 0.12, width * 0.9, light, theme.sun ? 0.34 : 0.2);
  glow(width * 0.1, height * 0.82, width * 0.8, accent, 0.1);

  // 4. sun: wide, very soft shafts of light from the top corner, each drawn on its own layer with feathered edges and a long fade, then added to the picture
  if (theme.sun) {
    for (let i = 0; i < 5; i += 1) {
      const angle = 1.95 + i * 0.17 + (rand() - 0.5) * 0.05; const w = 170 + rand() * 230; const strength = 0.12 + rand() * 0.1; const length = height * 1.3;
      const layer = createCanvas(width, height); const lctx = layer.getContext('2d');
      lctx.translate(width * 0.88, -120); lctx.rotate(angle - Math.PI / 2);
      const band = lctx.createLinearGradient(-w, 0, w, 0); band.addColorStop(0, 'rgba(255,236,205,0)'); band.addColorStop(0.5, `rgba(255,236,205,${strength})`); band.addColorStop(1, 'rgba(255,236,205,0)');
      lctx.fillStyle = band; lctx.fillRect(-w, 0, 2 * w, length);
      lctx.globalCompositeOperation = 'destination-in'; const fall = lctx.createLinearGradient(0, 0, 0, length); fall.addColorStop(0, 'rgba(0,0,0,1)'); fall.addColorStop(1, 'rgba(0,0,0,0)'); lctx.fillStyle = fall; lctx.fillRect(-w, 0, 2 * w, length);
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(layer, 0, 0); ctx.restore();
    }
  }

  // 5. snow: soft out-of-focus flakes of different sizes (near ones large and faint, far ones small and sharper), and a few fine crystals
  if (theme.snow) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const flakes = Math.round((width * height) / 9000);
    for (let i = 0; i < flakes; i += 1) {
      const depth = rand(); const r = 3 + depth ** 2.2 * 34; const x = rand() * width; const y = rand() * height;
      glow(x, y, r * 1.6, [235, 245, 255], 0.14 + (1 - depth) * 0.42);
    }
    ctx.strokeStyle = 'rgba(235,245,255,0.5)'; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i += 1) {
      const cx = rand() * width; const cy = rand() * height; const r = 16 + rand() * 24; const rot = rand() * Math.PI; ctx.lineWidth = 1.2 + rand(); ctx.globalAlpha = 0.18 + rand() * 0.25;
      for (let k = 0; k < 6; k += 1) { const a = rot + (k * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke(); const bx = cx + Math.cos(a) * r * 0.6; const by = cy + Math.sin(a) * r * 0.6; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(a + s * 0.7) * r * 0.32, by + Math.sin(a + s * 0.7) * r * 0.32); ctx.stroke(); } }
    }
    ctx.restore();
  }

  // 6. sparkle: soft highlights on the water (a few large, many small), never hard stars
  if (theme.sparkle) {
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 34; i += 1) { const x = rand() * width; const y = rand() * height * 0.8; const r = 5 + rand() ** 2.4 * 30; glow(x, y, r * 2.4, [235, 248, 255], 0.14 + rand() * 0.4); }
    ctx.restore();
  }

  // 7. vignette and film grain: the finishing that makes it look designed
  const vg = ctx.createRadialGradient(width / 2, height * 0.45, Math.min(width, height) * 0.25, width / 2, height * 0.5, Math.hypot(width, height) * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, width, height);
  const finish = ctx.getImageData(0, 0, width, height); const d = finish.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rand() - 0.5) * 9; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(finish, 0, 0);
  return canvas.toBuffer('image/jpeg', 90);
}

// ---- the library --------------------------------------------------------------------------------------------------------------------

export const generatedArtEnabled = () => (process.env.PILOT_GENERATED_ART ?? 'on').trim().toLowerCase() !== 'off';
const MAX_GENERATED = 8;
const MADE_BY = 'Made by Pilot';

const titleOf = (subject: string) => subject.replace(/[^A-Za-z0-9&\s'-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').toLowerCase();

/**
 * The generated artwork for a subject, made and saved to the business's Photos if there is none yet. Returns null when the feature is off or the
 * library is full of generated art already (the caller then falls back to the plain branded graphic). The art is labelled with the subject's own
 * words ("Made by Pilot – winter pool closing"), so the same word-matching that picks the owner's photos picks it for this subject.
 */
export async function ensureGeneratedArt({ tenantId, subject, kit, storage = getMediaStorage(), businessWords = '' }: { tenantId: string; subject: string; kit: BrandKit; storage?: MediaStorage; /** words every post of this business shares, left out of the label */ businessWords?: string }): Promise<{ asset: AssetMeta; reused: boolean } | null> {
  if (!generatedArtEnabled() || !subject.trim()) return null;
  const theme = themeFor(subject); const colours = artColours(kit);
  const key = `art-${createHash('sha1').update(`${theme.base}${theme.snow}${theme.sun}${theme.sparkle}${colours.deep}${colours.mid}${colours.light}${colours.accent}`).digest('hex').slice(0, 12)}`;
  const existing = await storage.listAssets(tenantId);
  const same = existing.find((asset) => asset.tags.includes(key));
  if (same) return { asset: same, reused: true };
  if (existing.filter((asset) => asset.tags.includes('generated')).length >= MAX_GENERATED) return null;
  const seed = parseInt(createHash('sha1').update(key).digest('hex').slice(0, 8), 16);
  const bytes = await renderArt({ theme, colours, seed });
  const label = `${MADE_BY} – ${[titleOf(subject), theme.words].filter(Boolean).join(' ')}`.slice(0, 120);
  const asset = await saveBusinessImage({ tenantId, bytes, originalName: `${key}.jpg`, storage, fields: { kind: 'photo', label, description: `Artwork Pilot generated because no photo of yours matched “${subject.slice(0, 80)}”. It has no text, people or real places in it.`, tags: ['generated', key, 'artwork'] } });
  return { asset, reused: false };
}
