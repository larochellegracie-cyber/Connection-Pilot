import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { RUNTIME_DIR, codeVideoSupport } from '../code-video/sandbox.js';
import { heroKindFor } from '../code-video/index.js';

/**
 * The drawn-product fallback: when the business has no photo of what was asked for and no realistic picture is available, the product is drawn with the same
 * ready-made illustrations the videos use (a cake, a cupcake, a coffee, a gift, a house, a tree), on a transparent background, to be placed on the design in the
 * reference's own colours and light. It is an illustration, never a photo of the business's real work, and the owner is always told so. Subjects with no
 * ready-made illustration (a pizza, a haircut) are not drawn: the design stays type-led rather than showing the wrong thing.
 */
const run = promisify(execFile);
export const drawableKind = (subject: string): string | null => heroKindFor(subject);

/** What the drawing is and how good it is, said plainly, for the owner. */
export const DRAWN_NOTE = (kind: string) => `I drew a ${kind} for you because you have no photo of it. It’s a simple illustration, clearly less realistic and less appetising than a real photo of your own work, so treat it as a stand-in.`;

export async function drawProduct({ kind, tint }: { kind: string; tint?: string }): Promise<Buffer | null> {
  const support = await codeVideoSupport(); if (!support.python) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pilot-still-'));
  try {
    const out = path.join(dir, 'prop.png');
    const { stdout } = await run(support.python, ['-I', path.join(RUNTIME_DIR, 'pilot_still.py'), kind, out, ...(tint && /^#[0-9a-f]{6}$/i.test(tint) ? [tint] : [])], { timeout: 120_000, env: {} });
    if (!JSON.parse(stdout.trim().split('\n').pop() ?? '{}').ok) return null;
    return await readFile(out);
  } catch { return null; } finally { await rm(dir, { recursive: true, force: true }); }
}
