import { spawn } from 'node:child_process';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { aggregateRoles, colourRoles, saturationOf, type ColourRoles } from './colour.js';
import { LOGO_MATCH, nearestWindow, printFromRgba, type LogoPosition, type LogoPrint } from './logo.js';

/** Measuring a FINISHED video: its colours by role, whether they are warm beige or tan, and whether the reference's logo is in it. Used by tests and by the end-to-end report. */
const frames = (file: string, filter: string, bytesPerFrame: number): Promise<Buffer[]> => new Promise((resolve, reject) => {
  const bin = ffmpegPath(); if (!bin) return reject(new Error('FFmpeg is not available.'));
  const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-vf', filter, '-f', 'rawvideo', '-pix_fmt', filter.includes('format=gray') ? 'gray' : 'rgba', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: Buffer[] = []; child.stdout.on('data', (c: Buffer) => chunks.push(c)); child.on('error', reject);
  child.on('close', () => { const all = Buffer.concat(chunks); const out: Buffer[] = []; for (let i = 0; i + bytesPerFrame <= all.length; i += bytesPerFrame) out.push(all.subarray(i, i + bytesPerFrame)); resolve(out); });
});

export async function videoColourRoles(file: string, every = 1.5): Promise<ColourRoles | null> {
  const list = await frames(file, `fps=1/${every},scale=64:64:flags=area`, 64 * 64 * 4);
  return aggregateRoles(list.map((rgba) => colourRoles(new Uint8ClampedArray(rgba), 64)));
}

const hueOf = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255; const g = parseInt(hex.slice(3, 5), 16) / 255; const b = parseInt(hex.slice(5, 7), 16) / 255; const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return h * 60; };
const lightness = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16) / 255; const g = parseInt(hex.slice(3, 5), 16) / 255; const b = parseInt(hex.slice(5, 7), 16) / 255; return (Math.max(r, g, b) + Math.min(r, g, b)) / 2; };
export type WarmCheck = { warmBeigeOrTan: boolean; hue: number; saturation: number; lightness: number; warmth: number; why: string };
/** Warm beige or tan: an orange-yellow hue (15 to 50 degrees), some colour in it (not grey), and a mid-to-light tone, with warm light. */
export function warmBeigeOrTan(roles: ColourRoles): WarmCheck {
  const hue = Math.round(hueOf(roles.background)); const sat = Math.round(saturationOf(roles.background) * 100) / 100; const l = Math.round(lightness(roles.background) * 100) / 100;
  const ok = hue >= 15 && hue <= 50 && sat >= 0.1 && l >= 0.35 && l <= 0.92 && roles.warmth > 0.03;
  return { warmBeigeOrTan: ok, hue, saturation: sat, lightness: l, warmth: roles.warmth, why: ok ? 'backdrop hue, saturation, tone and light are those of warm beige or tan' : `backdrop hue ${hue}°, saturation ${sat}, lightness ${l}, warmth ${roles.warmth}: ${sat < 0.1 ? 'too grey' : hue < 15 || hue > 50 ? 'not a beige or tan hue' : roles.warmth <= 0.03 ? 'the light is not warm' : 'outside the beige/tan tone range'}` };
}

/** The logo pattern of a video's own logo (for a control: a detector must find a logo that is there). */
export async function printFromVideo(file: string, position: LogoPosition, atSeconds = 1): Promise<LogoPrint | null> {
  const W = 540; const H = 960; const list = await new Promise<Buffer[]>((resolve, reject) => { const bin = ffmpegPath(); if (!bin) return reject(new Error('FFmpeg is not available.')); const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-ss', String(atSeconds), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { stdio: ['ignore', 'pipe', 'ignore'] }); const b: Buffer[] = []; child.stdout.on('data', (c: Buffer) => b.push(c)); child.on('error', reject); child.on('close', () => resolve([Buffer.concat(b)])); });
  const rgba = list[0]; if (!rgba || rgba.length < W * H * 4) return null;
  return printFromRgba(rgba, W, H, position);
}

/** Searches a finished video for the reference's logo: its pattern AND its colours (see logo.ts). `similarity` is the pattern alone; `found` needs the colours too. */
export async function logoInVideo(file: string, print: LogoPrint, every = 2): Promise<{ similarity: number; confirmed: number; found: boolean; at: { x: number; y: number } }> {
  const W = 540; const H = 960; const list = await frames(file, `fps=1/${every},scale=${W}:${H}:flags=area`, W * H * 4);
  let best = { similarity: -1, confirmed: -1, at: { x: 0, y: 0 } }; for (const rgba of list.slice(0, 8)) { const near = nearestWindow(rgba, W, H, print, 6); if (near.similarity > best.similarity || near.confirmed > best.confirmed) best = { similarity: Math.max(best.similarity, near.similarity), confirmed: Math.max(best.confirmed, near.confirmed), at: near.confirmed >= LOGO_MATCH ? near.at : best.at }; }
  return { similarity: Math.round(best.similarity * 100) / 100, confirmed: Math.round(best.confirmed * 100) / 100, found: best.confirmed >= LOGO_MATCH, at: best.at };
}
