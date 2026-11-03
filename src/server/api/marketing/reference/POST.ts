import type { Request, Response } from 'express';
import multer from 'multer';
import { getTenant } from '@/server/api/customers/tenant.js';
import { aiConfigured, aiCompleteWithImages } from '@/server/marketing/service.js';
import { analyseReference, MAX_REFERENCE_BYTES, ReferenceProblem, summarise } from '@/server/marketing/reference/index.js';
import { analyseReferenceImage, looksLikeImage, summariseDesign } from '@/server/marketing/reference-image/index.js';

const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_REFERENCE_BYTES, files: 1 } }).single('video');

/**
 * POST /api/marketing/reference (multipart, one file named "video")
 * Reads a reference video the owner uploaded (an MP4 or MOV up to 80 MB and 2 minutes) and returns what Pilot learned about its style (pace, scenes, look,
 * text and motion) and an id. Send that id with the next request ("Make a video like this for us") and the new video follows the reference. The uploaded
 * video itself is deleted as soon as it has been read; only its measured structure and a description of its style are kept.
 */
export default async function handler(req: Request, res: Response) {
  try {
    const tenant = await getTenant(req, res); if (!tenant) return;
    if (!aiConfigured()) return void res.status(503).json({ error: 'Pilot isn’t ready to create things yet. Please contact support.', setupRequired: true });
    await new Promise<void>((resolve, reject) => receive(req, res, (error?: unknown) => (error ? reject(error) : resolve())));
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) return void res.status(400).json({ error: 'Choose a video to upload.' });
    // a picture is a design reference for a post; a video is a style reference for a video
    if (looksLikeImage(file.buffer)) {
      const design = await analyseReferenceImage({ tenantId: tenant.id, bytes: file.buffer, fileName: file.originalname || 'reference image', model: (system, prompt, images) => aiCompleteWithImages(system, prompt, images) });
      return void res.status(201).json({ reference: { kind: 'image', id: design.id, fileName: design.fileName, summary: summariseDesign(design), aspect: design.measures.aspectRatio, mood: design.style.mood, theme: design.style.blueprint.tone, understoodBy: design.style.source } });
    }
    const analysis = await analyseReference({ tenantId: tenant.id, bytes: file.buffer, fileName: file.originalname || 'reference video', model: (system, prompt, images) => aiCompleteWithImages(system, prompt, images) });
    res.status(201).json({ reference: { kind: 'video', id: analysis.id, fileName: analysis.fileName, summary: summarise(analysis), seconds: analysis.measures.seconds, scenes: analysis.measures.segments.length, pacing: analysis.pacing, theme: analysis.style.theme, understoodBy: analysis.style.source } });
  } catch (error) {
    if (error instanceof ReferenceProblem) return void res.status(422).json({ error: error.publicMessage });
    if ((error as { code?: string })?.code === 'LIMIT_FILE_SIZE') return void res.status(413).json({ error: 'That video is larger than 80 MB. Please upload a shorter or smaller one.' });
    console.error('reference video failed', error instanceof Error ? error.name : 'unknown');
    res.status(502).json({ error: 'Pilot couldn’t read that video just now. Please try again.' });
  }
}
