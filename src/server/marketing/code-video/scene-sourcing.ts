import type { Concept } from './concept.js';
import { isInterfacePicture, showsPeople, wantsPeople, type Strategy } from './strategy.js';

/**
 * Every scene must be a VISUAL ACTION, not a description. The toolkit can draw type, numbers, shapes, lines, glows, buttons and simple graphics; it cannot draw a
 * wrench, a map, a clock or a basement. So after the storyboard exists, each scene is checked against the picture it was given: when the action needs something
 * the picture does not show (and the toolkit cannot draw), a picture of exactly that moment is made, and the scene is built on it. A scene of one continuous
 * world (a map, a room, a set) may instead reuse an earlier scene's picture, seen from another part of it.
 */
export type SceneSource = { scene: number; kind: 'picture_ok' | 'new_picture' | 'reuse' | 'graphics' | 'type'; picture?: string; reuse?: number; why: string };
type Complete = (system: string, prompt: string) => Promise<string>;
export type MadePicture = { id: string; label: string; reused?: boolean };

const SOURCER = `You are the art director checking a storyboard before anything is drawn. A scene is a VISUAL ACTION: what the viewer sees happen. The renderer can only (a) show a PICTURE with camera moves, crops, light and grade, and (b) draw type, numbers, simple shapes, lines, path trails, glows, particles, progress rings, buttons, badges and software-style interface elements (cards, chat bubbles, form fields, status pills, chips, counters, timelines, simple charts). It can NOT draw objects, characters, places or events (a wrench, a map, a clock, a valve, a basement, a pastry, a creature).
For each scene decide what makes it real:
- "picture_ok": the picture already assigned to it shows what the scene's action needs (the action may be a camera move, a light change or a reveal over that picture).
- "new_picture": the scene needs an object, character, place or event that the assigned picture does not show, or has no picture. Write "picture": the WHOLE FRAME of that exact moment as a picture, up to 45 words, vertical, naming subject, setting, pose or action, light and the visual style. Never any readable text, numbers, logos, signs or brand names, and no people. A character is a non-human object or creature shown in that pose.
- "reuse": ONLY when the scene's action is a camera move, a crop, light or an overlay (a trail, a pin, a glow) over the SAME picture as an earlier scene (a map, a room, one continuous set): give "reuse": that earlier scene's number. NEVER reuse a picture for an object or character that is in a different place or pose (a wrench that has moved, a creature that has turned, an object that has changed state): that is a "new_picture" showing it there.
- "graphics": the scene is only shapes, lines, glows, particles, a trail, a button, a badge or interface elements, over a colour or a picture, and needs no new picture.
- "type": the scene is only words or numbers.
A scene's words are never a description of what it shows. A JOURNEY through a world (a map, a land, a set) must feel like travelling: give each stage its OWN picture at a different scale and place, all in one art style and one lighting mood: the whole world seen from above, then a landmark seen up close from the path, then a different region or a small detail, then the destination. Never the same picture shown from slightly different crops. Use "reuse" only when the action is purely a camera move over the same picture, and keep those to at most one scene in four. use "new_picture" for each distinct pose, place or state of a character or object (a stop-motion story is a picture per pose). Never for the final call-to-action scene.
A character or object that recurs (a wrench, a creature, a cupcake) must look IDENTICAL in every picture: return "character": one sentence fixing its exact look (material, colour, shape, style) and the set it moves through, and write every picture prompt of that story in the same camera angle and set, with ONLY its pose and position in the frame changing step by step (it advances across the frame from picture to picture, so cutting between them reads as movement).
Reply with ONLY JSON: {"character": "one sentence or empty", "scenes": [{"scene": number, "kind": "picture_ok"|"new_picture"|"reuse"|"graphics"|"type", "picture": string, "reuse": number, "why": "up to 14 words"}]}`;

export async function sourceScenes(concept: Concept, strategy: Strategy | null, shows: Map<string, string>, complete: Complete): Promise<SceneSource[]> {
  let found = await sourcePlan(concept, strategy, shows, complete);
  // a journey that keeps looking at the same picture does not feel like travelling: when more than one scene in four reuses a picture, the art director is asked once more
  const reused = found.filter((f) => f.kind === 'reuse'); const allowed = Math.max(1, Math.floor(concept.scenes.length / 4));
  if (reused.length > allowed) {
    const again = await sourcePlan(concept, strategy, shows, (system, prompt) => complete(system, `${prompt}\n\nYOUR LAST ANSWER REUSED ONE PICTURE FOR SCENES ${reused.map((r) => r.scene).join(', ')}. Only ${allowed} scene(s) may reuse a picture. Give every other scene its own "new_picture": a different place, at a different scale, in the same art style and lighting mood.`));
    if (again.length) found = again;
  }
  // the same picture carrying more than two scenes (whatever the art director called them) is one picture looked at again: the extra scenes get a picture of their own, from what the scene does
  const holds = new Map<string, number[]>(); concept.scenes.forEach((scene, i) => { if (scene.photoId && scene.role !== 'closing') holds.set(scene.photoId, [...(holds.get(scene.photoId) ?? []), i + 1]); });
  for (const [id, scenes] of holds) for (const n of scenes.slice(2)) {
    if (shows.get(id) === undefined || found.some((f) => f.scene === n && f.kind === 'new_picture')) continue;
    const scene = concept.scenes[n - 1]; const rest = found.filter((f) => f.scene !== n);
    found = Object.assign([...rest, { scene: n, kind: 'new_picture' as const, picture: `${scene.visual}. A different place, at a different scale and from a different angle than ${shows.get(id)!.slice(0, 90)}, in exactly the same art style, light and mood.`.slice(0, 400), why: 'the picture already carries two scenes' }], { character: found.character });
  }
  return found.map((s) => (s.kind === 'new_picture' && s.picture && found.character && !s.picture.includes(found.character) ? { ...s, picture: `${found.character} ${s.picture}`.slice(0, 520) } : s));
}
async function sourcePlan(concept: Concept, strategy: Strategy | null, shows: Map<string, string>, complete: Complete): Promise<SceneSource[] & { character?: string }> {
  const lines = concept.scenes.map((scene, i) => `${i + 1}. [${scene.role}, ${scene.seconds}s, ${scene.shot?.composition ?? 'unspecified'}] action: ${scene.visual}${scene.headline || scene.subtext ? ` | words: ${[scene.headline, scene.subtext].filter(Boolean).join(' / ')}` : ''} | picture: ${scene.photoId ? `${(shows.get(scene.photoId) ?? 'a picture').slice(0, 160)} (${scene.photoId.slice(0, 8)})` : 'none'}`);
  const reply = await complete(SOURCER, `THE IDEA\n${strategy?.idea ? `${strategy.idea.type}: ${strategy.idea.title}. ${strategy.idea.logline}` : strategy?.narrative ?? ''}\nVISUAL LANGUAGE: ${strategy?.visual_language || strategy?.visual_notes || 'not given'}\n\nTHE STORYBOARD\n${lines.join('\n')}`).catch(() => '');
  let body: { scenes?: unknown } = {}; try { body = JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? '{}') as typeof body; } catch { /* no verdicts */ }
  const character = typeof (body as { character?: unknown }).character === 'string' ? ((body as { character: string }).character).replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const kinds = ['picture_ok', 'new_picture', 'reuse', 'graphics', 'type'];
  const out = (Array.isArray(body.scenes) ? body.scenes : []).flatMap((raw): SceneSource[] => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>; const scene = Math.round(Number(r.scene));
    if (!(scene >= 1 && scene <= concept.scenes.length) || !kinds.includes(String(r.kind))) return [];
    const reuse = Math.round(Number(r.reuse));
    return [{ scene, kind: r.kind as SceneSource['kind'], ...(typeof r.picture === 'string' && r.picture.trim() ? { picture: r.picture.replace(/\s+/g, ' ').trim().slice(0, 400) } : {}), ...(reuse >= 1 && reuse < scene ? { reuse } : {}), why: typeof r.why === 'string' ? r.why.slice(0, 120) : '' }];
  });
  return Object.assign(out, { character });
}

/** Applies the decisions: makes the missing pictures (at most `room` of them) and gives each scene its picture. Returns what was made and what was not. */
export async function applySources(concept: Concept, strategy: Strategy, sources: SceneSource[], opts: { request: string; room: number; generate?: (subject: string, look?: string, style?: string) => Promise<MadePicture | null> }): Promise<{ made: Array<{ id: string; label: string; subject: string; scene: number }>; notes: string[] }> {
  const made: Array<{ id: string; label: string; subject: string; scene: number }> = []; const notes: string[] = []; let room = opts.room;
  const look = [strategy.idea?.visual_style, strategy.colour_light, strategy.format, strategy.visual_notes].filter(Boolean).join('; ').slice(0, 260);
  for (const source of [...sources].sort((a, b) => a.scene - b.scene)) {
    const scene = concept.scenes[source.scene - 1]; if (!scene) continue;
    if (source.kind === 'reuse' && source.reuse) { const earlier = concept.scenes[source.reuse - 1]; if (earlier?.photoId) { scene.photoId = earlier.photoId; if (scene.shot && !scene.shot.camera) scene.shot = { ...scene.shot, camera: 'drift' }; notes.push(`scene ${source.scene} is another part of scene ${source.reuse}'s picture`); } continue; }
    if (source.kind !== 'new_picture' || !source.picture || scene.role === 'closing') continue;
    if (isInterfacePicture(source.picture)) { notes.push(`scene ${source.scene}: a screen is drawn in code, not generated`); continue; }
    if (!wantsPeople(opts.request) && showsPeople(source.picture)) { notes.push(`scene ${source.scene}: its picture would show a person, so it was not made`); continue; }
    if (!opts.generate || room <= 0) { notes.push(`scene ${source.scene} needs a picture ("${source.picture.slice(0, 70)}") but ${opts.generate ? 'the picture limit for this video was reached' : 'picture generation is not available'}`); continue; }
    const style = [scene.shot?.style, strategy.assets.art, strategy.visual_language].filter(Boolean).join('; ').slice(0, 200);
    const picture = await opts.generate(source.picture, look, style).catch(() => null);
    if (!picture) { notes.push(`scene ${source.scene}: its picture could not be made ("${source.picture.slice(0, 70)}")`); continue; }
    room -= 1; made.push({ id: picture.id, label: picture.label, subject: source.picture, scene: source.scene });
    scene.photoId = picture.id; if (scene.shot) scene.shot = { ...scene.shot, composition: scene.shot.composition === 'graphic_motion' || scene.shot.composition === 'typographic' ? 'full_frame_image' : scene.shot.composition };
    notes.push(`scene ${source.scene}: ${picture.reused ? 'reused' : 'made'} a picture of "${source.picture.slice(0, 80)}"`);
  }
  return { made, notes };
}

/** One line per scene saying what the viewer sees and where it comes from, for reading before anything is rendered. */
export function visualPlan(concept: Concept, shows: Map<string, string>, sources: SceneSource[]): string[] {
  return concept.scenes.map((scene, i) => {
    const source = sources.find((s) => s.scene === i + 1);
    const from = scene.photoId ? `picture: ${(shows.get(scene.photoId) ?? scene.photoId).slice(0, 90)}${source?.kind === 'reuse' ? ' (same world as an earlier scene)' : ''}` : source?.kind === 'type' ? 'type only' : 'drawn graphics only';
    return `${i + 1}. ${scene.seconds}s ${scene.role}: ${scene.visual.slice(0, 120)} | from ${from} | words: ${[scene.headline, scene.subtext].filter(Boolean).join(' / ') || 'none'}`;
  });
}
