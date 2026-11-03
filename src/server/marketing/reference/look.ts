/**
 * The LOOK of a reference video, measured from its own pixels (so it does not depend on what a vision model says): how colourful, contrasty and bright it is, whether its light is
 * warm, cool or split teal-and-orange, whether it has a vignette, letterbox bars or film grain, and how it moves between shots (a hard cut or a dissolve) and within them
 * (a push in, a pull out, a pan, a tilt, or a still shot). Plain functions on small pictures, so they are exact, free and testable.
 */
export type VideoLook = {
  brightness: number; contrast: number; saturation: number; warmth: number; tint: 'warm' | 'cool' | 'neutral' | 'teal_orange';
  /** 0 (none) to 1: how much darker the corners are than the middle */ vignette: number;
  /** the share of the height taken by black bars at the top and again at the bottom (0 when there are none) */ letterbox: number;
  /** 0 (clean) to 1 (heavy): the fine noise in flat areas */ grain: number;
  /** how faded the blacks are (0 = true black) */ fade: number;
};

const lumOf = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const hsvSat = (r: number, g: number, b: number) => { const mx = Math.max(r, g, b); return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx; };

/** The look from a few frames, each a W x H RGBA picture. */
export function lookFromFrames(frames: Array<{ rgba: ArrayLike<number>; width: number; height: number }>): VideoLook {
  let lumSum = 0; let satSum = 0; let n = 0; const lums: number[] = []; let darkR = 0; let darkB = 0; let darkN = 0; let lightR = 0; let lightB = 0; let lightN = 0; let corner = 0; let centre = 0; let cn = 0; let nn = 0; let grainSum = 0; let grainN = 0; let blackTop = 0; let blackBottom = 0; let blackLowest = 1;
  for (const f of frames) {
    const { rgba, width: W, height: H } = f; const at = (x: number, y: number) => { const i = (y * W + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]] as const; };
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const [r, g, b] = at(x, y); const l = lumOf(r, g, b); lumSum += l; satSum += hsvSat(r, g, b); n += 1; lums.push(l); if (l < 0.3) { darkR += r; darkB += b; darkN += 1; } else if (l > 0.65) { lightR += r; lightB += b; lightN += 1; } }
    // corners against the middle
    const patch = (x0: number, y0: number, w: number, h: number) => { let s = 0; let c = 0; for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) { const [r, g, b] = at(x, y); s += lumOf(r, g, b); c += 1; } return c ? s / c : 0; };
    const pw = Math.max(4, Math.round(W * 0.14)); const ph = Math.max(4, Math.round(H * 0.1)); const cs = (patch(0, 0, pw, ph) + patch(W - pw, 0, pw, ph) + patch(0, H - ph, pw, ph) + patch(W - pw, H - ph, pw, ph)) / 4; const mid = patch(Math.round(W * 0.35), Math.round(H * 0.4), Math.round(W * 0.3), Math.round(H * 0.2)); corner += cs; centre += mid; cn += 1;
    // black bars: rows at the top and bottom that are black across the whole width in this frame
    const rowDark = (y: number) => { let m = 0; for (let x = 0; x < W; x += 4) { const [r, g, b] = at(x, y); m = Math.max(m, lumOf(r, g, b)); } return m < 0.1; }; // video black is not pure black (16 of 255)
    let t = 0; while (t < H * 0.3 && rowDark(t)) t += 1; let bt = 0; while (bt < H * 0.3 && rowDark(H - 1 - bt)) bt += 1; blackTop += t / H; blackBottom += bt / H; nn += 1; blackLowest = Math.min(blackLowest, Math.min(t, bt) / H);
    // grain: how much each pixel differs from the mean of its neighbours, in flat areas only
    for (let y = 2; y < H - 2; y += 5) for (let x = 2; x < W - 2; x += 5) { const [r, g, b] = at(x, y); const l = lumOf(r, g, b); let m = 0; let hi = 0; let lo = 1; for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) { const [r2, g2, b2] = at(x + dx, y + dy); const l2 = lumOf(r2, g2, b2); m += l2; hi = Math.max(hi, l2); lo = Math.min(lo, l2); } if (hi - lo < 0.045 && l > 0.08 && l < 0.92) { grainSum += Math.abs(l - m / 4); grainN += 1; } }
  }
  const brightness = n ? lumSum / n : 0.5; const mean = brightness; const std = Math.sqrt(lums.reduce((s, l) => s + (l - mean) ** 2, 0) / Math.max(1, lums.length)); const sat = n ? satSum / n : 0;
  const sorted = [...lums].sort((a, b) => a - b); const black = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const warmth = (() => { let r = 0; let b = 0; for (const f of frames) for (let i = 0; i < f.rgba.length; i += 4 * 17) { r += f.rgba[i]; b += f.rgba[i + 2]; } return r + b ? (r - b) / (r + b) : 0; })();
  const dr = darkN ? darkR / darkN : 0; const db = darkN ? darkB / darkN : 0; const lr = lightN ? lightR / lightN : 0; const lb = lightN ? lightB / lightN : 0;
  const split = darkN > 40 && lightN > 40 && (db - dr) > 6 && (lr - lb) > 10; // teal in the shadows, orange in the highlights
  const vignette = cn && centre > 0.04 ? Math.max(0, Math.min(1, 1 - corner / cn / (centre / cn))) : 0; const grain = grainN ? Math.max(0, Math.min(1, (grainSum / grainN) / 0.035)) : 0;
  const bars = nn ? Math.min(blackTop, blackBottom) / nn : 0; const letterbox = blackLowest > 0.02 && bars > 0.02 ? Math.round(Math.min(0.28, bars) * 1000) / 1000 : 0;
  return { brightness: round(brightness), contrast: round(Math.min(1, std / 0.3)), saturation: round(sat), warmth: round(warmth), tint: split ? 'teal_orange' : warmth > 0.06 ? 'warm' : warmth < -0.04 ? 'cool' : 'neutral', vignette: round(vignette), letterbox, grain: round(grain), fade: round(Math.max(0, Math.min(1, black / 0.12))) };
}
const round = (v: number) => Math.round(v * 100) / 100;

/** A cut or a dissolve, from how much the picture changed from one frame to the next across the moment of change (the differences are in order, one per step). */
export function boundaryKind(diffs: number[]): 'cut' | 'dissolve' {
  if (diffs.length < 3) return 'cut'; const total = diffs.reduce((s, d) => s + d, 0); if (total <= 0) return 'cut'; const peak = Math.max(...diffs); const spread = diffs.filter((d) => d > peak * 0.3).length;
  return peak / total > 0.5 || spread <= 2 ? 'cut' : 'dissolve';
}

export type CameraMove = 'static' | 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'handheld';
/** How the camera moves within a shot, from the measured zoom (end over start), drift of the main subject, and how restless the picture is. Amount is 0 (barely) to 1 (strong). */
export function cameraFrom({ zoom, dx, dy, motion }: { zoom?: number; dx?: number; dy?: number; motion?: number }): { move: CameraMove; amount: number } {
  const z = zoom ?? 1; const x = dx ?? 0; const y = dy ?? 0; const strongest = Math.max(Math.abs(Math.log(z)) / 0.35, Math.abs(x) / 0.25, Math.abs(y) / 0.25);
  if (strongest < 0.22) return (motion ?? 0) > 22 ? { move: 'handheld', amount: Math.min(1, (motion ?? 0) / 60) } : { move: 'static', amount: 0 };
  const amount = Math.round(Math.min(1, strongest) * 100) / 100;
  if (Math.abs(Math.log(z)) / 0.35 >= Math.max(Math.abs(x), Math.abs(y)) / 0.25) return { move: z > 1 ? 'push_in' : 'pull_out', amount };
  return Math.abs(x) >= Math.abs(y) ? { move: x > 0 ? 'pan_right' : 'pan_left', amount } : { move: y > 0 ? 'tilt_down' : 'tilt_up', amount };
}
