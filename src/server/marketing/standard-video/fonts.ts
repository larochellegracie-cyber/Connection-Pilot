import * as nodeModule from 'node:module';
import path from 'node:path';

let registered = false;
export const FONT_FAMILY = 'Inter';

/** Registers the bundled Inter font once, so text looks the same on any server. Falls back to a system font if it cannot. */
export async function ensureFonts(): Promise<void> {
  if (registered) return;
  const { GlobalFonts } = await import('@napi-rs/canvas');
  const require = nodeModule.createRequire(path.join(process.cwd(), 'package.json'));
  for (const weight of [400, 700, 800]) {
    try { GlobalFonts.registerFromPath(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`), FONT_FAMILY); } catch { /* the system sans-serif is used instead */ }
  }
  registered = true;
}
