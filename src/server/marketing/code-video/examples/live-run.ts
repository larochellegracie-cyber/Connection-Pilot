/**
 * Runs Pilot's own creative path end to end with the REAL model, outside the app, so a request can be tried on any business's media folder:
 *
 *   OPENAI_API_KEY=... npx tsx src/server/marketing/code-video/examples/live-run.ts "<request>" <tenant id> <out dir> "<business name>" "<business type>" [#accent]
 *
 * request -> creative brief (style, platform, length) -> storyboard (the model's concept: scenes, camera, light, type, transitions) -> the model writes the video code
 * -> safety check -> layout and motion check -> design review -> render -> finished-video check -> (one bounded revision if it fails) -> the MP4 and the script.
 * It uses the same functions as the app (creative-brief, concept, renderCodeVideo); only the business's database record is replaced by the arguments.
 * The media folder is ./media (tenants/<id>/assets). Nothing here is specific to one business.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectCreativeRequest } from '@/lib/marketing-creative-mode.js';
import { extractBrief } from '../../creative-brief.js';
import { aiComplete, aiCompleteCode, aiCompleteWithImages, aiConfigured } from '../../service.js';
import { pickLogo } from '../../standard-video/business-assets.js';
import { reviewAssets } from '../../asset-vision.js';
import { getMediaStorage } from '../../standard-video/storage.js';
import { conceptPalette, conceptPlan, PROP_KINDS, writeConcept } from '../concept.js';
import { planVideo, type GenerateVisual } from '../plan.js';
import type { Idea } from '../idea.js';
import { availableMethods, producerOf } from '../production.js';
import { cutOutLogo } from '../logo-cutout.js';
import { checkTimelineVideo, renderTimelineVideo } from '../timeline.js';
import { checkClipVideo, renderClipVideo } from '../clip-video.js';
import { directionText, inferDirection, type Direction } from '../direction.js';
import { ensureGeneratedVisual, pictureInspector } from '../../generated-visual.js';
import { fingerprintOf, lookOf } from '../strategy.js';
import { heroKindFor, lookFor, renderCodeVideo } from '../index.js';

const [request, tenantId, outDir, businessNameArg = 'The business', businessTypeArg = 'Local business', accentArg = '#2F6BFF'] = process.argv.slice(2);
let businessName = businessNameArg; let businessType = businessTypeArg; let accent = accentArg;

/** The brand colours the model picked are checked against what the site really has: the main and action colours must be real colours (not near-white or grey), and the deep colour must be dark; anything else is replaced from the site's own named colours. */
const sanitizeBrand = (brand: { primary: string | null; secondary: string | null; accent: string | null }, found: string[]) => {
  const hexes = found.map((line) => ({ name: line.split(':')[0].toLowerCase(), hex: /#[0-9A-F]{6}/i.exec(line)?.[0]?.toUpperCase() ?? '' })).filter((c) => c.hex);
  const hsl = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const lt = (mx + mn) / 2; const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * lt - 1)); return { s, l: lt }; };
  const vivid = (h: string | null | undefined): h is string => !!h && hsl(h).s >= 0.3 && hsl(h).l >= 0.12 && hsl(h).l <= 0.85;
  const named = (re: RegExp) => hexes.find((c) => re.test(c.name) && vivid(c.hex))?.hex ?? null;
  const primary = vivid(brand.primary) ? brand.primary : named(/main|primary/) ?? hexes.find((c) => vivid(c.hex))?.hex ?? null;
  const accent = vivid(brand.accent) && brand.accent !== primary ? brand.accent : named(/accent|action|cta/) ?? primary;
  const namedDark = hexes.filter((c) => /brand|primary|secondary/.test(c.name) && hsl(c.hex).l < 0.3).map((c) => c.hex).sort((a, b) => hsl(a).l - hsl(b).l)[0]; // the site's own named dark brand colour comes before any dark colour that merely appears in its styles
  const darkest = namedDark ?? [brand.secondary, ...hexes.map((c) => c.hex)].filter((h): h is string => !!h).sort((a, b) => hsl(a).l - hsl(b).l)[0] ?? null;
  const secondary = darkest && hsl(darkest).l < 0.3 ? darkest : null;
  return { primary, accent, secondary };
};

/** WEBSITE_URL: the business is read from its own website (home page and a few linked pages), as Pilot's website knowledge would, and nothing else is told to Pilot. */
const readSite = async (url: string): Promise<{ text: string; colours: string[]; logoUrl: string | null }> => {
  const get = async (u: string) => fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20000) }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const strip = (html: string) => html.replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  const home = await get(url); const origin = new URL(url).origin;
  const links = [...new Set([...home.matchAll(/href="([^"#?]+)"/g)].map((m) => m[1]).filter((h) => h.startsWith('/') || h.startsWith(origin)).map((h) => (h.startsWith('/') ? origin + h : h)).filter((h) => !/\.(png|jpe?g|svg|css|js|ico|webp|pdf)$/i.test(h) && h.replace(/\/$/, '') !== origin))].slice(0, 4);
  const pages = await Promise.all(links.map(get));
  const sheets = await Promise.all([...new Set([...home.matchAll(/<link[^>]+href=\"([^\"]+\.css[^\"]*)\"/g)].map((m) => m[1]))].slice(0, 5).map((h) => get(h.startsWith('http') ? h : origin + (h.startsWith('/') ? h : `/${h}`))));
  const css = [home, ...sheets].join('\n').match(/#[0-9a-fA-F]{6}\b/g) ?? []; const count = new Map<string, number>(); for (const c of css) count.set(c.toUpperCase(), (count.get(c.toUpperCase()) ?? 0) + 1);
  const named = [...new Set([...[home, ...sheets].join('\n').matchAll(/--([\w-]*(?:primary|brand|accent|secondary)[\w-]*):\s*(#[0-9a-fA-F]{6})\b/gi)].map((m) => `${m[1]}: ${m[2].toUpperCase()}`))].slice(0, 10);
  const hslHex = (h: number, s: number, lt: number) => { const a = (s / 100) * Math.min(lt / 100, 1 - lt / 100); const f = (n: number) => { const k = (n + h / 30) % 12; const v = lt / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * v).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`.toUpperCase(); };
  const hslNamed = [...new Set([...[home, ...sheets].join('\n').matchAll(/--([\w-]*(?:primary|brand|accent|secondary)[\w-]*):\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/gi)].filter((m) => !/foreground|sidebar|chart/i.test(m[1])).map((m) => `${m[1]}: ${hslHex(Number(m[2]), Number(m[3]), Number(m[4]))}`))].slice(0, 6);
  const SOCIAL = new Set(['1877F2', '166FE5', '5865F2', '4752C4', '4285F4', 'DB4437', 'F4B400', '0F9D58', '1DA1F2', 'E4405F']);
  const sat = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  const logoMatch = [...home.matchAll(/<img[^>]*>/gi)].map((m) => m[0]).find((tag) => /logo/i.test(tag) && !/google|jobber|facebook|twitter|avatar/i.test(tag)); const logoSrc = logoMatch ? /src=\"([^\"]+)\"/.exec(logoMatch)?.[1] : undefined;
  const theme = /name="theme-color" content="(#[0-9a-fA-F]{6})"/.exec(home)?.[1];
  return { text: [`WEBSITE ${url}`, `TITLE: ${/<title>([^<]*)/i.exec(home)?.[1] ?? ''}`, `DESCRIPTION: ${/name="description" content="([^"]*)/i.exec(home)?.[1] ?? ''}`, strip(home).slice(0, 5000), ...pages.map((p, i) => `PAGE ${links[i]}: ${strip(p).slice(0, 1800)}`)].join('\n'), colours: [...hslNamed, ...named, ...(theme ? [`theme-color: ${theme.toUpperCase()}`] : []), ...[...count.entries()].filter(([c]) => sat(c) > 0.3 && !SOCIAL.has(c.slice(1))).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (used ${n} times)`)].slice(0, 12), logoUrl: logoSrc ? (logoSrc.startsWith('http') ? logoSrc : origin + (logoSrc.startsWith('/') ? logoSrc : `/${logoSrc}`)) : null };
};

const main = async () => {
  if (!request || !tenantId || !outDir) throw new Error('usage: live-run.ts "<request>" <tenant id> <out dir> "<business name>" "<business type>" [#accent]');
  if (!aiConfigured()) { console.error('No model is configured: set OPENAI_API_KEY (the same key Pilot chat uses) and run again.'); process.exit(2); }
  process.env.MARKETING_MEDIA_DIR ||= path.join(process.cwd(), 'media');
  // the owner's opt-in for generated pictures (about 1-2 cents each, at most two per video, no people or text in them)
  process.env.PILOT_REALISTIC_IMAGES = 'on'; process.env.PILOT_REALISTIC_IMAGES_PER_DAY ||= '20';
  const storage = getMediaStorage();
  const kit = { name: businessName, primary: '#0B3C5D', secondary: '#4CC9F0', accent, logoUrl: null } as never;
  const log = (stage: string, detail: unknown) => console.log(`\n[${stage}]`, typeof detail === 'string' ? detail : JSON.stringify(detail, null, 1));

  // 0. (only with WEBSITE_URL) Pilot reads the business and decides, itself, what the video is for: audience, selling point, objective, kind of video, format, length, pace, music, call to action
  let direction: Direction | null = null; let requestText = request; let siteLogoUrl: string | null = null; let siteText = '';
  if (process.env.WEBSITE_URL) {
    const site = await readSite(process.env.WEBSITE_URL);
    const said = await extractBrief({ message: request, detection: detectCreativeRequest(request), businessName, businessType, complete: aiComplete });
    direction = await inferDirection({ request, context: site.text, colours: site.colours, owner: { ...(said.brief.length_seconds ? { seconds: said.brief.length_seconds } : {}), ...(said.brief.style?.length ? { style: said.brief.style } : {}), ...(said.brief.key_instructions?.length ? { instructions: said.brief.key_instructions } : {}) } }, (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text));
    if (!direction) throw new Error('Pilot could not work out what this business needs from the website.');
    businessName = direction.business.name; businessType = direction.business.type; { const brand = sanitizeBrand(direction.brand, site.colours); const k = kit as { primary: string; secondary: string; accent: string };
      if (brand.primary) k.primary = brand.primary; if (brand.secondary) k.secondary = brand.secondary;
      const chosen = brand.accent ?? brand.primary; if (chosen) { accent = chosen; k.accent = chosen; }
      log('brand colours', { primary: k.primary, secondary: k.secondary, accent: k.accent, found: site.colours.slice(0, 10) }); siteLogoUrl = site.logoUrl; siteText = site.text; }
    requestText = `${request}\n\nDECIDED BY PILOT FROM THE BUSINESS (the owner gave no more than the line above)\n${directionText(direction)}`;
    log('inferred brief', direction); await writeFile(path.join(outDir, 'music-direction.json'), JSON.stringify(direction.music, null, 1)).catch(() => undefined);
  }

  // 1. Pilot understands the request
  const { brief: extracted, source } = await extractBrief({ message: request, detection: detectCreativeRequest(request), businessName, businessType, complete: aiComplete });
  const brief = direction ? { ...extracted, main_subject: direction.subject || extracted.main_subject, platform: direction.platform, length_seconds: direction.seconds, style: [] as string[], key_instructions: extracted.key_instructions } : extracted;
  log('brief', { source, subject: brief.main_subject, platform: brief.platform, style: brief.style, seconds: brief.length_seconds, instructions: brief.key_instructions });

  // 2. Pilot looks at the business's pictures once (shortlist, one contact sheet, the model says what each really shows), and decides the look
  const work = path.join(outDir, 'work'); await mkdir(work, { recursive: true });
  const assets = await storage.listAssets(tenantId);
  const review = await reviewAssets({ tenantId, request, subject: brief.main_subject, assets, storage, workDir: work, completeWithImages: aiCompleteWithImages });
  log('asset review', { source: review.source, considered: review.considered, reviewed: review.reviewed, hero: review.hero, note: review.note, assets: review.assets.map((fact) => ({ label: fact.label, provenance: fact.provenance, kind: fact.kind, shows: fact.shows, relevance: fact.relevance, quality: fact.quality, best_use: fact.best_use })) });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const facts = new Map(review.assets.map((fact) => [fact.id, fact]));
  const hero = review.hero ? { id: review.hero.id, label: review.hero.label } : null;
  const support = review.assets.filter((fact) => fact.id !== hero?.id && (fact.best_use === 'support' || fact.best_use === 'hero') && fact.relevance >= 5);
  const photos = [...(hero ? [hero] : []), ...support.map((fact) => ({ id: fact.id, label: fact.label }))].slice(0, 3).map((photo) => ({ ...photo, ...(facts.get(photo.id) ? { shows: facts.get(photo.id)!.shows, use: facts.get(photo.id)!.best_use } : {}) }));
  const assetFacts = Object.fromEntries(review.assets.map((fact) => [fact.id, { shows: fact.shows, kind: fact.kind, best_use: fact.best_use, ...(fact.focus ? { focus: fact.focus } : {}) }]));
  const look = lookFor({ message: request, hasHeroPhoto: !!hero, hasProp: !!heroKindFor(`${brief.main_subject} ${request}`) });
  log('look', { look, photos: photos.map((photo) => photo.label), unused: byId.size - photos.length });

  // 3. Pilot plans the video the way a director does: the creative strategy first (what kind of video this is and how it is built), then the storyboard from it. It is told the structures of
  //    videos recently made for this business, so a new one is not the same shape without a reason.
  const recentFile = path.join(path.dirname(path.resolve(outDir)), `recent-${tenantId}.json`);
  const recent: string[] = await readFile(recentFile, 'utf8').then((text) => JSON.parse(text) as string[]).catch(() => []);
  const pictures = review.assets.map((fact) => ({ id: fact.id, label: fact.label, provenance: fact.provenance, kind: fact.kind, shows: fact.shows, relevance: fact.relevance, quality: fact.quality, best_use: fact.best_use }));
  const planInput = { request: requestText, subject: brief.main_subject, seconds: brief.length_seconds ?? 15, business: { name: businessName, type: businessType, location: direction?.business.location ?? '', services: direction?.business.services ?? ([] as string[]), description: direction?.business.description ?? '', tone: direction?.business.tone ?? '' }, photos, ...(hero && look === 'photo' ? { heroPhoto: hero } : {}), props: PROP_KINDS, look, style: brief.style, platform: brief.platform, instructions: brief.key_instructions, pictures, recent };
  const generate: GenerateVisual = async (subject, look, style) => { const made = await ensureGeneratedVisual({ tenantId, subject, ...(look ? { look } : {}), ...(style ? { style } : {}), kit, business: { businessName, businessType, services: [] }, storage, inspect: pictureInspector(aiCompleteWithImages), complete: aiComplete }).catch(() => null); return made && made.kind === 'ai-image' ? { id: made.asset.id, label: made.asset.label, reused: made.reused } : null; };
  // IDEA_FILE (a saved idea, or a verbose run's ideas with IDEA_PICK=n) renders exactly the concept that was shown
  const pinned = process.env.IDEA_FILE ? await readFile(process.env.IDEA_FILE, 'utf8').then((t) => { const j = JSON.parse(t) as { ideas?: unknown[] } & Record<string, unknown>; return (j.ideas ? j.ideas[Number(process.env.IDEA_PICK ?? 1) - 1] : j) as Idea; }) : null;
  const plan = await planVideo(planInput, (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text), { generate, ...(availableMethods().includes('generated_clip') && !process.env.PILOT_NO_CLIPS ? { clips: true } : {}), ...(pinned ? { idea: pinned } : {}), ...(process.env.PLAN_STAGE === 'strategy' ? { stopAfter: 'strategy' as const } : {}) });
  if (plan.ideation) log('creative ideas', { chosen: plan.ideation.chosen?.title, rounds: plan.ideation.rounds, reason: plan.ideation.reason, notes: plan.ideation.notes, verdicts: plan.ideation.verdicts, ideas: plan.ideation.ideas.map((idea, i) => ({ n: i + 1, ...idea })) });
  if (plan.method && producerOf(plan.method) === 'timeline' && plan.ideation?.chosen) {
    // the drawn-motion methods: a timeline spec written from the idea, checked by plain code, drawn by the trusted timeline renderer (no model-written code)
    const idea = plan.ideation.chosen; log('production method', { method: plan.method, shots: idea.shots });
    if (process.env.PLAN_STAGE === 'strategy') { log('plan only', 'stopped after the idea'); return; }
    const tlOut = path.join(outDir, 'video.mp4'); const tlWork = path.join(outDir, 'timeline-work'); await mkdir(tlWork, { recursive: true });
    const logoAsset = pickLogo(assets, null); const logoBytes = logoAsset && logoAsset !== 'logo' ? await (await storage.openAsset(tenantId, logoAsset))?.read().catch(() => undefined) : siteLogoUrl ? await fetch(siteLogoUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? Buffer.from(b) : undefined)).catch(() => undefined) : undefined;
    const logoPng = logoBytes ? await cutOutLogo(logoBytes) : null; log('logo', logoPng ? `cut out cleanly (${logoPng.length} bytes)` : 'none found');
    const result = await renderTimelineVideo({ ...(logoPng ? { logoPng } : {}), tenantId, idea, method: plan.method, business: { name: businessName, type: businessType, description: direction?.business.description ?? '', services: direction?.business.services ?? [] }, kit, logoId: pickLogo(assets, null), storage, facts: `${requestText}\n${siteText}`, seconds: brief.length_seconds ?? 20, ...(direction ? { direction: directionText(direction) } : {}), complete: (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text), workDir: tlWork, outPath: tlOut });
    if (!result.ok) { log('result', `NOT MADE: ${result.reason}`); return; }
    const check = await checkTimelineVideo(result, aiCompleteWithImages);
    log('timeline', result.spec); log('result', { seconds: result.seconds, method: plan.method, notes: result.notes, plain_checks_left: result.issuesLeft, quality_check: check, files: [tlOut] });
    await writeFile(recentFile, JSON.stringify([...recent, `concept: ${idea.type} "${idea.title}" | ${plan.method}, ${idea.shots.length} shots | ${idea.visual_style} | pace ${idea.pacing} | cta: ${idea.cta}`].slice(-8), null, 1));
    return;
  }
  if (plan.method === 'generated_clip' && plan.ideation?.chosen) {
    // the clip method: footage made from the idea's own timed shots (no storyboard of stills, no code-drawn scenes)
    const idea = plan.ideation.chosen; log('production method', { method: idea.method, shots: idea.shots });
    if (process.env.PLAN_STAGE === 'strategy') { log('plan only', 'stopped after the idea: no clips were made'); return; }
    const clipOut = path.join(outDir, 'video.mp4'); const clipWork = path.join(outDir, 'clips'); await mkdir(clipWork, { recursive: true });
    const result = await renderClipVideo({ tenantId, idea, business: { name: businessName, type: businessType }, accent, pictures: pictures.map((p) => ({ id: p.id, label: p.label, ...(p.shows ? { shows: p.shows } : {}) })), storage, facts: requestText, generate: async (subject, look, style) => { const made = await generate(subject, look, style); return made ? { id: made.id, label: made.label } : null; }, complete: (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text), completeWithImages: aiCompleteWithImages, workDir: clipWork, outPath: clipOut });
    if (!result.ok) { log('result', `NOT MADE: ${result.reason}`); return; }
    const check = await checkClipVideo(result, aiCompleteWithImages);
    log('result', { seconds: result.seconds, credits: result.credits, method: 'generated_clip', shots: result.shots, notes: result.notes, quality_check: check, files: [clipOut] });
    await writeFile(recentFile, JSON.stringify([...recent, `concept: ${idea.type} "${idea.title}" | generated clips, ${result.shots.length} shots | ${idea.visual_style} | pace ${idea.pacing} | cta: ${idea.cta}`].slice(-8), null, 1));
    return;
  }
  if (plan.generated.length) log('generated for this video', plan.generated);
  log('plan notes', plan.notes);
  if (plan.strategy) log('creative strategy', { format: plan.strategy.format, visual_language: plan.strategy.visual_language, why: plan.strategy.why, hook: plan.strategy.hook, narrative: plan.strategy.narrative, beats: plan.strategy.beats.map((beat) => `${beat.purpose} (${Math.round(beat.share * 100)}%)`), visual: plan.strategy.visual, visual_notes: plan.strategy.visual_notes, pacing: plan.strategy.pacing, typography: plan.strategy.typography, colour_light: plan.strategy.colour_light, transitions: plan.strategy.transitions, cta: plan.strategy.cta, ending: plan.strategy.ending, brand: plan.strategy.brand, assets: plan.strategy.assets });
  if (process.env.PLAN_STAGE === 'strategy') { log('plan only', 'stopped after the creative idea and strategy: nothing generated or rendered'); return; }
  const strategy = plan.strategy;
  let concept = plan.concept;
  if (!concept) concept = await writeConcept({ ...planInput }, (system, prompt) => aiCompleteCode(system, prompt).then((reply) => reply.text));
  if (!concept) throw new Error('The storyboard could not be written.');
  for (const g of plan.generated) { const meta = await storage.getAssetMeta(tenantId, g.id).catch(() => null); if (meta) { byId.set(g.id, meta); assets.push(meta); } facts.set(g.id, { id: g.id, label: g.label, provenance: 'ai_image', kind: 'ai_image', shows: g.subject, relevance: 8, quality: 7, best_use: 'support', width: meta?.width ?? 1024, height: meta?.height ?? 1536 }); assetFacts[g.id] = { shows: g.subject, kind: 'ai_image', best_use: 'support' }; }
  const used = strategy ? strategy.assets.plan.filter((p) => p.role !== 'unused' && byId.has(p.id)).map((p) => ({ id: p.id, label: byId.get(p.id)!.label })) : photos;
  log('storyboard', { title: concept.title, mood: concept.mood, scenes: concept.scenes.length, seconds: concept.seconds, palette: concept.palette, list: concept.scenes.map((scene) => ({ role: scene.role, seconds: scene.seconds, headline: scene.headline, subtext: scene.subtext, visual: scene.visual, shot: scene.shot, transition: scene.transition, photo: scene.photoId })) });

  // PLAN_PAUSE=1: stop here (the storyboard and its visual plan are in the log) until /tmp/go-<tenant> exists, so the plan can be read before anything is rendered
  if (process.env.PLAN_PAUSE) { const go = `/tmp/go-${tenantId}`; log('waiting', `visual plan ready: create ${go} to render`); while (!(await readFile(go, 'utf8').then(() => true).catch(() => false))) await new Promise((r) => setTimeout(r, 5000)); }

  // 4. Pilot writes the code, it is checked, rendered, inspected and (once) revised
  const out = path.join(work, 'video.mp4');
  const result = await renderCodeVideo({ tenantId, plan: conceptPlan(concept, kit, used, direction?.format === 'landscape' ? '1920x1080' : direction?.format === 'square' ? '1080x1080' : '1080x1920'), kit, logoId: pickLogo(assets, null), storage, workDir: work, outPath: out, complete: aiCompleteCode, completeWithImages: aiCompleteWithImages, style: 'custom', look: strategy ? lookOf(strategy) : look, subject: brief.main_subject, palette: conceptPalette(concept), assetFacts, ...(strategy ? { strategy, ...(brief.platform ? { platform: brief.platform } : {}), recent } : hero && look === 'photo' ? { heroPhoto: hero } : {}) });
  if (!result.ok) { log('result', `NOT MADE (the app would use its standard video): ${result.reason}`); log('trace', result.trace ?? []); if (result.usage) log('usage', result.usage); if (result.script) await writeFile(path.join(outDir, 'refused-script.py'), result.script); process.exit(1); }
  await copyFile(out, path.join(outDir, 'video.mp4')); await writeFile(path.join(outDir, 'script.py'), result.script);
  const measured = (result.measured ?? []) as Array<{ scene: number; seconds: number; transition: string; text?: { align: string; row: number; size: number; width: number } | null; scrim?: number; cams?: Array<{ move: string; zoom: number; at: boolean }>; assets?: string[] }>;
  const rows = ['top', 'middle', 'bottom'];
  const table = concept.scenes.map((scene, i) => { const shot = scene.shot; const m = measured[i]; const fid = result.fidelity?.scenes.find((f) => f.scene === i + 1);
    return { scene: i + 1, storyboard: shot ? [shot.composition, `text ${shot.text ?? '-'}${shot.text_position ? ` @ ${shot.text_position}` : ''}${shot.text_scale ? ` ${shot.text_scale}` : ''}`, `camera ${shot.camera ?? '-'} ${shot.crop ?? ''}`.trim(), `scrim ${shot.scrim ?? '-'}`, `${scene.seconds}s -> ${scene.transition ?? 'fade'}`].join(' | ') : '(no shot)',
      rendered: m ? [m.text ? `text ${m.text.align} ${rows[m.text.row]} size ${m.text.size} (${Math.round(m.text.width * 100)}% wide)` : 'no text', `camera ${(m.cams ?? []).map((c) => `${c.move} x${c.zoom}${c.at ? ' aimed' : ''}`).join(', ') || 'none'}`, `scrim ${m.scrim ?? 0}`, `pictures ${(m.assets ?? []).join(',') || 'none'}`, `${m.seconds}s -> ${m.transition}`].join(' | ') : '(not measured)',
      fidelity: fid ? `${fid.score}/10${fid.cause !== 'none' ? ` (${fid.cause}): ${fid.note}` : ''}` : '-' }; });
  log('storyboard vs rendered', table);
  log('result', { seconds: result.seconds, design_score: result.score, fidelity_overall: result.fidelity?.overall ?? null, usage: result.usage, finished_video_check: result.quality, files: [path.join(outDir, 'video.mp4'), path.join(outDir, 'script.py')] });
  log('trace', (result as unknown as { trace?: string[] }).trace ?? []);
  if (result.creative) log('creative review', { overall: result.creative.overall, scores: result.creative.scores.map((c) => `${c.aspect} ${c.score}${c.score < 7 ? `: ${c.note}` : ''}`) });
  if (result.unreviewed) log('note', 'the accepted version could not be reviewed (its design score is the default for "not reviewed")');
  const fingerprint = fingerprintOf(strategy, concept); log('structure fingerprint', fingerprint);
  await writeFile(recentFile, JSON.stringify([...recent, fingerprint].slice(-8), null, 1));
};
main().catch((error) => { console.error(error); process.exit(1); });
