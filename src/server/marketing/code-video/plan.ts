import { producerOf, type MethodId } from './production.js';
import { applySources, sourceScenes, visualPlan } from './scene-sourcing.js';
import { ideate, type Idea, type Ideation } from './idea.js';
import { refitSeconds, writeConcept, type Concept, type ConceptInput } from './concept.js';
import { isInterfacePicture, showsPeople, conceptIssues, dropPictureCaptions, dropEmptyScenes, dropUnsupportedClaims, reviewClaims, wantsPeople, writeStrategy, type Strategy, type StrategyInput } from './strategy.js';

/**
 * Planning a video, in the order a director works:
 *   1. the CREATIVE STRATEGY (what kind of video this is and how it is built: format, hook, beats, visual approach, pace, pictures, typography, transitions, ending),
 *   2. the PICTURES the strategy asked for that the business does not have are MADE (generated), before any scene exists, so the storyboard can use them,
 *   3. the STORYBOARD made from the strategy and every picture there is (scenes, their lengths, and each scene's shot),
 *   4. one correction if the storyboard breaks its own strategy (a picture used more than planned, a pace that is not the pace chosen, a visual approach the scenes do not follow, the same
 *      treatment three scenes running).
 * Nothing here chooses a structure: the model does. If it cannot make a strategy the storyboard is planned the older way (without one), so a video is still made.
 */
export type PlanInput = ConceptInput & { pictures: StrategyInput['pictures']; recent?: string[] };
export type GeneratedPicture = { id: string; label: string; subject: string; role: string };
export type Plan = { /** how the chosen idea is to be made (see production.ts) */ method?: MethodId; strategy: Strategy | null; concept: Concept | null; /** the pictures that were made for this video because the strategy asked for them */ generated: GeneratedPicture[]; /** the creative ideas that were proposed, judged against what was made recently, and the one chosen */ ideation: Ideation | null; /** what happened, for the developer's logs */ notes: string[] };
type Complete = (system: string, prompt: string) => Promise<string>;
/** Makes ONE picture from a description of what it shows. Returns null when it cannot (switched off, daily limit, an error): it must only ever return a real generated picture, never a stand-in. */
export type GenerateVisual = (subject: string, look?: string, style?: string) => Promise<{ id: string; label: string; /** true when an earlier Pilot-made picture was reused instead of making a new one */ reused?: boolean } | null>;

export async function planVideo(input: PlanInput, complete: Complete, tools: { generate?: GenerateVisual; /** stop once the strategy is made (to look at the creative concept before anything is generated or drawn) */ stopAfter?: 'strategy'; /** image-to-video is available: an idea whose method is generated_clip is returned for the clip producer instead of being storyboarded */ clips?: boolean; /** an idea that was already chosen and shown: used instead of proposing new ones */ idea?: Idea } = {}): Promise<Plan> {
  const notes: string[] = []; const generated: GeneratedPicture[] = [];
  if (input.reference) return { strategy: null, concept: await writeConcept(input, complete).catch(() => null), generated, ideation: null, notes: ['planned from the reference video'] };
  // the creative IDEA comes first: what the film is and how it unfolds, judged against what was made recently; how it looks and is rendered follows from it
  // an idea the owner (or a developer) already saw and approved is used as it is: it is not proposed again
  const ideation = tools.idea ? ({ ideas: [tools.idea], chosen: tools.idea, verdicts: [], reason: 'the approved idea was used as it was', rounds: 0, notes: [] } as Ideation) : await ideate({ request: input.request, subject: input.subject, seconds: input.seconds, ...(input.platform ? { platform: input.platform } : {}), ...(input.style ? { style: input.style } : {}), ...(input.instructions ? { instructions: input.instructions } : {}), business: input.business, ...(input.recent ? { recent: input.recent } : {}), pictures: input.pictures.filter((p) => p.kind !== 'logo' && p.kind !== 'abstract').map((p) => `${p.label}${p.shows ? `: ${p.shows}` : ''} (${p.provenance ?? 'picture'})`) }, complete).catch(() => null);
  if (ideation?.chosen) notes.push(`creative idea: ${ideation.chosen.type} "${ideation.chosen.title}" (${ideation.ideas.length} ideas, ${ideation.rounds} round${ideation.rounds === 1 ? '' : 's'}) ${ideation.notes.join('; ')}`.trim());
  // the idea decides how the video is made: real motion clips are produced from the idea's own timed shots, with no storyboard of stills
  if (ideation?.chosen && ideation.chosen.shots.length >= 2) { const method = ideation.chosen.method; const producer = producerOf(method); if (producer === 'timeline' || (producer === 'clips' && tools.clips)) { notes.push(`production method: ${method} (${ideation.chosen.shots.length} shots, ${producer})`); return { method, strategy: null, concept: null, generated, ideation, notes }; } }
  const strategy = await writeStrategy({ ...(ideation?.chosen ? { idea: ideation.chosen } : {}), request: input.request, subject: input.subject, seconds: input.seconds, ...(input.platform ? { platform: input.platform } : {}), ...(input.style ? { style: input.style } : {}), ...(input.instructions ? { instructions: input.instructions } : {}), business: input.business, pictures: input.pictures, generation: { available: !!tools.generate, max: 3 }, ...(input.recent ? { recent: input.recent } : {}) }, complete).catch(() => null);
  if (!strategy) { notes.push('no creative strategy could be made: the storyboard was planned without one'); return { strategy: null, concept: await writeConcept(input, complete).catch(() => null), generated, ideation, notes }; }
  if (ideation?.chosen) { const { type, title, logline, story, hook, payoff, cta, visual_style } = ideation.chosen; strategy.idea = { type, title, logline, story, hook, payoff, cta, visual_style }; }
  if (tools.stopAfter === 'strategy') return { strategy, concept: null, generated, ideation, notes };
  notes.push(`strategy: ${strategy.format} | ${strategy.visual}, pace ${strategy.pacing}, ${strategy.beats.length} beats | pictures ${strategy.assets.coverage}`);

  // the pictures the strategy asked for are made now, and join the picture list and the asset plan like any other
  const pictures = [...input.pictures];
  const requests = strategy.assets.generate;
  if (requests.length && !tools.generate) notes.push(`the strategy asked for ${requests.length} generated picture(s) but picture generation is not available here: graphics and type carry those moments`);
  for (const request of tools.generate ? requests : []) {
    if (isInterfacePicture(request.subject)) { notes.push(`not generated (a screen cannot hold readable text, so it is drawn in code): "${request.subject.slice(0, 80)}"`); continue; }
    if (!wantsPeople(input.request) && showsPeople(request.subject)) { notes.push(`not generated (it would show a person): "${request.subject.slice(0, 80)}"`); continue; }
    const made = await tools.generate!(request.subject, [strategy.idea?.visual_style, strategy.colour_light, strategy.format, strategy.visual_notes].filter(Boolean).join('; ').slice(0, 260), [request.style, strategy.assets.art].filter(Boolean).join('; ').slice(0, 200)).catch(() => null);
    if (!made) { notes.push(`could not generate: "${request.subject.slice(0, 80)}" (switched off, over the daily limit, or it failed): graphics and type carry that moment`); continue; }
    generated.push({ id: made.id, label: made.label, subject: request.subject, role: request.role });
    pictures.push({ id: made.id, label: made.label, provenance: made.reused ? 'ai_image' : 'generated_now', kind: 'ai_image', shows: request.subject, relevance: 8, quality: 7, best_use: request.role === 'hero' ? 'hero' : 'support' });
    strategy.assets.plan.push({ id: made.id, role: request.role, max_uses: request.role === 'hero' ? 3 : 2, why: request.why || 'generated for this video because the existing pictures were not enough' });
    notes.push(`${made.reused ? 'reused an earlier Pilot picture' : 'generated'}: "${request.subject.slice(0, 80)}" as ${request.role} (${made.id.slice(0, 8)})`);
  }

  // the pictures the storyboard may use are the ones the strategy gave a role
  const byId = new Map(pictures.map((p) => [p.id, p]));
  const planned = strategy.assets.plan.filter((p) => p.role !== 'unused' && byId.has(p.id)).map((p) => ({ id: p.id, label: byId.get(p.id)!.label, ...(byId.get(p.id)!.shows ? { shows: byId.get(p.id)!.shows } : {}), use: p.role }));
  const photos = planned.length ? planned : pictures.filter((p) => (p.best_use === 'hero' || p.best_use === 'support') && (p.relevance ?? 0) >= 5).slice(0, 4).map((p) => ({ id: p.id, label: p.label, ...(p.shows ? { shows: p.shows } : {}), use: p.best_use ?? 'support' }));
  const base: ConceptInput = { ...input, strategy, photos };
  let concept = await writeConcept(base, complete).catch(() => null);
  if (!concept) { notes.push('the storyboard could not be written from the strategy'); return { strategy, concept: null, generated, ideation, notes }; }
  const facts = [input.request, input.subject, ...(input.instructions ?? []), input.business.name, input.business.type, input.business.location, input.business.description, input.business.tone, ...input.business.services].filter(Boolean).join(' . ');
  // the model reads every line against the business facts (the word list in conceptIssues is only a quick net under it)
  const claimIssues = async (c: Concept) => { const found = await reviewClaims(c, facts, complete); return { found, issues: found.map((f) => `Scene ${f.scene} says "${f.line}": ${f.why}. Say only what the request and the business's own information support.`) }; };
  let claims = await claimIssues(concept);
  let issues = [...conceptIssues(concept, strategy, facts), ...claims.issues];
  if (issues.length) {
    notes.push(`storyboard broke its strategy (${issues.length}): ${issues.map((issue) => issue.slice(0, 110)).join(' | ')}`);
    const again = await writeConcept({ ...base, feedback: issues }, complete).catch(() => null);
    const claimsAgain = again ? await claimIssues(again) : claims; const left = again ? [...conceptIssues(again, strategy, facts), ...claimsAgain.issues] : issues; if (again && left.length <= issues.length) claims = claimsAgain;
    if (again && left.length <= issues.length) { concept = again; issues = left; }
    notes.push(issues.length ? `after one correction ${issues.length} difference(s) remain: ${issues.map((issue) => issue.slice(0, 110)).join(' | ')}` : 'one correction fixed it');
  }
  const captions = dropPictureCaptions(concept); if (captions) notes.push(`removed ${captions} line(s) of on-screen words that only described the picture`);
  // every scene must be a visual action: a scene whose action needs something its picture does not show gets a picture of that moment (the toolkit cannot draw a wrench or a map)
  const shows = new Map(pictures.map((p) => [p.id, p.shows || p.label])); let sources = await sourceScenes(concept, strategy, shows, complete).catch(() => []);
  if (sources.length) {
    const added = await applySources(concept, strategy, sources, { request: input.request, room: Math.max(0, 8 - generated.length), ...(tools.generate ? { generate: tools.generate } : {}) });
    for (const g of added.made) {
      generated.push({ id: g.id, label: g.label, subject: g.subject, role: 'scene' }); shows.set(g.id, g.subject);
      pictures.push({ id: g.id, label: g.label, provenance: 'generated_now', kind: 'ai_image', shows: g.subject, relevance: 8, quality: 7, best_use: 'support' });
    }
    const uses = new Map<string, number>(); for (const s of concept.scenes) if (s.photoId) uses.set(s.photoId, (uses.get(s.photoId) ?? 0) + 1);
    for (const [id, count] of uses) { const entry = strategy.assets.plan.find((e) => e.id === id); if (entry) entry.max_uses = Math.max(entry.max_uses, count); else if (shows.has(id)) strategy.assets.plan.push({ id, role: 'support', max_uses: count, why: 'made for the scene that shows it' }); }
    notes.push(...added.notes);
  }
  const plan = visualPlan(concept, shows, sources); notes.push(`visual plan:\n${plan.join('\n')}`);
  const empty = dropEmptyScenes(concept); if (empty) notes.push(`removed ${empty} scene(s) that showed nothing (no picture, no words); their time went to the scenes beside them`);
  const dropped = dropUnsupportedClaims(concept, facts, claims.found); if (dropped) notes.push(`removed ${dropped} line(s) that claimed something the business never said`);
  // with no picture on any scene (a software video drawn entirely in code) the strategy is graphic-led, not mixed: the checks must not demand a picture that does not exist
  if (!concept.scenes.some((scene) => scene.photoId) && strategy.visual !== 'graphic_led') { notes.push(`no scene uses a picture, so the visual strategy changed from ${strategy.visual} to graphic_led`); strategy.visual = 'graphic_led'; }
  refitSeconds(concept, Math.max(6, Math.min(60, input.seconds)));
  return { strategy, concept, generated, ideation, notes };
}
