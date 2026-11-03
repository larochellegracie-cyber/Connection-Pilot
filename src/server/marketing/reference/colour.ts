/**
 * The colours of a frame by ROLE, not an average of everything: the backdrop (the side strips of the middle of the picture, away from the hero), the floor
 * (the lower side strips), the light (the brightest pixels), the hero (the middle), the accent (the most colourful frequent colour), the text (what stands
 * furthest from the backdrop in the headline band), and the warmth of the light. Averaging a whole frame mixes a beige backdrop, a brown floor and a dark
 * product into grey; reading by role keeps the colours the eye sees. Each role also carries the share of the frame its colour family fills.
 */
export type Roles = 'background' | 'floor' | 'glow' | 'hero' | 'accent' | 'text';
export type ColourRoles = {
  background: string; floor: string; glow: string; hero: string; accent: string; text: string;
  /** the colour families of the frame with the share of it each fills and the role each plays */ proportions: Array<{ hex: string; share: number; role: Roles | 'other' }>;
  /** where the floor begins, as a fraction of the frame's height, when the frame shows a floor below a backdrop (the biggest step in brightness down the side strips); null when it does not */ horizon: number | null;
  /** the backdrop and the floor are clearly different surfaces (so they must not be collapsed into one colour) */ separated: boolean;
  /** (red - blue) / (red + blue) of the backdrop and the light: above 0.05 is warm light, below -0.03 cool */ warmth: number; temperature: 'warm' | 'neutral' | 'cool';
};

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const sat = (r: number, g: number, b: number) => { const max = Math.max(r, g, b); const min = Math.min(r, g, b); return max === 0 ? 0 : (max - min) / max; };
const median = (values: number[]) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

type Px = [number, number, number];
const medianColour = (pixels: Px[]): Px => [median(pixels.map((p) => p[0])), median(pixels.map((p) => p[1])), median(pixels.map((p) => p[2]))];
const meanColour = (pixels: Px[]): Px => (pixels.length ? [0, 1, 2].map((i) => pixels.reduce((s, p) => s + p[i], 0) / pixels.length) as Px : [128, 128, 128]);

/** Reads the roles from a small RGBA picture (side x side). */
export function colourRoles(rgba: Uint8ClampedArray | Buffer, side: number): ColourRoles {
  const at = (x: number, y: number): Px => { const i = (y * side + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; };
  const region = (x0: number, x1: number, y0: number, y1: number, edgeOnly = false) => { const out: Px[] = []; for (let y = Math.floor(y0 * side); y < Math.ceil(y1 * side); y += 1) for (let x = Math.floor(x0 * side); x < Math.ceil(x1 * side); x += 1) { if (edgeOnly && x >= 0.2 * side && x < 0.8 * side) continue; out.push(at(Math.min(side - 1, x), Math.min(side - 1, y))); } return out; };
  const back = medianColour(region(0, 1, 0.1, 0.55, true));
  // the horizon: the biggest step in brightness going down the side strips (clear of the hero), then the floor is the band just below it
  const rowLum = (y: number) => { const row: Px[] = []; for (let x = 0; x < side; x += 1) if (x < 0.2 * side || x >= 0.8 * side) row.push(at(x, y)); const m = medianColour(row); return lum(...m); };
  let horizonRow = -1; let bestStep = 0; for (let y = Math.floor(0.45 * side); y < Math.floor(0.92 * side); y += 1) { const above = (rowLum(y - 1) + rowLum(y - 2) + rowLum(y - 3)) / 3; const below = (rowLum(y) + rowLum(y + 1) + rowLum(Math.min(side - 1, y + 2))) / 3; const step = Math.abs(above - below); if (step > bestStep) { bestStep = step; horizonRow = y; } }
  const horizon = bestStep >= 0.05 ? horizonRow / side : null;
  const floorBand: Px[] = []; if (horizon !== null) for (let y = horizonRow + 1; y < Math.min(side, horizonRow + 1 + Math.ceil(0.12 * side)); y += 1) for (let x = 0; x < side; x += 1) if (x < 0.2 * side || x >= 0.8 * side) floorBand.push(at(x, y));
  const floor = horizon !== null && floorBand.length ? medianColour(floorBand) : medianColour(region(0, 1, 0.8, 0.99, true));
  const upper = region(0, 1, 0, 0.7); const brightest = [...upper].sort((a, b) => lum(...b) - lum(...a)).slice(0, Math.max(3, Math.floor(upper.length * 0.03)));
  const glow = meanColour(brightest);
  // the hero: the commonest colour family in the middle of the frame
  const centre = region(0.3, 0.7, 0.35, 0.8); const fam = new Map<string, Px[]>();
  for (const p of centre) { const k = `${p[0] >> 5}${p[1] >> 5}${p[2] >> 5}`; (fam.get(k) ?? fam.set(k, []).get(k)!).push(p); }
  const hero = meanColour([...fam.values()].sort((a, b) => b.length - a.length)[0] ?? []);
  // the families of the whole frame, with shares, then the accent: the most colourful family that fills a fair share
  const all = new Map<string, Px[]>(); for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) { const p = at(x, y); const k = `${p[0] >> 5}${p[1] >> 5}${p[2] >> 5}`; (all.get(k) ?? all.set(k, []).get(k)!).push(p); }
  const total = side * side;
  const families = [...all.values()].map((px) => ({ mean: meanColour(px), share: px.length / total })).sort((a, b) => b.share - a.share);
  const near = (a: Px, b: Px) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const lively = families.filter((f) => f.share > 0.01 && sat(...f.mean) > 0.3 && near(f.mean, back) > 60).sort((a, b) => sat(...b.mean) * Math.sqrt(b.share) - sat(...a.mean) * Math.sqrt(a.share))[0];
  const accent = lively ? lively.mean : hero;
  // the text: in the headline band the colour furthest from the backdrop (words are the highest-contrast thing there), or ink/white by the backdrop's brightness
  const band = region(0, 1, 0.05, 0.3).filter((p) => near(p, back) > 90).sort((a, b) => near(b, back) - near(a, back)).slice(0, 12);
  const text: Px = band.length >= 4 ? meanColour(band) : lum(...back) > 0.5 ? [30, 24, 20] : [250, 245, 238];
  const roleOf = (mean: Px): Roles | 'other' => { const candidates: Array<[Roles, Px]> = [['background', back], ['floor', floor], ['glow', glow], ['hero', hero], ['accent', accent], ['text', text]]; const best = candidates.map(([role, c]) => ({ role, d: near(mean, c) })).sort((a, b) => a.d - b.d)[0]; return best.d < 55 ? best.role : 'other'; };
  const warmth = (() => { const r = (back[0] + glow[0]) / 2; const b = (back[2] + glow[2]) / 2; return (r - b) / Math.max(1, r + b); })();
  return {
    background: hex(...back), floor: hex(...floor), glow: hex(...glow), hero: hex(...hero), accent: hex(...accent), text: hex(...text),
    proportions: families.slice(0, 6).map((f) => ({ hex: hex(...f.mean), share: Math.round(f.share * 100) / 100, role: roleOf(f.mean) })),
    horizon: horizon === null ? null : Math.round(horizon * 100) / 100, separated: horizon !== null && near(floor, back) > 35,
    warmth: Math.round(warmth * 1000) / 1000, temperature: warmth > 0.05 ? 'warm' : warmth < -0.03 ? 'cool' : 'neutral',
  };
}

const hexToPx = (h: string): Px => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** One set of roles for a whole video: each role's colour is the median of the frames', and the proportions are the frames' averaged by role. */
export function aggregateRoles(list: ColourRoles[]): ColourRoles | null {
  if (!list.length) return null;
  const pick = (role: Roles) => { const px = list.map((r) => hexToPx(r[role])); return hex(median(px.map((p) => p[0])), median(px.map((p) => p[1])), median(px.map((p) => p[2]))); };
  const byHex = new Map<string, { hex: string; share: number; role: ColourRoles['proportions'][number]['role'] }>();
  for (const roles of list) for (const p of roles.proportions) { const cur = byHex.get(p.hex); if (cur) cur.share += p.share / list.length; else byHex.set(p.hex, { ...p, share: p.share / list.length }); }
  const warmth = median(list.map((r) => r.warmth)); const horizons = list.map((r) => r.horizon).filter((h): h is number => h !== null); const separated = list.filter((r) => r.separated).length * 2 > list.length;
  return { horizon: horizons.length * 2 > list.length ? Math.round(median(horizons) * 100) / 100 : null, separated, background: pick('background'), floor: pick('floor'), glow: pick('glow'), hero: pick('hero'), accent: pick('accent'), text: pick('text'), proportions: [...byHex.values()].sort((a, b) => b.share - a.share).slice(0, 8).map((p) => ({ ...p, share: Math.round(p.share * 100) / 100 })), warmth, temperature: warmth > 0.05 ? 'warm' : warmth < -0.03 ? 'cool' : 'neutral' };
}

/** How far apart two colours look, 0 (the same) to about 441 (black and white). */
export const colourDistance = (a: string, b: string) => { const x = hexToPx(a); const y = hexToPx(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
/** The saturation (0..1) of a colour. */
export const saturationOf = (h: string) => sat(...hexToPx(h));
