import type { VideoProvider } from '../providers.js';
import { loadBrandKit } from '../store.js';
import { loadAssets } from './assets.js';
import { pickLogo } from './business-assets.js';
import { ffmpegAvailable } from './ffmpeg.js';
import { getStandardTask, startStandardRender, StandardVideoError } from './jobs.js';
import { assetsNeeded, validateSpec } from './spec.js';
import { getMediaStorage } from './storage.js';
import { specFromConcept } from './templates.js';

/**
 * Standard Video: designed motion graphics (your brand colours, logo, text, photos, shapes, animation and transitions) drawn
 * on this server and encoded with FFmpeg. It never calls a paid video-generation service, so there is no per-video fee.
 * If the video has a scene plan (made by Pilot's planner) that exact plan is rendered; otherwise a plan is built from the
 * video concept's scenes.
 */
export const standardProvider: VideoProvider = {
  id: 'standard',
  label: 'Standard Video',
  mode: 'standard',
  isConfigured: ffmpegAvailable,
  async start(concept, item, context) {
    const storage = getMediaStorage();
    const kit = await loadBrandKit(context.tenantId);
    let spec;
    if (concept.plan) {
      const checked = validateSpec(concept.plan);
      if (!checked.ok) throw new StandardVideoError(`This video's scene plan is not valid: ${checked.error}`);
      spec = checked.spec;
    } else {
      const logoId = pickLogo(await storage.listAssets(context.tenantId), kit.logoUrl);
      const { assets } = await loadAssets({ ids: logoId ? [logoId] : [], tenantId: context.tenantId, storage, logoUrl: kit.logoUrl });
      spec = specFromConcept({ concept, item, kit, hasLogo: logoId && assets.has(logoId) ? logoId : false });
    }
    const { assets, missing } = await loadAssets({ ids: assetsNeeded(spec), tenantId: context.tenantId, storage, logoUrl: kit.logoUrl });
    if (missing.length) {
      if (missing.every((id) => id === spec.brand.logo)) { delete spec.brand.logo; } // a logo that cannot be loaded is simply left out
      else throw new StandardVideoError('A picture this video uses is no longer available (it may have been deleted). Plan the video again.');
    }
    const { taskId } = await startStandardRender({ tenantId: context.tenantId, spec, assets, storage });
    const { persistent } = storage.describe();
    return { taskId, estimatedCredits: null, note: `Standard Video is a designed motion graphic made on Connection Pilot’s own servers with your brand, text and pictures. It is not AI-generated footage and has no per-video fee. It is silent: add sound in the platform’s own app.${persistent ? '' : ' Video storage is temporary right now, so finished videos will be lost when the server restarts.'}` };
  },
  retrieve: (taskId, context) => getStandardTask({ tenantId: context.tenantId, taskId }),
  describeError: (error) => (error instanceof StandardVideoError ? error.publicMessage : error instanceof Error && /FFmpeg/.test(error.message) ? 'The video encoder is not available on this server.' : 'Standard Video could not start. Please try again.'),
};
