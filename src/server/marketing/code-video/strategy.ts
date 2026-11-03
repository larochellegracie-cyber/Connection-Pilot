import { ideaText, type Idea } from './idea.js';
import type { Concept } from './concept.js';

/**
 * The creative strategy: the high-level decision, made BEFORE any scene exists, about what kind of video this should be and how it is built. The model makes it (nothing here chooses a
 * template); the code only cleans it and measures a storyboard against it. It is authoritative: the storyboard is this strategy made concrete, the code writer executes the storyboard,
 * and the checks that apply to the script follow the strategy's visual approach, so the three always agree.
 *
 * What is fixed is a small vocabulary where a machine has to read a decision (the visual approach, the pace, how the brand appears, each picture's role) and free words everywhere the
 * creativity is: the format, the hook, the narrative, the typography, the light, the transitions, the call to action and the ending.
 */
export const VISUALS = ['photo_led', 'graphic_led', 'mixed', 'typographic'] as const;
export const PACINGS = ['slow', 'measured', 'brisk', 'rapid'] as const;
export const BRANDS = ['end_card', 'corner_mark', 'both'] as const;
export const FACES = ['sans', 'serif', 'serif_italic_accent'] as const;
export const ROLES = ['hero', 'macro', 'support', 'background', 'transition', 'end_visual', 'unused'] as const;
export const COVERAGES = ['sufficient', 'thin', 'insufficient'] as const;
type OneOf<T extends readonly string[]> = T[number];

export type PictureRole = { id: string; role: OneOf<typeof ROLES>; /** how many scenes it may appear in */ max_uses: number; why: string };
export type Strategy = {
  /** the creative idea this strategy delivers (set when the strategy is made from one) */ idea?: Pick<Idea, 'type' | 'title' | 'logline' | 'story' | 'hook' | 'payoff' | 'cta' | 'visual_style'>;
  /** what kind of video this is, in a few words (free: "fast product reveal", "problem to solution explainer", "cinematic service film"...) */ format: string;
  /** why that shape suits this request, business and platform */ why: string;
  hook: string; narrative: string;
  /** the story as ordered beats, each with its share of the total time (a beat may become one scene or several quick cuts) */ beats: Array<{ purpose: string; share: number; /** what is on screen in this beat (free: a wide hero, a macro, a graphic counter, type only...) */ shows: string }>;
  visual: OneOf<typeof VISUALS>; visual_notes: string; /** the visual language of the WHOLE video (free: stylised 3D animation with warm light, dark cinematic realism, flat bold illustration, a mix...), chosen for this business, request and audience */ visual_language: string; pacing: OneOf<typeof PACINGS>;
  typography: { face: OneOf<typeof FACES>; treatment: string };
  colour_light: string; transitions: string; cta: string; ending: string; brand: OneOf<typeof BRANDS>;
  assets: { coverage: OneOf<typeof COVERAGES>; /** how many DIFFERENT photographs the strategy needs on screen (0 when graphics or type carry it) */ needed: number; plan: PictureRole[]; /** pictures to make because the ones that exist are not enough: what each shows and the role it will have (they are generated before the storyboard, so scenes can use them) */ generate: Array<{ subject: string; role: OneOf<typeof ROLES>; why: string; /** the visual treatment of this picture (free: cinematic photograph, glossy 3D render, flat illustration...), empty = follow `art` */ style: string }>; /** the one visual world the generated pictures share, so they look like parts of the same advertisement */ art: string; note: string };
};

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pick = <T extends readonly string[]>(value: unknown, list: T, fallback: T[number]): T[number] => (typeof value === 'string' && (list as readonly string[]).includes(value.trim().toLowerCase()) ? (value.trim().toLowerCase() as T[number]) : fallback);

/**
 * What a picture is allowed to be, whatever the model asked for: a logo is branding (an end card) or unused, never a scene's subject; abstract art or a drawn graphic is a background or
 * unused, never a photograph of the real thing. Real and AI pictures can have any role.
 */
export function roleFor(kind: string | undefined, asked: OneOf<typeof ROLES>): OneOf<typeof ROLES> {
  if (kind === 'logo') return asked === 'end_visual' ? 'end_visual' : 'unused';
  if (kind === 'abstract' || kind === 'graphic') return asked === 'background' || asked === 'transition' ? asked : 'background';
  return asked;
}

/** The model's strategy, cleaned. Returns null when it is not usable (no beats, or no visual approach said). Picture ids that were not offered are dropped. */
export function cleanStrategy(raw: unknown, pictureIds: readonly string[], kinds: Readonly<Record<string, string>> = {}): Strategy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const beats = (Array.isArray(r.beats) ? r.beats : []).slice(0, 14).flatMap((entry): Array<{ purpose: string; share: number; shows: string }> => { const b = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>; const purpose = text(b.purpose, 120); const share = Number(b.share); return purpose ? [{ purpose, share: Number.isFinite(share) && share > 0 ? Math.min(1, share) : 0, shows: text(b.shows, 80) }] : []; });
  if (beats.length < 1 || !text(r.format, 80) || !(VISUALS as readonly string[]).includes(String(r.visual).trim().toLowerCase())) return null;
  const sum = beats.reduce((s, b) => s + b.share, 0); for (const beat of beats) beat.share = Math.round((sum > 0 && beat.share > 0 ? beat.share / sum : 1 / beats.length) * 1000) / 1000;
  const a = (r.assets && typeof r.assets === 'object' ? r.assets : {}) as Record<string, unknown>; const known = new Set(pictureIds);
  const plan = (Array.isArray(a.plan) ? a.plan : []).flatMap((entry): PictureRole[] => { const p = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>; const id = typeof p.id === 'string' ? p.id : ''; if (!known.has(id)) return []; const uses = Math.round(Number(p.max_uses)); return [{ id, role: roleFor(kinds[id], pick(p.role, ROLES, 'support')), max_uses: Number.isFinite(uses) ? Math.max(1, Math.min(8, uses)) : 2, why: text(p.why, 100) }]; }).filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
  const ty = (r.typography && typeof r.typography === 'object' ? r.typography : {}) as Record<string, unknown>;
  return {
    format: text(r.format, 80), why: text(r.why, 220), hook: text(r.hook, 200), narrative: text(r.narrative, 240), beats,
    visual: pick(r.visual, VISUALS, 'photo_led'), visual_notes: text(r.visual_notes, 220), visual_language: text(r.visual_language, 200), pacing: pick(r.pacing, PACINGS, 'measured'),
    typography: { face: pick(ty.face, FACES, 'sans'), treatment: text(ty.treatment, 160) },
    colour_light: text(r.colour_light, 200), transitions: text(r.transitions, 160), cta: text(r.cta, 160), ending: text(r.ending, 160), brand: pick(r.brand, BRANDS, 'end_card'),
    assets: { coverage: pick(a.coverage, COVERAGES, 'sufficient'), needed: Math.max(0, Math.min(8, Math.round(Number(a.needed) || 0))), plan, generate: (Array.isArray(a.generate) ? a.generate : []).flatMap((g): Array<{ subject: string; role: OneOf<typeof ROLES>; why: string; style: string }> => { const item = typeof g === 'string' ? { subject: g } : (g && typeof g === 'object' ? g : {}) as Record<string, unknown>; const subject = text(item.subject, 140); return subject ? [{ subject, role: (() => { const r = pick(item.role, ROLES, 'support'); return r === 'unused' ? 'support' : r; })(), why: text(item.why, 100), style: text(item.style, 80) }] : []; }).slice(0, 6), art: text(a.art, 160), note: text(a.note, 200) },
  };
}

/** The look a strategy asks the code to be written for: invented graphics and type, or pictures. */
export const lookOf = (strategy: Strategy): 'photo' | 'motion' => (strategy.visual === 'graphic_led' || strategy.visual === 'typographic' ? 'motion' : 'photo');
/** How long a scene lasts, on average, for each pace. */
export const PACE_SECONDS: Record<OneOf<typeof PACINGS>, [number, number]> = { slow: [3.8, 9], measured: [2.6, 5.2], brisk: [1.5, 3.4], rapid: [0.5, 2.2] };

const IMAGE_COMPOSITIONS = new Set(['full_frame_image', 'detail_crop', 'centered_subject', 'split']);
/**
 * What a storyboard does that its own strategy does not allow, in plain words for the model to fix: a picture used more often than planned, a pace that is not the pace chosen, and a
 * visual approach that the scenes do not follow. Only things the strategy states; nothing here prefers one structure over another.
 */
/** Trust claims a video must never make unless the business's own information or the request makes them. Each is a class of claim, so a rewording of the same claim is caught too. */
const CLAIMS: Array<[string, RegExp]> = [
  ['licensed', /licen[sc]/i], ['insured', /\binsur|\bbonded\b/i], ['certified', /certif|accredit/i], ['guarantee', /guarant|warrant/i],
  ['around the clock (24/7)', /24\s*\/\s*7|twenty[- ]four[- ]seven|around the clock|day (or|and) night|365/i], ['24-hour', /24[- ]?(hour|hr)|twenty[- ]four[- ]hour/i],
  ['experience', /years? of|since (19|20)\d\d|decades|family[- ]owned|established|\bexperienced\b|\bexpert(s|ise)?\b|veteran|seasoned/i], ['best / rated / awarded', /\b(best|#1|number one|top[- ]rated|award|five[- ]star|5[- ]star|rated|leading)\b/i],
  ['an event or activity the business runs', /\b(trick[- ]or[- ]treat(ing|ers)?|join us|come (celebrate|party)|grand opening|open house|happy hour|tasting event|sale|giveaway|contest|raffle)\b/i],
  ['free offer', /\bfree (estimate|quote|inspection|consultation|call)s?\b/i], ['response time', /\b(within|under) [\w-]+ (minutes?|hours?)\b|same[- ]day|arrive in|on[- ]site in/i],
];
export const claimsIn = (text: string) => new Set(CLAIMS.filter(([, re]) => re.test(text)).map(([name]) => name));
/** The scene lines that make a trust claim nobody gave: [scene number, the line, the claims]. `facts` is everything the business and the owner actually said. */
export function unsupportedClaims(concept: Concept, facts: string): Array<{ scene: number; line: string; claims: string[] }> {
  const allowed = claimsIn(facts); const found: Array<{ scene: number; line: string; claims: string[] }> = [];
  concept.scenes.forEach((scene, i) => { for (const line of [scene.headline, scene.subtext, ...(scene.items ?? [])]) { if (!line) continue; const bad = [...claimsIn(line)].filter((c) => !allowed.has(c)); if (bad.length) found.push({ scene: i + 1, line, claims: bad }); } });
  return found;
}
/**
 * The model reads every line that will appear on screen against what is actually known about the business and says which lines promise something unsupported
 * (credentials, hours, timing, speed, guarantees, rankings, experience, offers, contact details). The word list above is only a quick net under it.
 */
const CLAIM_REVIEWER = `You check the on-screen words of a short marketing video against what is actually known about the business. For each numbered line decide whether it states, or strongly implies, something the FACTS do not support: credentials (licensed, insured, bonded, certified), availability and hours (24/7, always open, weekends, "this weekend", "today only", any timing or season the request did not give), speed or response promises (fast arrival, within minutes), guarantees or warranties, rankings and superlatives (best, number one, top-rated, trusted by), experience or history (years, family-owned, experienced, expert), quality stated as fact (premium finish, award-winning), prices or offers, reviews, places, phone numbers or addresses. What the owner's own request says IS supported (a request about a "24-hour emergency service" supports "24-hour emergency service"). Words that describe the mood of the video are not claims about the business. Naming the ordinary products or services a business of this type obviously sells (a bakery's cupcakes, cookies and treats, a plumber's repairs), or the occasion the owner asked about, is NOT a claim; do not flag it. Flag only lines that assert a verifiable fact the FACTS lack. A call to action that only asks the viewer to call, visit, order or follow is fine when it states no fact. Reply with ONLY JSON: {"problems": [{"line": the line's number, "why": "what it claims that is not supported, up to 14 words"}]} and an empty list when every line is fine.`;
export async function reviewClaims(concept: Concept, facts: string, complete: (system: string, prompt: string) => Promise<string>): Promise<Array<{ scene: number; line: string; why: string }>> {
  const lines: Array<{ scene: number; line: string }> = [];
  concept.scenes.forEach((scene, i) => { for (const line of [scene.headline, scene.subtext, ...(scene.items ?? [])]) if (line) lines.push({ scene: i + 1, line }); });
  if (!lines.length) return [];
  try {
    const reply = await complete(CLAIM_REVIEWER, `FACTS (everything the business and the owner said)\n${facts.slice(0, 1500)}\n\nLINES\n${lines.map((l, i) => `${i + 1}. (scene ${l.scene}) ${l.line}`).join('\n')}`);
    const body = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? '{}') as { problems?: Array<{ line?: unknown; why?: unknown }> };
    return (Array.isArray(body.problems) ? body.problems : []).flatMap((p) => { const found = lines[Number(p.line) - 1]; return found ? [{ ...found, why: typeof p.why === 'string' ? p.why.slice(0, 120) : 'not supported by the business facts' }] : []; });
  } catch { return []; }
}

/** A picture of a screen, dashboard, app, interface or document cannot hold readable text, so it is drawn in code and never generated. */
export const isInterfacePicture = (subject: string) => /\b(dashboards?|screens?|app\b|apps\b|ui\b|user interface|interface|mock-?ups?|wireframes?|website|web page|webpage|software|spreadsheet|invoices?|documents?|menus?|forms?|chat (window|screen)|notification|timeline ui)\b/i.test(subject);
/** True when a line of on-screen words is really a description of the picture or shot ("mechanical clock close-up", "silhouette and van beams"): that belongs in the picture, never on screen as a caption. */
const SHOT_WORDS = /\b(panoramas?|establishing|hero (shot|image)|placeholder|lorem|scene \d|title card|end card|logo card|storyboard|map view|b-?roll|transition|overlay|cta|call to action|follow the (trail|path|line|arrow)|leads? the way|(glow|light|pin|arrow) (marks|shows|points)|points? (to|at) the|watch (the|how)|see how|(this|here) is where|close-?ups?|macros?|silhouettes?|footage|b-?roll|flat-?lay|slow[- ]?motion|camera|beams?|pans?|zooms?|push-?in|pull-?out|extreme|frames?|render(ing)?s?|illustrations?|shot|shots)\b/i;
export function describesPicture(line: string, scene: { visual?: string; shot?: { subject?: string } }): boolean {
  const text = line.trim(); if (!text) return false;
  if (SHOT_WORDS.test(text)) return true;
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? []; const source = `${scene.shot?.subject ?? ''} ${scene.visual ?? ''}`.toLowerCase();
  return words.length >= 3 && words.every((w) => source.includes(w.slice(0, 5)));
}
/** Removes such lines (a headline gives way to the supporting line, or to no words). Returns how many were removed. */
export function dropPictureCaptions(concept: Concept): number {
  let dropped = 0;
  for (const scene of concept.scenes) {
    if (scene.subtext && describesPicture(scene.subtext, scene)) { scene.subtext = ''; dropped += 1; }
    if (scene.headline && describesPicture(scene.headline, scene)) { scene.headline = scene.subtext; scene.subtext = ''; dropped += 1; }
    if (scene.shot && !scene.headline && !scene.subtext && scene.shot.text !== 'none') scene.shot = { ...scene.shot, text: 'none' };
    else if (scene.shot && !scene.subtext && scene.shot.text === 'headline_sub') scene.shot = { ...scene.shot, text: 'headline' };
  }
  return dropped;
}

/** A scene with no picture and no words (longer than a flash) is removed and its time goes to its neighbours, so no seconds of nothing are ever rendered. */
export function dropEmptyScenes(concept: Concept): number {
  let dropped = 0;
  for (let i = concept.scenes.length - 2; i >= 1; i -= 1) {
    const scene = concept.scenes[i]; const words = scene.shot?.text ? scene.shot.text !== 'none' : !!(scene.headline || scene.subtext);
    if (scene.photoId || words || scene.seconds <= 1.2) continue;
    const before = concept.scenes[i - 1]; const after = concept.scenes[i + 1];
    before.seconds = Math.round((before.seconds + scene.seconds / 2) * 10) / 10; after.seconds = Math.round((after.seconds + scene.seconds / 2) * 10) / 10;
    concept.scenes.splice(i, 1); dropped += 1;
  }
  return dropped;
}

/** Last resort when a correction did not remove an invented claim: that line is dropped (a headline gives way to the supporting line, or to no words). */
export function dropUnsupportedClaims(concept: Concept, facts: string, flagged: Array<{ scene: number; line: string }> = []): number {
  const bad = new Set([...unsupportedClaims(concept, facts), ...flagged].map((c) => `${c.scene}|${c.line}`)); let dropped = 0;
  concept.scenes.forEach((scene, i) => {
    const hit = (line: string) => !!line && bad.has(`${i + 1}|${line}`);
    if (hit(scene.subtext)) { scene.subtext = ''; dropped += 1; }
    if (scene.items?.some(hit)) { scene.items = scene.items.filter((line) => !hit(line)); dropped += 1; }
    if (hit(scene.headline)) { scene.headline = scene.subtext; scene.subtext = ''; dropped += 1; }
    if (scene.shot && !scene.headline && !scene.subtext && scene.shot.text !== 'none') scene.shot = { ...scene.shot, text: 'none' };
    else if (scene.shot && !scene.subtext && scene.shot.text === 'headline_sub') scene.shot = { ...scene.shot, text: 'headline' };
  });
  return dropped;
}

export function conceptIssues(concept: Concept, strategy: Strategy, facts?: string): string[] {
  const issues: string[] = []; const n = concept.scenes.length;
  const uses = new Map<string, number>(); for (const scene of concept.scenes) if (scene.photoId) uses.set(scene.photoId, (uses.get(scene.photoId) ?? 0) + 1);
  for (const [id, count] of uses) { const planned = strategy.assets.plan.find((p) => p.id === id); if (planned && count > planned.max_uses) issues.push(`The picture ${id} is in ${count} of ${n} scenes but the asset plan allows it ${planned.max_uses}. Use the other pictures where they fit, or give those scenes a graphic or typographic treatment (photo null), or change the plan.`); }
  const average = concept.seconds / Math.max(1, n); const [lo, hi] = PACE_SECONDS[strategy.pacing];
  if (average < lo * 0.85 || average > hi * 1.15) issues.push(`The strategy's pace is "${strategy.pacing}" (scenes of about ${lo} to ${hi} seconds) but this storyboard has ${n} scenes in ${concept.seconds} seconds, about ${Math.round(average * 10) / 10} each. Change the number of scenes or their lengths to fit the pace.`);
  const ceiling = strategy.pacing === 'rapid' ? 3 : strategy.pacing === 'brisk' ? 4.2 : strategy.pacing === 'measured' ? 6.5 : 99;
  concept.scenes.forEach((scene, i) => { if (scene.seconds > ceiling && i < n - 1) issues.push(`Scene ${i + 1} lasts ${scene.seconds} seconds, too long for a "${strategy.pacing}" video (no scene should pass ${ceiling}). Cut it shorter, split it into two different shots, or give it a reason to move.`); });
  const places = new Map<string, number>(); for (const scene of concept.scenes) { const where = scene.shot?.text && scene.shot.text !== 'none' ? scene.shot.text_position : undefined; if (where) places.set(where, (places.get(where) ?? 0) + 1); }
  for (const [where, count] of places) if (n >= 5 && count > Math.ceil(n / 3)) issues.push(`${count} of ${n} scenes put their words at ${where.replace('_', ' ')}. Vary where the type sits and how big it is, as each scene's composition suggests.`);
  // the same treatment three scenes running (same text place and size, or the same camera move and crop) is a template, not a decision: say where, once
  const run = (key: (scene: Concept['scenes'][number]) => string | null, what: string) => { let start = 0; for (let i = 1; i <= n; i += 1) { const same = i < n && key(concept.scenes[i]) !== null && key(concept.scenes[i]) === key(concept.scenes[start]); if (!same) { if (i - start >= 3 && key(concept.scenes[start]) !== null) { issues.push(`Scenes ${start + 1} to ${i} all have ${what} (${key(concept.scenes[start])}). Give them different treatments that serve what each scene shows (a different text position or size, no words at all, another camera move or crop) unless the strategy itself calls for that consistency.`); } start = i; } } };
  run((scene) => (scene.shot?.text && scene.shot.text !== 'none' && scene.shot.text_position ? `${scene.shot.text_position}, ${scene.shot.text_scale ?? 'unspecified'} type` : null), 'the same text placement');
  run((scene) => (scene.photoId && scene.shot?.camera && scene.shot.camera !== 'static' ? `${scene.shot.camera}, ${scene.shot.crop ?? 'unspecified'} crop` : null), 'the same camera move and crop');
  const imageScenes = concept.scenes.filter((scene) => scene.photoId && (!scene.shot?.composition || IMAGE_COMPOSITIONS.has(scene.shot.composition))).length;
  if (strategy.visual === 'graphic_led' && imageScenes > 1) issues.push(`The visual strategy is graphic_led (invented graphics carry the video) but ${imageScenes} scenes are built on a picture. At most one scene may use a picture; the rest are graphic_motion, typographic or logo_card with photo null.`);
  if (strategy.visual === 'photo_led' && imageScenes < Math.ceil(n * 0.6)) issues.push(`The visual strategy is photo_led (pictures carry the video) but only ${imageScenes} of ${n} scenes use a picture. At least ${Math.ceil(n * 0.6)} should.`);
  if (strategy.visual === 'mixed' && (imageScenes === 0 || imageScenes === n)) issues.push(`The visual strategy is mixed but ${imageScenes === 0 ? 'no scene uses a picture' : 'every scene uses a picture'}: combine pictures and invented graphics or type.`);
  // a scene with no picture and no words shows nothing: it is only allowed as a flash of a second or so
  concept.scenes.forEach((scene, i) => { const words = scene.shot?.text ? scene.shot.text !== 'none' : !!(scene.headline || scene.subtext); if (!scene.photoId && !words && scene.seconds > 1.2) issues.push(`Scene ${i + 1} (${scene.seconds} seconds) has no picture and no words, so it shows almost nothing. Give it a picture or words that add to the story, merge it into the scene before or after, or cut it to a flash of a second or less.`); });
  concept.scenes.forEach((scene, i) => { for (const line of [scene.headline, scene.subtext]) if (line && describesPicture(line, scene)) issues.push(`Scene ${i + 1} shows "${line}" as words on screen, but that describes the picture, it is not something a viewer should read. Words on screen are copy a person would say or print (a headline, a number, a call to action); describe the picture only in the visual field.`); });
  // a picture that carries neighbouring scenes must be seen from a clearly different place or distance each time, or the journey looks like one still
  for (let i = 1; i < n; i += 1) { const a = concept.scenes[i - 1]; const b = concept.scenes[i]; if (a.photoId && a.photoId === b.photoId) { const near = a.shot?.subject_at && b.shot?.subject_at ? Math.hypot(a.shot.subject_at.x - b.shot.subject_at.x, a.shot.subject_at.y - b.shot.subject_at.y) < 0.25 : false; if ((a.shot?.crop ?? 'medium') === (b.shot?.crop ?? 'medium') && (near || !a.shot?.subject_at)) issues.push(`Scenes ${i} and ${i + 1} show the same picture from almost the same place and distance. Move subject_at to a clearly different part of it (at least a quarter of the frame away) and change the crop (wide, medium, tight) and the camera move.`); } }
  const closing = concept.scenes[n - 1];
  if (strategy.cta && !/^none\b/i.test(strategy.cta) && closing && !closing.photoId && closing.shot?.composition === 'typographic' && strategy.visual !== 'typographic') issues.push('The closing scene is a plain type card. Build the call to action on a picture or a live graphic that belongs to the film (a button, a pill, a moving background), with the words that tell the customer what to do.');
  if (facts !== undefined) for (const c of unsupportedClaims(concept, facts)) issues.push(`Scene ${c.scene} says "${c.line}", which claims ${c.claims.join(' and ')}. Nothing the business or the owner said supports that. Say only what the request and the business's own information say.`);
  return issues;
}

/** What the structure of a finished video was, in one line, so the next one can be told what was done recently. */
export function fingerprintOf(strategy: Strategy | null, concept: Concept): string {
  const n = concept.scenes.length;
  return `${strategy?.idea ? `concept: ${strategy.idea.type} "${strategy.idea.title}": ${strategy.idea.logline} | hook: ${strategy.idea.hook} | payoff: ${strategy.idea.payoff} | cta: ${strategy.idea.cta} | ` : ''}${strategy?.format ?? 'unplanned'} | language: ${strategy?.visual_language || 'unspecified'} | ${strategy?.visual ?? 'photo_led'}, pace ${strategy?.pacing ?? 'measured'} | ${n} scenes of about ${Math.round((concept.seconds / Math.max(1, n)) * 10) / 10}s | compositions ${concept.scenes.map((scene) => scene.shot?.composition ?? '?').join(', ')} | transitions ${concept.scenes.map((scene) => scene.transition ?? 'fade').join(', ')} | ending: ${strategy?.ending || concept.scenes.at(-1)?.headline || '?'}`;
}

export type StrategyInput = {
  request: string; subject: string; seconds: number; platform?: string; style?: string[]; instructions?: string[];
  business: { name: string; type: string; location: string; services: string[]; description: string; tone: string };
  /** every picture the business has, as looked at (see asset-vision.ts): what it shows, how good it is, and how suited it is to THIS request */
  pictures: Array<{ id: string; label: string; provenance?: string; kind?: string; shows?: string; relevance?: number; quality?: number; best_use?: string }>;
  /** the creative idea chosen for this video: the strategy delivers it */ idea?: Idea;
  /** whether Pilot can make pictures for this video, and at most how many: the strategy is told, so it plans for what exists */ generation?: { available: boolean; max: number };
  /** structures of videos made recently for this business (see fingerprintOf), so a new one is not the same shape without a reason */ recent?: string[];
};

/** How each kind of picture is described to the strategy: only the business's own photographs are real photographs of the business. */
export const PROVENANCE_TEXT: Record<string, string> = { own_upload: "the business's own photograph", product_photo: "the business's own product photograph", website: "taken from the business's website", ai_image: 'AI-generated EARLIER by Pilot (not a photograph of the business)', generated_now: 'AI-generated just now for this video (not a photograph of the business)', pilot_artwork: 'abstract artwork made by Pilot', logo: 'the logo' };

const SYSTEM = `You are Pilot's creative director. Before any scene is planned, you decide the CREATIVE STRATEGY of a short marketing video for a small business: what kind of video this should be and how it is built, so that it is right for THIS request, THIS business and THIS platform. Different requests deserve genuinely different videos, in structure and in look, not the same sequence with different words and pictures.
Think like a director: what is the owner trying to achieve, who is watching and where; what hook stops a thumb; what shape suits the message. The number of scenes and their lengths are yours to choose (15 seconds can be three long, luxurious shots or twelve quick cuts); so are whether photographs, invented graphics or type should carry it, how it moves, how it sounds visually (clean and flat, warm and filmic, loud and punchy), how it ends and whether it asks for anything.
Kinds of video that exist, as examples to think with and never a menu to pick from (combine or invent freely): a cinematic brand film; a fast product-reveal reel; a product showcase; before then after; problem then solution; an offer or promotion; an educational explainer; a seasonal or holiday spot; a luxury service film; social proof; a launch; a process or day-in-the-life; an announcement; a pricing explainer; a simple photo slideshow when the pictures are the best part.
Think like a creative advertising agency, not a video generator. Before you answer ask yourself: would someone stop scrolling for this; does the first second create curiosity; does every scene add something new; does the visual style fit this business; does the video build toward something; would the owner be proud to post it? A scene that adds nothing is cut. Where a scene shows an object or a place, show a real or generated picture of it (or a rendering in the video's own style), never a generic flat icon. If RECENT VIDEOS are listed, the new concept must be a genuinely different IDEA (a different hook, world, structure and visual language), not a variation. You decide the VISUAL LANGUAGE too, as a creative director would, for this business, request, audience and mood: photoreal or cinematic photography, stylised or animated 3D, 3D product renders, flat or hand-made illustration, cartoon or animation, motion graphics, kinetic type, abstract art, or a deliberate combination. Photography is one option, never the default: a fun Halloween bakery may be a stylised 3D animated cupcake world, a wedding-cake film cinematic photography or an elegant product render, an emergency plumber dramatic realism with animated water. Each scene may have its own treatment, so long as the whole feels like one advertisement. The failure to avoid is photo, photo, photo, text, logo. Aim for something the owner would be excited to post and might not have thought of; every business fact stays true (never invent services, prices, claims, certifications or logos).
Be decisive and specific. Do not fall back on "hook, detail, detail, more detail, sign-off": if you choose five scenes there must be a reason in the story, and a video whose beats are not the same shape as the last one is welcome. If RECENT VIDEOS are listed, do not repeat their structure unless this request calls for it.
Screens, dashboards, apps, documents and anything with writing are NEVER generated pictures (a generated picture cannot hold readable text): they are drawn in code as interface elements (cards, chat bubbles, form fields, status pills, counters, timelines, charts) and are not listed under generate. The renderer can only show pictures (with camera moves, crops and light) and draw type, numbers, shapes, lines and buttons: it cannot draw a wrench, a map, a clock or a character, so anything the idea shows that no photograph has must be a generated picture. Match the video's STRUCTURE to the idea: a journey through one world (a map, a room, a set) is TWO to FOUR generated pictures of DIFFERENT places in that same world, all described in one shared art style (so it reads as one world), each shown in one or two scenes as different crops and camera moves; a character or object story is a generated picture per pose or moment, cut stop-motion style; a product film uses the product photographs; a countdown or comedy uses a picture per beat. Pictures: use a picture only for what it actually shows (each one is described, with how well it suits this request). A picture may appear in more than one scene only as a clearly different shot (a macro against a wide), and must not carry most of the video unless the concept is deliberately one picture. If the pictures are not enough for the idea, say "thin" or "insufficient" and choose: when generation is available, ask for the missing pictures to be GENERATED (up to six; they are made for you before the storyboard is written, and you will plan scenes around them: describe exactly what each shows, ; and you choose HOW it looks, whatever will make the best advertisement for this business, request and mood: cinematic photography, a glossy 3D render, a stylised illustration, a cartoon or animated look, a product-style studio shot, a surreal or artistic treatment, anything. It does NOT have to look like a photograph, but it must look intentional, high quality and like part of one advertisement, never a generic stock or slideshow picture, and the pictures you ask for share one visual world. Generated pictures never contain people, readable text, logos, signs or business names, and no lettering on vehicles, uniforms or packaging, unless the request itself requires people), or let graphics and type carry those moments, or simplify the idea to what the pictures can do. The business's own real photographs are preferred wherever they suit the scene, and pictures generated by Pilot (earlier or now) are never presented as photographs of the business; generated pictures are for what the business does not have, never a replacement for a real photo that fits. A logo is branding (an end card at most), and abstract art or a drawn graphic is only ever a background. Never fill scenes with a picture just because it exists. When the visual approach is graphic_led or typographic the pictures are optional. "unused" is a fine role.
Reply with ONLY JSON: {"format": "what kind of video this is, up to 8 words", "why": "why this shape suits the request, the business and the platform, up to 30 words", "hook": "how the first second grabs attention, up to 25 words", "narrative": "the structure in one sentence", "beats": [{"purpose": "what this beat does, up to 14 words", "share": 0 to 1 (its share of the total time), "shows": "what is on screen, up to 8 words (a wide hero shot, a macro, a graphic counter, type only...)"}] (1 to 14 beats, as many as the idea needs; beats should differ in what they show, for a reason), "visual": "photo_led" | "graphic_led" | "mixed" | "typographic", "visual_language": "the visual language of the whole video, up to 25 words: what its pictures and graphics LOOK like (photoreal cinematic, stylised 3D animation, flat illustration, cartoon, product render, kinetic type, a deliberate mix...) and why that suits this business, audience and mood", "visual_notes": "up to 30 words on what carries it and how it is shown", "pacing": "slow" | "measured" | "brisk" | "rapid", "typography": {"face": "sans" | "serif" | "serif_italic_accent", "treatment": "case, weight, scale and placement approach, up to 20 words"}, "colour_light": "the colour and light treatment, up to 25 words", "transitions": "the transition approach, up to 20 words", "cta": "none, or what is asked of the viewer and how, up to 20 words (use only the request and the business's own information; never an invented offer)", "ending": "how it ends, up to 20 words", "brand": "end_card" | "corner_mark" | "both" (how the business's name or logo appears), "assets": {"coverage": "sufficient" | "thin" | "insufficient", "needed": how many DIFFERENT photographs this video needs on screen (0 to 8; count the beats that show a photograph, and never the same photograph twice for a different moment), "plan": [{"id": a picture id, "role": "hero" | "macro" | "support" | "background" | "transition" | "end_visual" | "unused", "max_uses": 1 to 8, "why": "up to 14 words"}], "art": "the visual world the generated pictures share, up to 25 words (empty when none are generated)", "generate": [{"subject": "what the picture shows, up to 25 words", "style": "its visual treatment, up to 10 words, chosen from the visual language you set for THIS video (for example: stylised 3D render, hand-drawn illustration, cartoon animation, product render, glossy macro photograph, cinematic photograph, motion-graphic poster; do not default to photography)", "role": "hero" | "macro" | "support" | "background" | "transition" | "end_visual", "why": "up to 14 words"}] (up to 6, or empty), "note": "up to 25 words"}}.`;

/** One call: the model decides the strategy. Returns null if it cannot (the caller then plans without one). */
export async function writeStrategy(input: StrategyInput, complete: (system: string, prompt: string) => Promise<string>): Promise<Strategy | null> {
  const b = input.business;
  const pictures = input.pictures.length ? input.pictures.map((p) => `${p.id}: "${p.label}"${p.provenance ? `, ${PROVENANCE_TEXT[p.provenance] ?? p.provenance.replace(/_/g, ' ')}` : ''}${p.kind ? `, ${p.kind.replace(/_/g, ' ')}` : ''}${p.shows ? `; shows: ${p.shows}` : ''}${p.relevance !== undefined ? `; suits this request ${p.relevance}/10` : ''}${p.quality !== undefined ? `, quality ${p.quality}/10` : ''}${p.best_use ? `; the reviewer's first thought: ${p.best_use}` : ''}`).join('\n') : 'none';
  const prompt = `THE BUSINESS\nName: ${b.name}\nType: ${b.type}\nPlace: ${b.location || 'not given'}\nServices: ${b.services.slice(0, 8).join(', ') || 'not listed'}\nVoice: ${b.tone || 'friendly and plain'}\n\nTHE REQUEST\n"${input.request.slice(0, 500)}"\nSubject: ${input.subject}\nLength: ${input.seconds} seconds in total.${input.platform ? `\nPlatform: ${input.platform}` : ''}${input.style?.length ? `\nStyle the owner asked for: ${input.style.join(', ')}` : ''}${input.instructions?.length ? `\nOwner's instructions: ${input.instructions.join('; ').slice(0, 300)}` : ''}\n\nTHE BUSINESS'S PICTURES (each looked at)\n${pictures}${input.recent?.length ? `\n\nRECENT VIDEOS made for this business (do not repeat the structure without a reason)\n${input.recent.slice(-5).map((line) => `- ${line}`).join('\n')}` : ''}`;
  const ids = input.pictures.map((p) => p.id);
  const kinds = Object.fromEntries(input.pictures.map((p) => [p.id, p.kind ?? '']));
  const generation = input.generation ?? { available: false, max: 0 };
  const own = input.pictures.filter((p) => ['own_upload', 'product_photo', 'website'].includes(p.provenance ?? '') && p.kind !== 'logo' && (p.relevance ?? 0) >= 5).length; const made = input.pictures.filter((p) => ['ai_image', 'generated_now'].includes(p.provenance ?? '') && (p.relevance ?? 0) >= 5).length;
  const ideaBlock = input.idea ? `\n\nTHE CREATIVE IDEA (authoritative: the strategy delivers THIS idea. Its story sets the beats and the number of scenes, its visual style sets your visual language, its hook, payoff and call to action are yours to keep; make it concrete, do not replace it with a standard ad)\n${ideaText(input.idea)}` : '';
  const tally = `\n\nPICTURE COUNT: ${own} of the business's own photographs suit this request; ${made} AI-generated picture(s) made by Pilot (they are not the business's own and should serve what real photographs cannot show).`;
  const ability = tally + (generation.available
    ? `\n\nPICTURE GENERATION IS AVAILABLE: up to ${generation.max} pictures can be made for this video, from your description alone. Count honestly how many different photographs your beats need ("needed") and how many of the business's pictures really suit them; when the business does not have enough, ask for exactly the missing ones in "generate" (do not pad a thin set with the same picture reused for different moments, and do not ask for more than the idea needs).`
    : `\n\nPICTURE GENERATION IS NOT AVAILABLE for this video: plan only with the pictures above, graphics and type.`);
  let last: Strategy | null = null; let attemptPrompt = prompt + ideaBlock + ability;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const strategy = cleanStrategy(JSON.parse(/\{[\s\S]*\}/.exec(await complete(SYSTEM, attemptPrompt))?.[0] ?? ''), ids, kinds);
      if (!strategy) continue;
      last = strategy;
      const issue = coverageIssue(strategy, input.pictures, generation, input.request);
      if (!issue) return strategy;
      attemptPrompt = `${prompt}${ideaBlock}${ability}\n\nYOUR PREVIOUS STRATEGY (reply with a corrected full JSON strategy):\n${JSON.stringify(strategy)}\n\nWHAT TO FIX: ${issue}`;
    } catch { /* try once more */ }
  }
  return last;
}

/** Words that put a person in a picture. Generated pictures never show people unless the owner's own request is about them. */
export const PEOPLE = /\b(person|people|man|men|woman|women|worker|workers|technician|technicians|staff|employee|employees|owner|customer|customers|client|clients|child|children|kid|kids|family|crew|team|uniformed|plumber|electrician|chef|baker|driver|hands?|faces?|portrait|silhouette|figure)\b/i;
export const wantsPeople = (request: string) => PEOPLE.test(request);
/** Does a picture description put a person in the picture? "no people", "without hands" and "no logos or people" are the model keeping people OUT, so they do not count. */
export const showsPeople = (subject: string) => PEOPLE.test(subject.replace(/\b(?:no|without|nobody|zero|not any)\s+[\w-]+(?:(?:,|\s+(?:or|and|nor))\s+[\w-]+)*(?:\s+(?:visible|present|in (?:the )?(?:frame|shot|scene|picture|image)))?/gi, ' '));

/** Can the pictures carry what the strategy says it needs? Returns what to correct, or null. Only the model's own numbers are compared: nothing here decides what the pictures should show. */
export function coverageIssue(strategy: Strategy, pictures: StrategyInput['pictures'], generation: { available: boolean; max: number }, request = ''): string | null {
  const peopleAsked = wantsPeople(request) ? [] : strategy.assets.generate.filter((g) => showsPeople(g.subject));
  if (generation.available && peopleAsked.length) return `Generated pictures never contain people, hands or faces unless the owner's request is about them. Re-describe these as a place or an object only (no person, worker or hands in it): ${peopleAsked.map((g) => `"${g.subject}"`).join('; ')}.`;
  const kindOf = new Map(pictures.map((p) => [p.id, p.kind ?? '']));
  const usable = new Set(strategy.assets.plan.filter((p) => ['hero', 'macro', 'support'].includes(p.role) && kindOf.has(p.id) && !['logo', 'abstract', 'graphic'].includes(kindOf.get(p.id)!)).map((p) => p.id)).size;
  const asked = strategy.assets.generate.length;
  const missing = Math.max(0, strategy.assets.needed - usable);
  if (!generation.available) return null;
  if (missing > asked && asked < generation.max) return `You say the video needs ${strategy.assets.needed} different photographs but only ${usable} of the business's pictures are planned as hero, macro or support. Ask for the ${Math.min(missing, generation.max) - asked} missing picture(s) in "generate" (each described by what it shows and the visual treatment that suits the business and the beat), or lower "needed" and change the beats so they genuinely do not need them.`;
  if (asked > missing) return `You ask for ${asked} generated picture(s) but only ${missing} are missing (needed ${strategy.assets.needed}, the business's usable pictures ${usable}). Ask for no more than the idea needs.`;
  return null;
}

/** The strategy as the storyboard writer, the code writer and the critic read it. */
export function strategyText(strategy: Strategy): string {
  const lines = [
    ...(strategy.idea ? [`CREATIVE IDEA: ${strategy.idea.type}, "${strategy.idea.title}": ${strategy.idea.logline} Story: ${strategy.idea.story} Payoff: ${strategy.idea.payoff}`] : []),
    `Format: ${strategy.format}. ${strategy.why}`, `Hook: ${strategy.hook}`, `Narrative: ${strategy.narrative}`,
    `Beats (share of the time): ${strategy.beats.map((beat, i) => `${i + 1}. ${beat.purpose}${beat.shows ? ` [${beat.shows}]` : ''} (${Math.round(beat.share * 100)}%)`).join('; ')}`,
    `Visual approach: ${strategy.visual.replace(/_/g, ' ')}. ${strategy.visual_notes}`, ...(strategy.visual_language ? [`Visual language: ${strategy.visual_language}`] : []), `Pacing: ${strategy.pacing}`,
    `Typography: ${strategy.typography.face.replace(/_/g, ' ')}; ${strategy.typography.treatment}`, `Colour and light: ${strategy.colour_light}`, `Transitions: ${strategy.transitions}`,
    `Call to action: ${strategy.cta}`, `Ending: ${strategy.ending}`, `Brand: ${strategy.brand.replace(/_/g, ' ')}`,
    `Pictures: ${strategy.assets.coverage}${strategy.assets.note ? `. ${strategy.assets.note}` : ''}${strategy.assets.plan.length ? `. Plan: ${strategy.assets.plan.map((p) => `${p.id} as ${p.role} (at most ${p.max_uses} scene${p.max_uses === 1 ? '' : 's'}${p.why ? `: ${p.why}` : ''})`).join('; ')}` : ''}`,
  ];
  return lines.join('\n');
}
