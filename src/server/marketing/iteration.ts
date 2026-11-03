import type { CreativeBrief } from './creative-brief.js';
import { planScenes, type Storyboard } from './storyboard.js';
import type { VideoEngine } from './video-engine.js';

/**
 * Changing a video that is already made ("make it darker", "make the product shot longer", "change the ending", "more energy").
 * The change is merged into the brief as a new job that points back at the finished one (iteration_of). This decides how little has to
 * be redone, so the owner does not pay to remake what they were happy with:
 *
 *   caption_only  the caption or hashtags changed: write a new caption, keep the same video.
 *   music_only    the music changed: mix new music into the same picture.
 *   recut         the picture is re-joined from the saved clips with a change: a new ending, a darker or brighter grade, and/or ONE or
 *                 a few scenes remade. Only the scenes being remade cost Runway credits.
 *   full          the whole video is made again: a new subject, platform, length or style that changes how every scene looks.
 *
 * Plain, repeatable code (no AI call). Anything it cannot place falls back to a full remake, which is always correct if not the cheapest.
 */
export type IterationKind = 'caption_only' | 'music_only' | 'recut' | 'full';
export type IterationPlan = {
  kind: IterationKind;
  /** Indexes (into the storyboard's scenes) of the generated scenes to make again. */
  redoScenes: number[];
  /** New lengths for particular scenes, by scene index. */
  sceneSeconds: Record<number, number>;
  redoEnding: boolean;
  /** Words for the new ending, when the owner gave them; otherwise Pilot writes them. */
  endText: string | null;
  recaption: boolean;
  /** The colour grade after this change (below 0 darker, above 0 brighter), or null when it is not being changed. */
  grade: number | null;
  /** The owner's instruction for the scenes being remade. */
  sceneInstruction: string;
  /** Seconds of new Runway footage this will make, which is what costs credits. */
  creditSeconds: number;
  /** Why the whole video is being made again, when it is. */
  reason: string | null;
};

/** About what Runway charges for gen4.5: the 2 + 2 second test used 48 credits. */
export const CREDITS_PER_SECOND = 12;
export const estimateCredits = (seconds: number) => Math.round(seconds * CREDITS_PER_SECOND);
/** How a cost is said to the owner, everywhere: "about 48 Runway credits" or "no Runway credits". */
export const costWords = (creditSeconds: number) => (creditSeconds > 0 ? `about ${estimateCredits(creditSeconds)} Runway credits` : 'no Runway credits');

/** The cost, as one sentence at the end of what Pilot says it will do. A free animated video is just free. */
export const costSentence = (engine: VideoEngine | undefined, creditSeconds: number) => (engine === 'animated' ? 'That’s free: no credits.' : `That uses ${costWords(creditSeconds)}.`);

const GRADE_STEP = 0.1; const GRADE_LIMIT = 0.3;

const SCENE_CUES: Array<{ role: 'hook' | 'main' | 'support'; pattern: RegExp }> = [
  { role: 'main', pattern: /\b(?:product|main|hero|middle)\s+(?:shot|scene|clip|part)\b|\bthe (?:product|main shot)\b/ },
  { role: 'hook', pattern: /\b(?:opening|hook|intro|first)\s*(?:shot|scene|clip|part)?\b|\bthe (?:start|beginning)\b/ },
  { role: 'support', pattern: /\b(?:supporting|support|detail|second|third)\s+(?:shot|scene|clip|part)s?\b/ },
];
const ENDING = /\b(?:the )?(?:ending|end card|end screen|outro|call to action|cta|last (?:shot|scene|part))\b|\bchange the end\b/;
const CAPTION = /\b(?:caption|hashtags?|wording of the post|the text under|post text|description)\b/;
const MUSIC = /\b(?:music|soundtrack|song|beat|audio|sound)\b/;
const LENGTH_WORDS = /\b(?:longer|shorter|extend|trim|lengthen|shorten)\b/;
const DARKER = /\b(?:darker|moodier|dim(?:mer)?|less bright)\b/; const BRIGHTER = /\b(?:brighter|lighter|less dark|airier)\b/;
// style words that change how the SCENES look when they are made, so every scene has to be made again
const LOOK_STYLES = new Set(['cinematic', 'luxury', 'elegant', 'minimal', 'fun', 'retro', 'modern', 'bold', 'dramatic', 'professional', '3d', 'calm', 'fast', 'slow', 'high energy', 'seasonal', "valentine's", 'christmas', 'halloween', 'summer', 'attention-grabbing', 'tiktok style', 'instagram style', 'surprise me']);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item) => b.includes(item));

/** The endings text in "change the ending to <words>", when it is given. */
export function endTextFrom(message: string): string | null {
  const quoted = message.match(/["“”']([^"“”']{4,90})["“”']/)?.[1];
  if (quoted) return quoted.trim();
  const after = message.match(/\b(?:ending|end card|end screen|outro|cta|call to action)\b.{0,20}?\b(?:to say|to read|to|say|says|saying|with|:)\s+(.{4,90}?)\s*[.!]?$/i)?.[1];
  return after && !/^(?:something|another|a different|different|new|better|something else)\b/i.test(after) ? after.trim() : null;
}

function planRunwayIteration({ previousBrief, storyboard, nextBrief, message }: { previousBrief: CreativeBrief; storyboard: Storyboard | null; nextBrief: CreativeBrief; message: string }): IterationPlan {
  const text = message.toLowerCase();
  const empty: IterationPlan = { kind: 'full', redoScenes: [], sceneSeconds: {}, redoEnding: false, endText: null, recaption: false, grade: null, sceneInstruction: message.slice(0, 300), creditSeconds: 0, reason: null };
  const full = (reason: string): IterationPlan => ({ ...empty, reason, creditSeconds: planScenes(nextBrief.length_seconds).seconds.slice(0, -1).reduce((a, b) => a + b, 0) });

  // what in the brief actually changed
  if (nextBrief.main_subject !== previousBrief.main_subject) return full('The subject changed, so every scene needs to be made again.');
  if (nextBrief.platform !== previousBrief.platform || nextBrief.content_type !== previousBrief.content_type) return full('The platform or format changed, so the video needs to be made again.');
  const clipScenes = (storyboard?.scenes ?? []).map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.kind === 'clip');
  const sceneCue = SCENE_CUES.find((cue) => cue.pattern.test(text));
  const wantsLength = LENGTH_WORDS.test(text) || /\b\d{1,2}\s*-?\s*(?:seconds?|secs?|s)\b/.test(text);
  // "shorter", "more dramatic" and the like are about the thing named: the caption, the music, the ending or one scene
  const aboutAPart = !!sceneCue || ENDING.test(text) || MUSIC.test(text) || CAPTION.test(text);
  const totalLengthChanged = nextBrief.length_seconds !== previousBrief.length_seconds;
  if (totalLengthChanged && !aboutAPart) return full('The length changed, so the scenes need to be planned again.');
  const added = nextBrief.style.filter((word) => !previousBrief.style.includes(word)); const removed = previousBrief.style.filter((word) => !nextBrief.style.includes(word));
  // style words said about the music or the caption describe THAT ("make the music more dramatic"), not how the scenes look
  const styleAboutSoundOrWords = (MUSIC.test(text) || CAPTION.test(text)) && !sceneCue && !ENDING.test(text);
  const lookChanged = !styleAboutSoundOrWords && [...added, ...removed].some((word) => LOOK_STYLES.has(word));
  const gradeOnly = !lookChanged && [...added, ...removed].every((word) => word === 'dark' || word === 'bright');
  if (lookChanged) return full('The look changed (the style words), so every scene needs to be made again to match.');

  const plan: IterationPlan = { ...empty };
  const missingClips = clipScenes.filter(({ scene }) => !scene.clip_video_id);

  // the ending
  if (ENDING.test(text)) { plan.redoEnding = true; plan.endText = endTextFrom(message); }
  // a particular scene: longer, shorter, or made different
  if (sceneCue) {
    const targets = clipScenes.filter(({ scene }) => scene.role === sceneCue.role);
    if (targets.length) {
      for (const { scene, index } of targets) {
        plan.redoScenes.push(index);
        const explicit = Number(text.match(/\b(\d{1,2})\s*-?\s*(?:seconds?|secs?|s)\b/)?.[1] ?? 0);
        if (explicit >= 2) plan.sceneSeconds[index] = clamp(explicit, 2, 10);
        else if (/\b(?:longer|extend|lengthen)\b/.test(text)) plan.sceneSeconds[index] = clamp(scene.seconds + 2, 2, 10);
        else if (/\b(?:shorter|trim|shorten)\b/.test(text)) plan.sceneSeconds[index] = clamp(scene.seconds - 1, 2, 10);
      }
    }
  } else if (wantsLength && !aboutAPart && !totalLengthChanged) {
    // "make it longer" with no scene named and no length given: the whole video is changing length
    return full('A longer or shorter video means planning the scenes again.');
  }
  // colour grade: darker or brighter, done on the saved clips (free), when nothing else about the look changed
  if (gradeOnly && (added.length || removed.length || DARKER.test(text) || BRIGHTER.test(text))) {
    const direction = DARKER.test(text) || added.includes('dark') ? -1 : BRIGHTER.test(text) || added.includes('bright') ? 1 : 0;
    const current = storyboard?.grade ?? 0;
    if (direction !== 0) plan.grade = Math.round(clamp(current + direction * GRADE_STEP, -GRADE_LIMIT, GRADE_LIMIT) * 100) / 100;
  }
  if (CAPTION.test(text)) plan.recaption = true;
  const musicAsked = MUSIC.test(text) || !sameList(previousBrief.key_instructions.filter((line) => /music|sound|audio/i.test(line)), nextBrief.key_instructions.filter((line) => /music|sound|audio/i.test(line)));

  const picture = plan.redoScenes.length > 0 || plan.redoEnding || plan.grade !== null;
  if (picture && !storyboard) return full('I do not have the earlier scene plan, so the video needs to be made again.');
  if (picture) {
    if (missingClips.some(({ index }) => !plan.redoScenes.includes(index))) return full('I no longer have the earlier clips saved, so the video needs to be made again.');
    plan.kind = 'recut'; plan.creditSeconds = plan.redoScenes.reduce((sum, index) => sum + (plan.sceneSeconds[index] ?? storyboard!.scenes[index].seconds), 0);
    return plan;
  }
  if (musicAsked) { plan.kind = 'music_only'; return plan; }
  if (plan.recaption) { plan.kind = 'caption_only'; return plan; }
  return full('I could not tell which part to change, so I will make the video again with your change.');
}

/**
 * A change to a free animated video. Everything is free, so only what the change touches is redone, but there are no clips to reuse:
 * a new caption or new music keeps the same video, a new ending is re-drawn from the saved scene plan, and anything else plans the
 * animation again with the change (still free).
 */
function planAnimatedIteration({ previousBrief, nextBrief, message }: { previousBrief: CreativeBrief; nextBrief: CreativeBrief; message: string }): IterationPlan {
  const text = message.toLowerCase();
  const base: IterationPlan = { kind: 'full', redoScenes: [], sceneSeconds: {}, redoEnding: false, endText: null, recaption: false, grade: null, sceneInstruction: message.slice(0, 300), creditSeconds: 0, reason: null };
  if (nextBrief.main_subject !== previousBrief.main_subject) return { ...base, reason: 'The subject changed, so the whole video is planned again.' };
  if (nextBrief.platform !== previousBrief.platform || nextBrief.content_type !== previousBrief.content_type) return { ...base, reason: 'The platform or format changed, so the whole video is planned again.' };
  const aboutAPart = ENDING.test(text) || MUSIC.test(text) || CAPTION.test(text);
  const added = nextBrief.style.filter((word) => !previousBrief.style.includes(word)); const removed = previousBrief.style.filter((word) => !nextBrief.style.includes(word));
  const styleAboutSoundOrWords = (MUSIC.test(text) || CAPTION.test(text)) && !ENDING.test(text);
  if (!styleAboutSoundOrWords && [...added, ...removed].some((word) => LOOK_STYLES.has(word) || word === 'dark' || word === 'bright')) return { ...base, reason: 'The look changed, so the whole video is planned again to match.' };
  if (nextBrief.length_seconds !== previousBrief.length_seconds && !aboutAPart) return { ...base, reason: 'The length changed, so the whole video is planned again.' };
  const recaption = CAPTION.test(text);
  const musicAsked = MUSIC.test(text) || !sameList(previousBrief.key_instructions.filter((line) => /music|sound|audio/i.test(line)), nextBrief.key_instructions.filter((line) => /music|sound|audio/i.test(line)));
  if (ENDING.test(text)) return { ...base, kind: 'recut', redoEnding: true, endText: endTextFrom(message), recaption };
  if (musicAsked) return { ...base, kind: 'music_only', recaption };
  if (recaption) return { ...base, kind: 'caption_only', recaption: true };
  return { ...base, reason: 'I could not tell which part to change, so the whole video is planned again with your change.' };
}

/** How little has to be redone for a change to a finished video, for the engine it was made with. */
export function planIteration(input: { previousBrief: CreativeBrief; storyboard: Storyboard | null; nextBrief: CreativeBrief; message: string; engine?: VideoEngine }): IterationPlan {
  return input.engine === 'animated' ? planAnimatedIteration(input) : planRunwayIteration(input);
}

const ROLE_WORDS: Record<string, string> = { hook: 'the opening shot', main: 'the main shot', support: 'a supporting shot', ending: 'the ending' };

/** The plan in plain words for the owner: what stays, what is redone, and what it costs. */
export function describePlan(plan: IterationPlan, storyboard: Storyboard | null, engine: VideoEngine = 'runway'): string[] {
  const cost = costSentence(engine, plan.creditSeconds);
  if (plan.kind === 'full') return [`I’ll make the whole video again (${(plan.reason ?? 'your change affects every scene').replace(/\.$/, '')}). ${cost}`];
  const redo: string[] = []; const keep: string[] = [];
  if (plan.kind === 'caption_only') return [`I’ll write a new caption and keep the video exactly as it is. ${cost}`];
  if (plan.kind === 'music_only') return [`I’ll put new music under the same video. The picture and caption stay as they are. ${cost}`];
  for (const index of plan.redoScenes) { const scene = storyboard?.scenes[index]; redo.push(`${ROLE_WORDS[scene?.role ?? 'support']}${plan.sceneSeconds[index] ? ` (${plan.sceneSeconds[index]} seconds)` : ''}`); }
  if (plan.redoEnding) redo.push(plan.endText ? `the ending, which will say “${plan.endText}”` : 'the ending');
  if (plan.grade !== null) redo.push(plan.grade < (storyboard?.grade ?? 0) ? 'a darker look across the clips' : 'a brighter look across the clips');
  if (plan.recaption) redo.push('the caption');
  const lookChange = plan.grade !== null; // a darker or brighter look moves the music to match the mood
  keep.push('the other scenes', ...(lookChange ? [] : ['the music']), ...(plan.recaption ? [] : ['the caption']));
  return [`I’ll redo only ${redo.join(' and ')}, and keep ${keep.join(', ').replace(/, ([^,]*)$/, ' and $1')}.${lookChange ? ' The music will follow the new mood.' : ''} ${cost}`];
}
