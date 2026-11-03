import { readdir, rm, stat, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getMediaStorage, isSafeId } from '../standard-video/storage.js';

/**
 * What the video and image reference systems share: a plain-words error, and where a business's reference analyses are kept (small JSON files in its own
 * folder; the uploaded picture or video itself is deleted as soon as it has been read, and only measurements and a description of its design are kept).
 */
export type ReferenceKind = 'video' | 'image';
export class ReferenceProblem extends Error { constructor(public readonly publicMessage: string) { super(publicMessage); } }

const KEEP = 10;
export function referenceDir(tenantId: string): string {
  if (!isSafeId(tenantId)) throw new Error('That business id is not valid.');
  return path.join(getMediaStorage().describe().location, 'tenants', tenantId, 'references');
}
export function referenceFile(tenantId: string, id: string, kind: ReferenceKind = 'video'): string {
  if (!isSafeId(id)) throw new Error('That reference id is not valid.');
  return path.join(referenceDir(tenantId), kind === 'image' ? `image-${id}.json` : `${id}.json`);
}
export async function saveJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.partial`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${file}.partial`, file);
}
/** Keeps only the newest ten analyses of each kind (the design session file is never removed here). */
export async function pruneReferences(tenantId: string, kind: ReferenceKind): Promise<void> {
  const dir = referenceDir(tenantId);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.json') && !name.startsWith('design-') && name.startsWith('image-') === (kind === 'image'));
  const dated = await Promise.all(files.map(async (name) => ({ name, time: (await stat(path.join(dir, name))).mtimeMs })));
  for (const old of dated.sort((a, b) => b.time - a.time).slice(KEEP)) await rm(path.join(dir, old.name), { force: true });
}
