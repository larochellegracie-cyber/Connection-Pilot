/**
 * Makes a set of realistic pictures for a business with Pilot's own image generator (the same one the app uses when a business has no photo of what it needs), and keeps them in
 * that business's media folder, so a different business can be tried end to end:
 *
 *   npx tsx src/server/marketing/code-video/examples/make-assets.ts <tenant id> "<business name>" "<business type>" "<services, comma separated>" "<subject 1>" "<subject 2>" ...
 *
 * Costs about 1-2 US cents per picture (OpenAI's image model, the same key Pilot writes with). The pictures follow the generator's own rules: no people, text, logos or prices.
 */
import path from 'node:path';
import { aiComplete } from '../../service.js';
import { ensureGeneratedVisual } from '../../generated-visual.js';
import { getMediaStorage } from '../../standard-video/storage.js';

const [tenantId, businessName, businessType, services, ...subjects] = process.argv.slice(2);
(async () => {
  if (!tenantId || !businessName || !businessType || !subjects.length) throw new Error('usage: make-assets.ts <tenant id> "<business name>" "<business type>" "<services>" "<subject>"...');
  process.env.PILOT_REALISTIC_IMAGES = 'on'; process.env.PILOT_REALISTIC_IMAGES_PER_DAY ||= '20'; process.env.MARKETING_MEDIA_DIR ||= path.join(process.cwd(), 'media');
  const storage = getMediaStorage();
  const kit = { name: businessName, primary: '#6B2D3C', secondary: '#F2C6A0', accent: '#D9486A', logoUrl: null };
  for (const subject of subjects) {
    const made = await ensureGeneratedVisual({ tenantId, subject, kit, business: { businessName, businessType, services: services.split(',').map((item) => item.trim()).filter(Boolean) }, storage, complete: aiComplete });
    console.log(made ? `${made.kind}${made.reused ? ' (reused)' : ''}: ${made.asset.id}  ${made.asset.label}${made.fallbackReason ? `  [${made.fallbackReason}]` : ''}` : `NOT MADE: ${subject}`);
  }
})().catch((error) => { console.error(error); process.exit(1); });
