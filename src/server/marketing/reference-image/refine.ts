import { cleanBlueprint, type Aspect, type Blueprint } from './style.js';

/**
 * Follow-up changes ("make the text bigger", "make it darker", "use our actual cake photo", "make it Instagram square"). Plain rules handle the common ones, so
 * they are instant and free; anything else goes to the model as a small patch. Either way the change is applied to the design that came from the
 * reference, so the reference's direction is never lost: "darker" makes that design darker, it does not start a different one.
 */
export type Refinement = { blueprint: Blueprint; headline?: string; /** words to look for among the business's photos; 'none' removes the photo */ photo?: string; reset?: boolean; changes: string[]; understood: boolean };

const SIZES = ['s', 'm', 'l', 'xl', 'xxl'] as const;
const step = (size: Blueprint['headline']['size'], by: number) => SIZES[Math.max(0, Math.min(4, SIZES.indexOf(size) + by))];
const has = (message: string, pattern: RegExp) => pattern.test(message);

/** Whether a message reads as a change to the picture just made (not a new request). */
export const looksLikeRefinement = (message: string): boolean => {
  const m = message.toLowerCase();
  if (/\b(?:make|create|write|give)\s+(?:me\s+)?(?:a|an|another|some|ideas)\b/.test(m) && !/\bmake it\b/.test(m)) return false;
  return /\b(?:darker|lighter|brighter|dimmer|bigger|larger|smaller|text|headline|title|font|logo|photo|picture|image|background|colou?rs?|luxur\w+|premium|elegant|minimal\w*|playful|bold|clean|simple|square|portrait|landscape|story|vertical|wider|remove|add|change|move|shorter|longer|more space|button|cta|frame|border|shadow|gold|original look|go back)\b/.test(m);
};

const ASPECTS: Array<[RegExp, Aspect, string]> = [
  [/\b(?:instagram\s+)?square\b|\b1:1\b/, '1:1', 'a square (1:1) picture'], [/\b(?:story|stories|reel|9:16|full[- ]?screen)\b/, '9:16', 'a story-size (9:16) picture'],
  [/\b4:5\b|\bportrait\b|\binstagram\s+portrait\b/, '4:5', 'a portrait (4:5) picture'], [/\b3:4\b/, '3:4', 'a 3:4 picture'], [/\b16:9\b|\blandscape\b|\bwide(?:r|screen)?\b|\bfacebook cover\b/, '16:9', 'a wide (16:9) picture'],
];

export function refine(current: Blueprint, original: Blueprint, message: string): Refinement {
  const m = message.toLowerCase(); const bp: Blueprint = structuredClone(current); const changes: string[] = []; let headline: string | undefined; let photo: string | undefined; let reset = false;
  const note = (text: string) => { if (!changes.includes(text)) changes.push(text); };
  const quoted = /["“]([^"”]{3,80})["”]/.exec(message)?.[1]?.trim();

  if (has(m, /\b(?:original (?:look|design)|go back|start over|undo (?:all|everything))\b/)) { return { blueprint: structuredClone(original), reset: true, changes: ['went back to the reference’s original design'], understood: true }; }
  for (const [pattern, aspect, label] of ASPECTS) if (has(m, pattern) && !has(m, /\b(?:text|headline)\b.*\bwider\b/)) { bp.aspect = aspect; note(`made it ${label}`); break; }
  if (has(m, /\b(?:darker|dimmer|moodier|more dramatic)\b|\bdarken\b|\bless bright\b/)) { if (bp.tone === 'light') { bp.tone = 'dark'; bp.shift = 0; note('switched to a darker look'); } else { bp.shift = Math.max(-0.5, bp.shift - 0.18); note('made it darker'); } bp.overlay = Math.min(0.85, bp.overlay + 0.12); bp.background.vignette = true; }
  if (has(m, /\b(?:lighter|brighter|lighten|airier)\b|\bmore light\b/)) { bp.shift = Math.min(0.5, bp.shift + 0.18); bp.overlay = Math.max(0, bp.overlay - 0.12); note('made it lighter'); }
  if (has(m, /\b(?:make|set)\b.*\b(?:background|it)\b.*\b(?:dark|black)\b|\bdark (?:mode|background|theme)\b/) && bp.tone === 'light') { bp.tone = 'dark'; note('switched to a dark background'); }
  if (has(m, /\b(?:light|white) (?:background|theme)\b/) && bp.tone === 'dark') { bp.tone = 'light'; note('switched to a light background'); }
  if (has(m, /\b(?:text|headline|title|font|words|writing)\b.*\b(?:bigger|larger|huge|more prominent)\b|\b(?:bigger|larger)\b.*\b(?:text|headline|title|font|words)\b|\bincrease (?:the )?text\b/)) { const next = step(bp.headline.size, 1); if (next === bp.headline.size) { bp.margin = Math.max(0.03, bp.margin - 0.02); } bp.headline.size = next; note('made the text bigger'); }
  if (has(m, /\b(?:text|headline|title|font|words|writing)\b.*\b(?:smaller|tinier|less prominent)\b|\b(?:smaller)\b.*\b(?:text|headline|title|font|words)\b|\bdecrease (?:the )?text\b/)) { bp.headline.size = step(bp.headline.size, -1); note('made the text smaller'); }
  if (has(m, /\b(?:remove|no|without|delete|hide|take off|get rid of)\b.*\b(?:text|words|writing|headline|caption)\b/)) { bp.text = false; note('removed the text'); }
  else if (has(m, /\b(?:add|put|bring|show)\b.*\b(?:text|words|headline)\b.*\b(?:back|again)\b|\b(?:add|put) (?:the )?(?:text|headline|words)\b/) && !bp.text) { bp.text = true; note('put the text back'); }
  if (has(m, /\b(?:remove|no|without|delete|hide|take off)\b.*\b(?:button|cta|call to action)\b/)) { bp.cta.style = 'none'; note('removed the button'); }
  if (has(m, /\b(?:remove|no|without|delete|hide|take off)\b.*\blogo\b/)) { bp.logo = 'none'; note('removed the logo'); }
  else if (has(m, /\b(?:add|show|put)\b.*\blogo\b/) && bp.logo === 'none') { bp.logo = 'top_left'; note('added the logo'); }
  if (has(m, /\bluxur\w*|\bpremium\b|\belegant\b|\bupscale\b|\bhigh[- ]end\b|\bsophisticated\b/)) { bp.tone = 'dark'; bp.shift = Math.min(bp.shift, -0.08); bp.headline.caps = true; bp.headline.spacing = 0.1; bp.headline.weight = 700; bp.headline.size = step(bp.headline.size, bp.headline.size === 'xxl' ? -2 : bp.headline.size === 'xl' ? -1 : 0); bp.accents = ['rule', 'frame']; bp.cta.style = 'outline'; bp.margin = Math.max(bp.margin, 0.09); bp.mood = ['luxury', 'refined']; note('made it more luxurious'); }
  if (has(m, /\bminimal\w*|\bsimpl(?:e|er|ify)\b|\bcleaner\b|\bless busy\b|\bless cluttered\b/)) { bp.accents = []; bp.subject.frame = 'none'; bp.margin = Math.max(bp.margin, 0.1); bp.cta.style = bp.cta.style === 'none' ? 'none' : 'text'; bp.background.kind = bp.background.kind === 'photo' ? 'photo' : 'solid'; bp.mood = ['minimal', 'clean']; note('made it simpler and cleaner'); }
  if (has(m, /\bplayful\b|\bfun(?:ner)?\b|\bcheerful\b|\bhappier\b/)) { bp.tone = 'light'; bp.shift = Math.max(bp.shift, 0.05); bp.headline.weight = 800; bp.headline.caps = false; bp.headline.spacing = 0; bp.accents = ['dots', 'badge']; bp.subject.shape = 'circle'; bp.cta.style = 'pill'; bp.mood = ['playful', 'bright']; note('made it more playful'); }
  if (has(m, /\bbolder?\b|\bpunchier\b|\bloud(?:er)?\b|\bstronger\b|\bmore impact\b/)) { bp.headline.size = step(bp.headline.size, 1); bp.headline.weight = 800; bp.headline.caps = true; if (!bp.accents.includes('band')) bp.accents = [...bp.accents, 'band' as const].slice(0, 4); bp.mood = ['bold']; note('made it bolder'); }
  if (has(m, /\b(?:text|headline|words)\b.*\b(?:left)\b|\balign (?:the )?(?:text )?left\b/)) { bp.headline.align = 'left'; note('moved the text to the left'); }
  if (has(m, /\b(?:text|headline|words)\b.*\b(?:right)\b|\balign (?:the )?(?:text )?right\b/)) { bp.headline.align = 'right'; note('moved the text to the right'); }
  if (has(m, /\b(?:text|headline|words)\b.*\b(?:centre|center|middle)\b|\bcentre the text\b|\bcenter the text\b/)) { bp.headline.align = 'center'; note('centred the text'); }
  if (has(m, /\b(?:text|headline|words)\b.*\b(?:top|above)\b|\bmove (?:the )?text up\b/)) { bp.headline.position = 'top'; note('moved the text to the top'); }
  if (has(m, /\b(?:text|headline|words)\b.*\b(?:bottom|below|lower)\b|\bmove (?:the )?text down\b/)) { bp.headline.position = 'bottom'; note('moved the text to the bottom'); }
  if (has(m, /\b(?:photo|picture|product|cake|image)\b.*\bbigger\b|\bbigger\b.*\b(?:photo|picture|product|image)\b|\bzoom in\b/)) { bp.subject.scale = Math.min(1, bp.subject.scale + 0.14); note('made the picture bigger'); }
  if (has(m, /\b(?:photo|picture|product|cake|image)\b.*\bsmaller\b|\bsmaller\b.*\b(?:photo|picture|product|image)\b/)) { bp.subject.scale = Math.max(0.35, bp.subject.scale - 0.14); note('made the picture smaller'); }
  if (has(m, /\bmore (?:space|breathing room|margin|padding)\b|\bmore spacious\b/)) { bp.margin = Math.min(0.16, bp.margin + 0.025); note('added more space around everything'); }
  if (has(m, /\b(?:gold|golden)\b/) && !bp.accents.includes('rule')) { bp.accents = [...bp.accents, 'rule' as const].slice(0, 4); note('added a fine accent line in your accent colour'); }

  // the photo: "use our actual chocolate cake photo", "use our real product photo", "use a different photo", "no photo"
  if (has(m, /\b(?:no|remove|without|take out|drop)\b.*\b(?:photo|picture|image)\b/) && !has(m, /\bno text\b/)) { photo = 'none'; note('took the photo out'); }
  else {
    const named = /\b(?:use|show|put|add|swap in|switch to|try|with)\b\s+(?:in\s+)?(?:our|my|the|a)\s+(?:actual|real|own|existing|uploaded)?\s*(.{0,60}?)\s*(?:photos?|pictures?|images?|shots?)\b/.exec(m);
    if (named) { photo = (named[1] || '').replace(/\b(?:actual|real|own|existing|uploaded|product|favou?rite|new|different|another)\b/g, '').trim() || '*'; }
    else if (has(m, /\b(?:different|another|other|new)\s+(?:photo|picture|image)\b/)) { photo = '*'; }
  }
  if (quoted && has(m, /\b(?:say|says|headline|title|text|read|reads|write)\b/)) { headline = quoted; bp.text = true; note('changed the headline'); }
  return { blueprint: cleanBlueprint(bp, original), ...(headline ? { headline } : {}), ...(photo ? { photo } : {}), ...(reset ? { reset } : {}), changes, understood: changes.length > 0 || !!photo || !!headline };
}

const PATCH_SYSTEM = `You change the design of a picture a business owner asked for. You get the current design as JSON (a "blueprint") and the owner's message. Reply with ONLY a JSON object holding the blueprint fields that should change (leave out everything else), using the same keys and values as the current blueprint. Make the change the owner asked for and nothing more; keep the overall design direction.`;
/** For a change the rules did not recognise: the model proposes a small patch, which is checked field by field before it is used. */
export async function refineWithModel(current: Blueprint, original: Blueprint, message: string, complete: (system: string, prompt: string) => Promise<string>): Promise<Refinement> {
  try {
    const reply = await complete(PATCH_SYSTEM, `CURRENT\n${JSON.stringify(current)}\n\nOWNER\n${message.slice(0, 300)}`);
    const patch = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? '') as Record<string, unknown>;
    const merged = { ...current, ...patch, background: { ...current.background, ...((patch.background as object) ?? {}) }, subject: { ...current.subject, ...((patch.subject as object) ?? {}) }, headline: { ...current.headline, ...((patch.headline as object) ?? {}) }, cta: { ...current.cta, ...((patch.cta as object) ?? {}) } };
    const blueprint = cleanBlueprint(merged, original);
    const changed = JSON.stringify(blueprint) !== JSON.stringify(current);
    return { blueprint, changes: changed ? ['made the change you asked for'] : [], understood: changed };
  } catch { return { blueprint: current, changes: [], understood: false }; }
}
