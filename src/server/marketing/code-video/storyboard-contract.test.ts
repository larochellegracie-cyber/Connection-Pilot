import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { cleanShot, sanitizeConcept, type ConceptInput, type Shot } from './concept.js';
import { critique, fidelityText, storyboardContract, writeScript, type CodeBrief } from './generate.js';
import { RUNTIME_DIR } from './sandbox.js';

const run = promisify(execFile);
const python = path.join(process.cwd(), '.venv-codevideo/bin/python');
const fontDir = () => path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
const palette = { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' };

const shot1: Shot = { purpose: 'show the cover up close', subject: 'the cover and leaves', subject_at: { x: 0.3, y: 0.6 }, composition: 'detail_crop', text: 'headline', text_position: 'bottom_left', text_scale: 'large', camera: 'push_in', crop: 'tight', scrim: 'heavy', lighting: 'cold rim light', intensity: 'quiet' };
const shot2: Shot = { purpose: 'name the business', subject: 'the name itself', composition: 'typographic', text: 'type_only', text_position: 'fill', text_scale: 'dominant', scrim: 'none', lighting: 'a soft centred glow', intensity: 'medium' };
const scenes = [{ role: 'hook', seconds: 3, headline: 'Alpha one', subtext: '', items: [], photo: 'p1', visual: 'x', transition: 'whip', shot: shot1 }, { role: 'cta', seconds: 3, headline: 'Beta two', subtext: '', items: [], photo: null, visual: 'y', transition: 'fade', shot: shot2 }];

async function runner(dir: string, mode: string, script: string, over: Record<string, unknown> = {}) {
  const png = path.join(dir, 'p1.png'); const c = createCanvas(200, 300); const g = c.getContext('2d'); g.fillStyle = '#CC2222'; g.fillRect(0, 0, 100, 300); g.fillStyle = '#2222CC'; g.fillRect(100, 0, 100, 300); await writeFile(png, c.toBuffer('image/png'));
  const brief = { width: 540, height: 960, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: { p1: png }, palette, preview_dir: dir, preview_times: [1.2], require_motion: true, scenes, total_seconds: 6, ...over };
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), script);
  const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), mode], { env: {}, timeout: 120_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') }));
  return JSON.parse(stdout.trim().split('\n').pop() || '{}') as { ok: boolean; errors?: string[]; measured?: Array<Record<string, unknown>> };
}

const faithful = `def build(video):
    b = video.brief["scenes"]
    def one(c, t, u):
        c.camera("p1", u, "push", 1.0, t, zoom=1.8, at=(0.3, 0.6))
        c.fade(900, 1000, "#000000", 0.0, 0.85)
        c.text(b[0]["headline"], 84, 1300, 110, 800, "#FFFFFF", width=900)
        c.logo()
    def two(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.glow(c.W * (0.5 + 0.3 * math.sin(t)), 900, 900, "#3D6BFF", 0.4)
        c.text(b[1]["headline"], 540, 700, 150, 800, "#FFFFFF", align="center", width=900)
        c.logo()
    video.add_scene(3, one, "whip", 0.6)
    video.add_scene(3, two, "fade")
`;
const generic = `def build(video):
    b = video.brief["scenes"]
    def one(c, t, u):
        c.camera("p1", u, "pan_left", 1.0, t)
        c.text(b[0]["headline"], 540, 300, 50, 800, "#FFFFFF", align="center", width=900)
        c.logo()
    def two(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.fade(900, 1000, "#000000", 0.0, 0.6)
        c.text(b[1]["headline"], 84, 1500, 44, 800, "#FFFFFF", width=900)
        c.logo()
    video.add_scene(3, one, "fade")
    video.add_scene(3, two, "fade")
`;

describe('the storyboard is checked against the frames', () => {
  it('passes a script that does what each shot asked: text place and size, camera, crop, aim, scrim, picture, length and hand-over', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-')); try {
      const result = await runner(dir, '--lint', faithful);
      expect((result.errors ?? []).join('\n')).not.toMatch(/STORYBOARD MISMATCH/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('names each mismatch as scene, requirement, actual result, fix and what to keep, and does not blame the scene that matches', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sb2-')); try {
      const result = await runner(dir, '--lint', generic);
      const text = (result.errors ?? []).join('\n');
      expect(result.ok).toBe(false);
      expect(text).toMatch(/STORYBOARD MISMATCH, scene 1 \(Alpha one\):\nSTORYBOARD REQUIREMENT: [^\n]*text bottom left[^\n]*\nACTUAL RESULT: [^\n]*text top centre/);
      expect(text).toMatch(/camera push in[^\n]*camera pan_left|camera push in/); expect(text).toMatch(/tight crop/); expect(text).toMatch(/hands over by whip/);
      expect(text).toMatch(/a heavy scrim/); expect(text).toMatch(/PRESERVE: the scene's duration and transition/);
      expect(text).toMatch(/STORYBOARD MISMATCH, scene 2 \(Beta two\):/); expect(text).toMatch(/type fills the frame|dominant type/); expect(text).toMatch(/no scrim/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('catches a scene with words where the storyboard asked for none, and a different number of scenes', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sb3-')); try {
      const quiet = [{ ...scenes[0], shot: { ...shot1, text: 'none', text_position: undefined, text_scale: undefined } }, scenes[1]];
      const words = await runner(dir, '--lint', faithful, { scenes: quiet });
      expect((words.errors ?? []).join('\n')).toMatch(/no words on screen[^\n]*\nACTUAL RESULT: words on screen/);
      const merged = await runner(dir, '--lint', `def build(video):\n    b = video.brief["scenes"]\n    def one(c, t, u):\n        c.camera("p1", u, "push", 1.0, t, zoom=1.8, at=(0.3, 0.6))\n        c.text(b[0]["headline"], 84, 1300, 110, 800, "#FFFFFF", width=900)\n        c.logo()\n    video.add_scene(6, one, "fade")\n`);
      expect((merged.errors ?? []).join('\n')).toMatch(/storyboard has 2 scenes and the code adds 1/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('reports what each scene really contains, to read beside the storyboard', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sb4-')); try {
      const m = (await runner(dir, '--measure', faithful)).measured!;
      expect(m[0]).toMatchObject({ scene: 1, transition: 'whip', assets: ['p1'], text: { align: 'left', row: 2 } }); expect((m[0].cams as Array<{ zoom: number; at: boolean }>)[0]).toMatchObject({ zoom: 1.8, at: true });
      expect(m[1]).toMatchObject({ scene: 2, text: { align: 'center', size: 150 } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('the camera can really do a tight crop aimed at a subject', () => {
  it('lands on the left or the right of the picture when aimed there', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'aim-')); try {
      const at = async (x: number) => { await runner(dir, '--preview', `def build(video):\n    def a(c, t, u):\n        c.camera("p1", u, "push", 0.3, t, zoom=2.5, at=(${x}, 0.5))\n    video.add_scene(3, a, "fade")\n`); const { stdout } = await run(python, ['-I', '-c', `from PIL import Image\nim=Image.open(${JSON.stringify(path.join(dir, 'frame_00.jpg'))}).convert('RGB')\nprint(*im.getpixel((im.width//2, im.height//2)))`], { env: {} }); return stdout.trim().split(' ').map(Number); };
      const left = await at(0.1); const right = await at(0.9);
      expect(left[0]).toBeGreaterThan(left[2]); expect(right[2]).toBeGreaterThan(right[0]); // red on the left of the picture, blue on the right
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('the storyboard shot', () => {
  it('keeps only known words, makes the fields agree, and never guesses what was not said', () => {
    const shot = cleanShot({ purpose: 'p', subject: 's', lighting: 'l', composition: 'typographic', text: 'none', camera: 'warp_speed', crop: 'TIGHT', subject_at: { x: 2, y: -1 } })!;
    expect(shot.camera).toBeUndefined(); expect(shot.crop).toBe('tight'); expect(shot.subject_at).toEqual({ x: 1, y: 0 });
    expect(shot).toMatchObject({ text: 'type_only', text_scale: 'dominant', text_position: 'fill' }); // typography is words, and it dominates
    expect(cleanShot({ purpose: 'p', subject: 's', lighting: '', text: 'none', text_position: 'top_left', text_scale: 'small' })).not.toHaveProperty('text_position');
  });
  it('makes the words on screen follow the shot: none means none, headline-only has no supporting line, and the sign-off always has words', () => {
    const input = { request: 'x', subject: 'pool closing', seconds: 12, business: { name: 'Somerset', type: 'Pool', location: '', services: [], description: '', tone: '' }, photos: [], props: [] } as ConceptInput;
    const mk = (i: number, shot: Record<string, unknown>) => ({ role: i === 0 ? 'hook' : 'scene', seconds: 3, headline: `Line ${i}`, subtext: 'support', items: ['a thing'], visual: 'v', photo: null, shot: { purpose: 'p', subject: 's', lighting: 'l', ...shot } });
    const concept = sanitizeConcept({ scenes: [mk(0, { text: 'none' }), mk(1, { text: 'headline' }), mk(2, { text: 'headline_sub' }), { ...mk(3, { text: 'none' }), role: 'closing' }] }, input)!;
    expect(concept.scenes[0]).toMatchObject({ headline: '', subtext: '', items: [] }); expect(concept.scenes[1].subtext).toBe(''); expect(concept.scenes[2].subtext).toBe('support');
    expect(concept.scenes.at(-1)!.shot!.text).not.toBe('none'); expect(concept.scenes.at(-1)!.headline).toBe('Somerset');
  });
});

describe('the code writer is given the contract', () => {
  const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'Somerset' }, palette: {}, assets: { p1: 'x' }, photos: [{ name: 'p1', label: 'Cover', width: 1, height: 1, orientation: 'portrait', shows: 'a pool cover' }], scenes, total_seconds: 6 } as CodeBrief;
  it('turns each shot into the exact toolkit calls and parameters', () => {
    const text = storyboardContract(brief);
    expect(text).toMatch(/Write exactly 2 scenes/); expect(text).toMatch(/c\.camera\("p1", u, "push", \.\.\., zoom=1\.8, at=\(0\.30, 0\.60\)\)/); expect(text).toMatch(/bottom left \(align="left"\)/); expect(text).toMatch(/large type \(size about 100-130\)/); expect(text).toMatch(/Scrim: heavy/);
    expect(text).toMatch(/type that FILLS the frame/); expect(text).toMatch(/dominant type \(size 140 or more/); expect(text).toMatch(/Scene 2 → code scene 2/);
    expect(storyboardContract({ ...brief, scenes: scenes.map((s) => ({ ...s, shot: undefined })) })).toBe('');
  });
  it('puts the contract in the writer’s prompt, and forbids merging scenes', async () => {
    let prompt = '';
    await writeScript({ brief, style: 'custom', complete: async (_s, p) => { prompt = p; return { text: 'def build(video):\n    pass' }; }, check: async () => [] });
    expect(prompt).toMatch(/STORYBOARD CONTRACT/); expect(prompt).toMatch(/never merge, drop or add a scene/);
  });
});

describe('fidelity is scored per scene and says why a scene fell short', () => {
  const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'S' }, palette: {}, assets: {}, scenes, total_seconds: 6 } as CodeBrief;
  it('reads each scene’s fidelity and its cause, ignores scenes without a shot, and turns a low one into a repair', async () => {
    const result = await critique({ sheet: Buffer.from('x'), brief: { ...brief, scenes: [...scenes, { ...scenes[1], shot: undefined }] }, complete: async () => ({ text: JSON.stringify({ score: 6, fidelity: [{ scene: 1, score: 9, cause: 'none', note: 'matches' }, { scene: 2, score: 3, cause: 'code', note: 'small left-aligned text instead of full-frame type' }, { scene: 3, score: 5, cause: 'code', note: 'x' }, { scene: 7, score: 5, cause: 'code', note: 'no such scene' }], findings: [] }) }) });
    expect(result?.fidelity?.map((f) => f.scene)).toEqual([1, 2]); expect(result?.fidelity_overall).toBe(6);
    const text = fidelityText(brief, result!.fidelity![1]);
    expect(text).toMatch(/STORYBOARD FIDELITY, scene 2 \(3\/10, cause: code\):/); expect(text).toMatch(/ACTUAL RESULT: small left-aligned text/); expect(text).toMatch(/PRESERVE:/);
  });
});

describe('alignment is read from where the block sits, not from how its words were drawn', () => {
  it('reads centred, right and left blocks made with reveal_text (which draws each word on its own) correctly, and lets a shot that says no words stand', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'al-')); try {
      const four = [0, 1, 2, 3].map((i) => ({ role: 'scene', seconds: 3, headline: ['Alpha one', 'Beta two', 'Gamma three', ''][i], subtext: '', items: [], photo: null, visual: 'v', transition: 'fade', shot: { purpose: 'p', subject: 's', lighting: 'l', text: i === 3 ? 'none' : 'headline', text_position: ['top_center', 'bottom_right', 'middle_left', undefined][i], text_scale: 'medium' } }));
      const script = `def build(video):
    b = video.brief["scenes"]
    def a(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")
        c.reveal_text(b[0]["headline"], 540, 200, 84, 800, "#FFFFFF", t, start=0.0, align="center", width=880)
        c.logo()
    def d(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")
        c.reveal_text(b[1]["headline"], 996, 1500, 84, 800, "#FFFFFF", t, start=0.0, align="right", width=880)
        c.logo()
    def e(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")
        c.reveal_text(b[2]["headline"], 84, 900, 84, 800, "#FFFFFF", t, start=0.0, align="left", width=880)
        c.logo()
    def f(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")
        c.logo()
    video.add_scene(3, a, "fade")
    video.add_scene(3, d, "fade")
    video.add_scene(3, e, "fade")
    video.add_scene(3, f, "fade")
`;
      const result = await runner(dir, '--lint', script, { scenes: four });
      const text = (result.errors ?? []).join('\n');
      expect(text).not.toMatch(/STORYBOARD MISMATCH/); expect(text).not.toMatch(/Scene 4 has no words/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
