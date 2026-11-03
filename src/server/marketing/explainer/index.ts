import { mkdir, stat, writeFile } from 'node:fs/promises';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { exportAssets } from '../code-video/index.js';
import { codeVideoSupport, runSandboxed } from '../code-video/sandbox.js';
import type { CodeBrief } from '../code-video/generate.js';
import { musicProfile } from '../music.js';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { paletteFor } from '../standard-video/plan-layout.js';
import type { AssetMeta, MediaStorage } from '../standard-video/storage.js';
import type { BrandKit } from '../standard-video/templates.js';
import { mixSound } from './audio.js';
import { type ExplainerScene, type ExplainerStoryboard, type CompleteText, writeExplainerStoryboard } from './storyboard.js';
import { narrate, type Narration } from './voiceover.js';
import type { Blueprint, Geo } from '../reference/style.js';

/**
 * Explainer video: the clean product-explainer style (floating task bubbles, forms that fill in, a schedule that builds itself, a chat, a friendly
 * character) with a voiceover, drawn from the business's own words and brand. A text model writes a storyboard (JSON, checked by plain code); a
 * voice speaks each scene; the scenes are timed to the speech; the picture is drawn by Pilot's scene library (Pillow + FFmpeg, in the sandbox); and the
 * voice and original music are mixed under it. No Runway. Costs: one text call, plus the voice if OpenAI's is used (about a cent). Any failure returns
 * { ok: false } and the caller makes an ordinary free video instead.
 */
export type ExplainerResult = { ok: true; seconds: number; voiceover: 'openai' | 'system' | null; scenes: Array<{ role: string; seconds: number; headline: string; subtext: string }>; storyboard: ExplainerStoryboard; script: string; ducked: boolean; note: string } | { ok: false; reason: string };

const TRANSITIONS = ['fade', 'wipe', 'iris', 'zoom', 'push'] as const;
const MIN_SECONDS = 3.2;
const MAX_SECONDS = 16;

const strings = (scene: ExplainerScene): string[] => {
  switch (scene.type) {
    case 'intro': case 'chaos': case 'orbit': return [scene.headline, scene.subtext, ...scene.labels];
    case 'form': return [scene.title, scene.button, scene.success, ...scene.fields.flat()];
    case 'schedule': return [scene.title, ...scene.entries.map((entry) => entry[2])];
    case 'chat': return [scene.title, ...scene.messages.map((message) => message[1])];
    case 'steps': return [scene.headline, ...scene.items];
    case 'photo': return [scene.headline, scene.subtext];
    case 'swap': return [scene.lead, ...scene.words, scene.tail, scene.brandLine, scene.cta, ...scene.items];
    case 'cta': return [scene.headline];
  }
};

/** How long a scene's own animation needs, before the narration is considered. */
export function minimumSeconds(scene: ExplainerScene): number {
  switch (scene.type) {
    case 'intro': return 4.4;
    case 'orbit': return Math.min(10, Math.max(6, scene.labels.length * 0.4 + 3.4));
    case 'chaos': return Math.min(9, Math.max(5.5, scene.labels.length * 0.32 + 2.6));
    case 'form': return 1.0 + scene.fields.length * 0.95 + 2.3;
    case 'schedule': return 1.6 + scene.entries.length * 0.62 + 1.8;
    case 'chat': return 1.0 + scene.messages.length * 1.5 + 1.2;
    case 'steps': return 1.2 + scene.items.length * 0.6 + 2.0;
    case 'photo': return 4.5;
    case 'swap': return 1.4 + scene.words.length * 1.5 + 1.2;
    case 'cta': return 5;
  }
}

/** Each scene's length: long enough for its animation and for its narration (which starts a moment in and finishes before the next scene). */
export function sceneSeconds(storyboard: ExplainerStoryboard, spoken: number[], wanted: number[] = []): number[] {
  return storyboard.scenes.map((scene, i) => Math.ceil(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, minimumSeconds(scene), wanted[i] ?? 0, spoken[i] ? spoken[i] + 1.0 : 0)) * 10 - 1e-9) / 10);
}

const q = (value: string) => JSON.stringify(value);
const list = (items: string[]) => `[${items.map(q).join(', ')}]`;

/** The Python that tells the storyboard with Pilot's explainer scenes: plain calls with literal words, no logic. It goes through the same checks and sandbox as any code-written video. */
export function buildScript(storyboard: ExplainerStoryboard, seconds: number[], photoOf: (name: string | null) => string | null, transitions: Array<string | undefined> = [], geos: Array<Geo | undefined> = []): string {
  let last = ''; let photoScenes = 0;
  const next = (i = 0) => { if (transitions[i] && (TRANSITIONS as readonly string[]).includes(transitions[i]!)) { last = transitions[i]!; return last; } const choices = TRANSITIONS.filter((t) => t !== last); last = choices[(last.length + seconds.length) % choices.length]; return last; };
  const lines = storyboard.scenes.map((scene, i) => {
    const s = seconds[i]; const t = next(i); const g = geos[i]; const n = (v: number) => Math.round(v * 1000) / 1000; const photo = 'photo' in scene ? (photoOf(scene.photo) ?? (scene.type === 'cta' ? photoOf('p1') : null)) : null; const ch = q(storyboard.character);
    switch (scene.type) {
      case 'intro': return `    video.explainer_intro(${q(scene.headline)}, ${q(scene.subtext)}, labels=${list(scene.labels)}, character=${ch}, seconds=${s}, transition=${q(t)}${g ? `, head_y=${n(g.headY)}, char_y=${n(g.cy)}, char_r=${n(Math.max(110, g.charR))}, align=${q(g.align)}, head_size=${n(g.headSize)}` : ''})`;
      case 'orbit': return `    video.explainer_orbit(${q(scene.headline)}, ${q(scene.subtext)}, labels=${list(scene.labels)}, character=${ch}, seconds=${s}, transition=${q(t)}${g ? `, cx=${n(g.cx)}, cy=${n(g.cy)}, rx=${n(g.rx)}, ry=${n(g.ry)}, speed=${n(g.speed)}, char_r=${n(g.charR)}, head_y=${n(g.headY)}, align=${q(g.align)}, head_size=${n(g.headSize)}, stagger=${n(g.stagger)}, shape=${q(g.shape)}` : ''})`;
      case 'chaos': return `    video.explainer_chaos(${list(scene.labels)}, ${q(scene.headline)}, ${q(scene.subtext)}, seconds=${s}, transition=${q(t)}${g ? `, head_y=${n(Math.max(0.5, g.headY))}, align=${q(g.align)}, head_size=${n(g.headSize)}` : ''})`;
      case 'form': return `    video.explainer_form(${q(scene.title)}, [${scene.fields.map(([a, b]) => `(${q(a)}, ${q(b)})`).join(', ')}], button=${q(scene.button)}, success=${q(scene.success)}, seconds=${s}, character=${ch}, transition=${q(t)})`;
      case 'schedule': return `    video.explainer_schedule(${q(scene.title)}, [${scene.entries.map(([d, slot, l]) => `(${q(d)}, ${slot}, ${q(l)})`).join(', ')}], seconds=${s}, character=${ch}, transition=${q(t)})`;
      case 'chat': return `    video.explainer_chat([${scene.messages.map(([w, m]) => `(${q(w)}, ${q(m)})`).join(', ')}], title=${q(scene.title)}, seconds=${s}, character=${ch}, transition=${q(t)})`;
      case 'steps': return `    video.steps_timeline(${q(scene.headline)}, ${list(scene.items)}, seconds=${s}, photo=${photo ? q(photo) : 'None'}, transition=${q(t)})`;
      case 'photo': {
        if (!photo) return `    video.statement_kinetic(${q(scene.headline)}, ${q(scene.subtext)}, seconds=${s}, transition=${q(t)})`;
        photoScenes += 1;
        return photoScenes === 1 ? `    video.hook_kinetic(${q(photo)}, ${q(scene.headline)}, ${q(scene.subtext)}, seconds=${s}, transition=${q(t)})` : `    video.feature_float(${q(photo)}, ${q(scene.headline)}, ${q(scene.subtext)}, seconds=${s}, layout=${q(photoScenes % 2 ? 'stack' : 'side')}, flip=${photoScenes % 2 ? 'False' : 'True'}, transition=${q(t)})`;
      }
      case 'swap': return `    video.explainer_swap(${q(scene.lead)}, ${list(scene.words)}, tail=${q(scene.tail)}, card=${q(scene.card)}, items=${list(scene.items)}, brand_line=${q(scene.brandLine)}, cta=${q(scene.cta)}, seconds=${s}, transition=${q(t)})`;
      case 'cta': if (storyboard.theme === 'light') return `    video.explainer_cta(${q(scene.headline)}, photo=${photo ? q(photo) : 'None'}, seconds=${s}, transition=${q(t)})`; return `    video.cta_pro(${q(scene.headline)}, seconds=${s}, photo=${photo ? q(photo) : 'None'}, transition=${q(t)})`;
    }
  });
  return `def build(video):\n${storyboard.theme === 'light' ? '    video.theme("light")\n' : storyboard.glow && Math.abs(storyboard.glow - 1) > 0.05 ? `    video.theme("dark", glow=${storyboard.glow})\n` : ''}${lines.join('\n')}\n`;
}

export type ExplainerInput = {
  tenantId: string; request: string; kit: BrandKit; logoId: string | null; storage: MediaStorage; workDir: string; outPath: string;
  business: { name: string; type: string; location: string; services: string[]; description: string; tone: string };
  /** photos that fit the subject (the owner's, or a generated image) */ photos: AssetMeta[];
  style: string[]; instructions: string[]; targetSeconds?: number; seed?: string;
  /** the structure copied from the owner's reference video (scene kinds, lengths, transitions, look, voice or no voice) */ blueprint?: Blueprint | null;
  complete: CompleteText; speak?: (text: string, file: string) => Promise<void>; voiceProvider?: 'openai' | 'system' | null;
};

export async function renderExplainer(input: ExplainerInput): Promise<ExplainerResult> {
  try {
    const support = await codeVideoSupport();
    if (!support.ok || !support.python || !support.sandbox) return { ok: false, reason: support.reason };
    const ffmpeg = ffmpegPath(); if (!ffmpeg) return { ok: false, reason: 'FFmpeg is not available.' };
    const dir = path.join(input.workDir, 'explainer'); await mkdir(dir, { recursive: true });
    const photoNames = input.photos.slice(0, 4).map((photo, i) => ({ name: `p${i + 1}`, label: photo.label.replace(/^(?:From website|Made by Pilot|AI image) [–-] /, ''), id: photo.id }));
    const character = /\bpilot\b/i.test(input.request) ? 'pilot' as const : 'logo' as const;
    const storyboard = await writeExplainerStoryboard({ request: input.request, business: input.business, photos: photoNames, character, targetSeconds: input.blueprint ? Math.round(input.blueprint.slots.reduce((sum, slot) => sum + slot.seconds, 0)) : input.targetSeconds ?? 35, blueprint: input.blueprint }, input.complete);
    if (!storyboard) return { ok: false, reason: 'The storyboard could not be written.' };

    // the voice, then the scene lengths that follow from it
    const narration: Narration = input.blueprint?.voice === false ? { provider: null, files: storyboard.scenes.map(() => null), seconds: storyboard.scenes.map(() => 0) } : await narrate({ lines: storyboard.scenes.map((scene) => scene.narration), workDir: dir, provider: input.voiceProvider, speak: input.speak });
    const seconds = sceneSeconds(storyboard, narration.seconds, input.blueprint?.slots.map((slot) => slot.seconds));
    const total = Math.round(seconds.reduce((a, b) => a + b, 0) * 10) / 10;

    // pictures and the brief the scene library reads (every string on screen is listed, so the on-screen text rule can check it)
    const { assets } = await exportAssets({ tenantId: input.tenantId, plan: { summary: { photosUsed: photoNames.map(({ id, label }) => ({ id, label })) } } as never, logoId: input.logoId, kit: input.kit, storage: input.storage, dir });
    const p = paletteFor(input.kit); const { createRequire } = nodeModule; const fontDir = path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
    const brief: CodeBrief = {
      width: 1080, height: 1920, fps: 30, ffmpeg, font_dir: fontDir, out: path.join(dir, 'silent.mp4'), budget_seconds: 440, brand: { name: input.kit.name }, assets,
      palette: { dark: p.dark, bg_a: p.bgA, bg_b: p.bgB, text: p.text, accent: p.accent, on_accent: p.onAccent, glow: p.glow, glow2: p.glow2, scrim: p.scrim },
      scenes: [{ role: 'explainer', seconds: total, headline: storyboard.title, subtext: '', photo: null, visual: null, items: [...storyboard.scenes.flatMap(strings), 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter(Boolean) }], total_seconds: total,
    };
    const briefPath = path.join(dir, 'brief.json'); await writeFile(briefPath, JSON.stringify(brief));
    const script = buildScript(storyboard, seconds, (name) => (name && assets[name] ? name : null), input.blueprint?.slots.map((slot) => slot.transition) ?? [], input.blueprint?.slots.map((slot) => slot.geo) ?? []);
    const scriptPath = path.join(dir, 'scene_script.py'); await writeFile(scriptPath, script);
    const args = { python: support.python, sandbox: support.sandbox, jobDir: input.workDir, briefPath, scriptPath, fontDir, ffmpegPath: ffmpeg };
    // the safety check starts Python cold and can be slow on a busy machine: two minutes, and one more try if it is cut off
    let checked = await runSandboxed({ ...args, checkOnly: true, timeoutMs: 120_000 });
    if (!checked.ok && checked.timedOut) checked = await runSandboxed({ ...args, checkOnly: true, timeoutMs: 120_000 });
    if (!checked.ok) return { ok: false, reason: checked.errors[0] ?? 'The explainer failed its safety check.' };
    let drawn = await runSandboxed({ ...args, timeoutMs: 1_800_000 });
    if (!drawn.ok && /stopped without a result/i.test(drawn.errors[0] ?? '')) drawn = await runSandboxed({ ...args, timeoutMs: 1_800_000 }); // the drawing process can be stopped by the machine (low memory, sleep): once more
    if (!drawn.ok) return { ok: false, reason: drawn.errors[0] ?? 'The explainer could not be drawn.' };
    if (!(await stat(brief.out).then((file) => file.size > 10_000).catch(() => false))) return { ok: false, reason: 'The explainer file was not created.' };

    // the sound: narration starts a moment into each scene; original music sits underneath and dips whenever the voice speaks
    let at = 0; const clips = storyboard.scenes.flatMap((_, i) => { const clip = narration.files[i] ? [{ file: narration.files[i]!, startSeconds: at + 0.4 }] : []; at += seconds[i]; return clip; });
    const profile = musicProfile([...input.style, ...(input.blueprint?.musicStyle ?? [])], input.instructions, input.seed ?? 'explainer') ?? musicProfile(['soft'], [], input.seed ?? 'explainer');
    const mixed = await mixSound({ videoPath: brief.out, outPath: input.outPath, voice: clips, music: profile, seed: input.seed ?? 'explainer', workDir: dir });
    const voiceNote = input.blueprint?.voice === false ? 'No voiceover (the reference has none).' : narration.provider === 'openai' ? 'Voiceover: OpenAI voice.' : narration.provider === 'system' ? 'Voiceover: this computer’s built-in voice (free).' : 'No voiceover.';
    return { ok: true, seconds: mixed.seconds, voiceover: narration.provider, scenes: storyboard.scenes.map((scene, i) => ({ role: scene.type, seconds: seconds[i], headline: 'headline' in scene ? scene.headline : 'lead' in scene ? [scene.lead, scene.words[0]].join(' ') : scene.title, subtext: 'subtext' in scene ? scene.subtext : '' })), storyboard, script, ducked: mixed.ducked, note: `${voiceNote}${profile ? ` Music: ${profile.name}, original, made for this video.` : ''}` };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : 'The explainer could not be made.' }; }
}
