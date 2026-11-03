import { createCanvas, loadImage } from '@napi-rs/canvas';

/**
 * Cuts a logo out of its background: the colour of the picture's edge (usually white) is removed by flood-filling inward from every border pixel, the edge is feathered a
 * little so there is no rough fringe, and the result is trimmed to the artwork with a small margin. A logo that already has transparency is only trimmed.
 * Returns a PNG, or null when the picture cannot be read or nothing is left.
 */
export async function cutOutLogo(bytes: Buffer, { tolerance = 38, maxSide = 900 }: { tolerance?: number; maxSide?: number } = {}): Promise<Buffer | null> {
  let image; try { image = await loadImage(bytes); } catch { return null; }
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height)); const w = Math.max(2, Math.round(image.width * scale)); const h = Math.max(2, Math.round(image.height * scale));
  const canvas = createCanvas(w, h); const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h); const px = data.data; const at = (x: number, y: number) => (y * w + x) * 4;
  const border: Array<[number, number]> = []; for (let x = 0; x < w; x += 1) { border.push([x, 0], [x, h - 1]); } for (let y = 0; y < h; y += 1) { border.push([0, y], [w - 1, y]); }
  const opaque = border.filter(([x, y]) => px[at(x, y) + 3] > 200); const bg = [0, 0, 0]; if (opaque.length) { for (const [x, y] of opaque) for (let k = 0; k < 3; k += 1) bg[k] += px[at(x, y) + k]; for (let k = 0; k < 3; k += 1) bg[k] /= opaque.length; }
  const near = (i: number) => px[i + 3] < 20 || Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]) < tolerance;
  if (opaque.length) {
    const seen = new Uint8Array(w * h); const stack: number[] = [];
    for (const [x, y] of border) if (near(at(x, y))) { seen[y * w + x] = 1; stack.push(y * w + x); }
    while (stack.length) { const p = stack.pop()!; const x = p % w; const y = (p - x) / w; px[p * 4 + 3] = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx; const ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx]) continue; if (near(at(nx, ny))) { seen[ny * w + nx] = 1; stack.push(ny * w + nx); } } }
    // feather: an artwork pixel that touches the removed area and still looks like the background is made half transparent, so the edge has no halo
    const alpha = px.slice().filter((_, i) => i % 4 === 3);
    for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) { const p = y * w + x; if (alpha[p] === 0) continue; const touches = alpha[p - 1] === 0 || alpha[p + 1] === 0 || alpha[p - w] === 0 || alpha[p + w] === 0; if (!touches) continue; const d = Math.hypot(px[p * 4] - bg[0], px[p * 4 + 1] - bg[1], px[p * 4 + 2] - bg[2]); if (d < tolerance * 2.2) px[p * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0.15, (d - tolerance) / (tolerance * 1.2)))); }
  }
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1; for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (px[at(x, y) + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0 || (x1 - x0) * (y1 - y0) < w * h * 0.01) return null;
  ctx.putImageData(data, 0, 0); const m = 6; const cw = x1 - x0 + 1 + m * 2; const ch = y1 - y0 + 1 + m * 2; const out = createCanvas(cw, ch); out.getContext('2d').drawImage(canvas, x0 - m, y0 - m, cw, ch, 0, 0, cw, ch);
  return out.toBuffer('image/png');
}
