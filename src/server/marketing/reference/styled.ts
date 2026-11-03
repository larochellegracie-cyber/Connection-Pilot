import type { ReferenceAnalysis, VideoStyle } from './style.js';
import { cameraFrom, type CameraMove, type VideoLook } from './look.js';
import type { LogoPosition } from './logo.js';
import { colourDistance } from './colour.js';

/**
 * The plan for a video that follows a reference's STYLE shot by shot: how long each shot is, how the camera moves in it (a push in, a pan, a tilt, handheld or still) and how
 * much, how it joins the next shot (a hard cut, a dissolve, a wipe, a zoom, a push), how tightly it is framed; plus what runs through the whole video: the colour grade,
 * the overlays, the type of the words and how they come in, where the logo sits, and the rhythm. Worked out from what was MEASURED in the reference (cuts, camera, colour,
 * bars, grain) with what the vision step described (text, overlays, rhythm) filling in the rest. Nothing of the reference's pictures or words is in it.
 */
export type StyledTransition = 'cut' | 'fade' | 'wipe' | 'zoom' | 'push' | 'iris';
export type StyledScene = { seconds: number; role: 'hook' | 'scene' | 'closing'; camera: { move: CameraMove; amount: number }; transition: StyledTransition; framing: 'wide' | 'medium' | 'close' };
export type StyledSpec = { scenes: StyledScene[]; totalSeconds: number; pacing: 'fast' | 'medium' | 'slow'; look: VideoLook; video: VideoStyle; logo: { position: LogoPosition } | null; format: '9:16' | '1:1' | '16:9' | '4:5' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildStyledSpec(analysis: Pick<ReferenceAnalysis, 'measures' | 'style'>, targetSeconds?: number | null): StyledSpec {
  const { measures, style } = analysis; const video = style.video!; const look = measures.look ?? { brightness: 0.5, contrast: 0.5, saturation: 0.4, warmth: 0, tint: 'neutral' as const, vignette: 0, letterbox: 0, grain: 0, fade: 0 };
  const parts = measures.segments.length ? measures.segments : [{ index: 1, start: 0, end: measures.seconds, seconds: measures.seconds, brightness: 0.5, motion: 0, colours: [] as string[] } as never];
  const average = measures.seconds / Math.max(1, parts.length); const pacing = average < 2.8 ? 'fast' : average > 6 ? 'slow' : 'medium';
  const minShot = pacing === 'fast' ? 0.9 : pacing === 'medium' ? 1.5 : 2.2; const total = clamp(targetSeconds ?? measures.seconds, 6, 30);
  // the shots of the reference, joined where they would be too short at the length asked for, and never more than ten
  type Shot = { seconds: number; camera: { move: CameraMove; amount: number }; boundary?: 'cut' | 'dissolve'; spread: number };
  let shots: Shot[] = parts.map((seg) => { const g = seg.geometry; return { seconds: seg.seconds, boundary: seg.boundary, spread: g?.subject.spread ?? 0.2, camera: cameraFrom({ zoom: g?.zoom, dx: g ? -g.drift.dx : 0, dy: g ? -g.drift.dy : 0, motion: seg.motion }) }; });
  const scale = total / Math.max(0.1, shots.reduce((s, x) => s + x.seconds, 0)); shots = shots.map((s) => ({ ...s, seconds: s.seconds * scale }));
  while (shots.length > 1 && (shots.length > 10 || shots.some((s) => s.seconds < minShot))) { let at = 0; for (let i = 1; i < shots.length; i += 1) if (shots[i].seconds < shots[at].seconds) at = i; const join = at === shots.length - 1 ? at - 1 : at; const a = shots[join]; const b = shots[join + 1]; shots.splice(join, 2, { seconds: a.seconds + b.seconds, camera: a.seconds >= b.seconds ? a.camera : b.camera, boundary: a.boundary, spread: Math.max(a.spread, b.spread) }); }
  const lead = video.cuts; const join = (boundary?: 'cut' | 'dissolve'): StyledTransition => boundary === 'dissolve' || lead === 'dissolves' ? 'fade' : lead === 'wipes' ? 'wipe' : lead === 'zoom_punches' ? 'zoom' : lead === 'whips' ? 'push' : boundary === 'cut' || lead === 'hard_cuts' ? 'cut' : 'fade';
  const scenes: StyledScene[] = shots.map((s, i) => ({ seconds: Math.round(s.seconds * 10) / 10, role: i === 0 ? 'hook' : i === shots.length - 1 ? 'closing' : 'scene', camera: video.camera === 'still' ? { move: 'static', amount: 0 } : s.camera.move === 'static' && (video.camera === 'slow_push' || video.camera === 'ken_burns') ? { move: i % 2 ? 'pan_right' : 'push_in', amount: 0.3 } : s.camera, transition: i === 0 ? 'fade' : join(shots[i].boundary), framing: s.spread > 0.3 ? 'wide' : s.spread < 0.13 ? 'close' : 'medium' }));
  // each scene's transition is how it BEGINS; the renderer wants how a scene ENDS (into the next), so shift by one
  const ends = scenes.map((_, i) => (i < scenes.length - 1 ? scenes[i + 1].transition : 'fade' as StyledTransition));
  scenes.forEach((s, i) => { s.transition = ends[i]; });
  const sumSeconds = scenes.reduce((s, x) => s + x.seconds, 0); const format = measures.vertical ? '9:16' : Math.abs(measures.width / measures.height - 1) < 0.1 ? '1:1' : '16:9';
  return { scenes, totalSeconds: Math.round(sumSeconds * 10) / 10, pacing, look, video, logo: style.logo?.present ? { position: style.logo.position } : null, format };
}

/**
 * How different the shots of a reference are from one another: the mean colour distance between the backdrops of its shots. A product advert keeps one set and one backdrop
 * (low); a montage of different pictures changes backdrop shot to shot (high). Used to tell the two apart however a model labelled the video.
 */
export function shotVariety(measures: Pick<ReferenceAnalysis['measures'], 'segments'>): number {
  const colours = measures.segments.map((s) => s.geometry?.colours?.background).filter((c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c)); if (colours.length < 2) return 0;
  let total = 0; let count = 0; for (let i = 1; i < colours.length; i += 1) { total += colourDistance(colours[i - 1], colours[i]); count += 1; } return total / count;
}
export const MONTAGE_VARIETY = 85;
