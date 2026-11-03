/**
 * Checks and cleans up pictures a business uploads. The file's real contents decide what it is (not its name or its
 * claimed type), only PNG, JPEG and WebP are accepted, big photos are reduced to a sensible size, and the picture is
 * re-encoded, which removes hidden data such as the location a phone photo was taken at.
 */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_SIDE = 2160;

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export function sniffImage(buffer: Buffer): ImageFormat | null {
  if (buffer.length > 12 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** The EXIF orientation of a JPEG (1–8), or 1 when there is none. Phone photos are often stored sideways with a note saying so. */
export function jpegOrientation(buffer: Buffer): number {
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) return 1;
    const marker = buffer[offset + 1]; const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1 && buffer.subarray(offset + 4, offset + 10).toString('latin1') === 'Exif\0\0') {
      const base = offset + 10; const little = buffer.subarray(base, base + 2).toString('latin1') === 'II';
      const u16 = (at: number) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
      const u32 = (at: number) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
      try {
        const ifd = base + u32(base + 4); const count = u16(ifd);
        for (let i = 0; i < count; i += 1) { const entry = ifd + 2 + i * 12; if (u16(entry) === 0x0112) { const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : 1; } }
      } catch { return 1; }
      return 1;
    }
    if (marker === 0xda) return 1;
    offset += 2 + length;
  }
  return 1;
}

export class ImageProblem extends Error {
  constructor(public readonly publicMessage: string) { super(publicMessage); this.name = 'ImageProblem'; }
}

export type CleanImage = { bytes: Buffer; mime: 'image/jpeg' | 'image/png'; width: number; height: number };

export async function cleanImage(input: Buffer): Promise<CleanImage> {
  if (!input.length) throw new ImageProblem('That file is empty.');
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageProblem('That image is larger than 6 MB. Choose a smaller one.');
  const format = sniffImage(input);
  if (!format) throw new ImageProblem('Upload a PNG, JPEG or WebP image.');
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  let image: Awaited<ReturnType<typeof loadImage>>;
  try { image = await loadImage(input); } catch { throw new ImageProblem('That image could not be read. It may be damaged.'); }
  if (!image.width || !image.height || image.width * image.height > MAX_PIXELS) throw new ImageProblem('That image is too large to use. Choose one under 40 megapixels.');
  const orientation = format === 'jpeg' ? jpegOrientation(input) : 1;
  const swap = orientation >= 5;
  const w = swap ? image.height : image.width; const h = swap ? image.width : image.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale)); const height = Math.max(1, Math.round(h * scale));
  const canvas = createCanvas(width, height); const ctx = canvas.getContext('2d');
  // turn the picture upright, then scale it
  ctx.save(); ctx.scale(scale, scale);
  const transforms: Record<number, [number, number, number, number, number, number]> = { 2: [-1, 0, 0, 1, w, 0], 3: [-1, 0, 0, -1, w, h], 4: [1, 0, 0, -1, 0, h], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, w, 0], 7: [0, -1, -1, 0, w, h], 8: [0, -1, 1, 0, 0, h] };
  const t = transforms[orientation]; if (t) ctx.transform(...t);
  ctx.drawImage(image, 0, 0); ctx.restore();
  if (format === 'png') return { bytes: canvas.toBuffer('image/png'), mime: 'image/png', width, height };
  return { bytes: canvas.toBuffer('image/jpeg', 85), mime: 'image/jpeg', width, height };
}
