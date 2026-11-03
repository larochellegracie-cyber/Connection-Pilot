import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { sanitizeConcept, type ConceptInput } from './concept.js';
import { critique, findingText, storyForCritic, type CodeBrief } from './generate.js';
import { RUNTIME_DIR } from './sandbox.js';

const run = promisify(execFile);
const python = path.join(process.cwd(), '.venv-codevideo/bin/python');
const fontDir = () => path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
const palette = { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' };

/** Runs a script through the real runner in one mode and returns its JSON line. */
async function runner(dir: string, mode: string, script: string, over: Record<string, unknown> = {}) {
  const logo = path.join(dir, 'logo.png'); const canvas = createCanvas(200, 100); const g = canvas.getContext('2d'); g.fillStyle = '#E8590C'; g.fillRect(0, 0, 200, 100); await writeFile(logo, canvas.toBuffer('image/png'));
  const scenes = ['Alpha one', 'Beta two', 'Gamma three', 'Delta four'].map((headline) => ({ role: 'scene', seconds: 3, headline, subtext: '', items: [], photo: null, visual: null }));
  const brief = { width: 540, height: 960, fps: 30, ffmpeg: 'x', font_dir: fontDir(), out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: { logo }, palette, preview_dir: dir, preview_times: [1.0], require_motion: true, scenes, total_seconds: 12, ...over };
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), script);
  const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'b.json'), path.join(dir, 's.py'), mode], { env: {}, timeout: 120_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') }));
  return JSON.parse(stdout.trim().split('\n').pop() || '{}') as { ok: boolean; errors?: string[] };
}
const brightness = async (dir: string, box: [number, number, number, number]) => {
  const { stdout } = await run(python, ['-I', '-c', `from PIL import Image\nim=Image.open(${JSON.stringify(path.join(dir, 'frame_00.jpg'))}).convert('L').crop(${JSON.stringify(box)})\nprint(sum(im.getdata())/ (im.width*im.height))`], { env: {} });
  return Number(stdout.trim());
};

describe('the logo primitive survives being put in a container', () => {
  it('fits and shows the logo inside a small container with a dark backing, instead of clipping it away', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'logo-')); try {
      const inBox = await runner(dir, '--preview', `def build(video):
    def a(c, t, u):
        c.fill("#000000")
        c.push(700, 200, 220, 88)
        c.rect(0, 0, 220, 88, "#111111", radius=16, alpha=0.66)
        c.logo()
        c.pop()
    video.add_scene(3, a, "fade")`);
      expect(inBox).toEqual(expect.objectContaining({ ok: true }));
      expect(await brightness(dir, [360, 105, 450, 140])).toBeGreaterThan(60); // the logo's own white chip is there (a clipped logo leaves only the dark backing, about 10)
      const alone = await runner(dir, '--preview', `def build(video):
    def a(c, t, u):
        c.fill("#000000")
        c.logo()
    video.add_scene(3, a, "fade")`);
      expect(alone.ok).toBe(true); expect(await brightness(dir, [46, 140, 116, 176])).toBeGreaterThan(60); // unchanged on its own: top left, below the safe margin
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('repetitive composition is measured, and variety that has a reason is left alone', () => {
  it('sends back three consecutive scenes with the same headline position, size and scrim', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rep-')); try {
      const same = (i: number) => `    def a${i}(c, t, u):\n        c.gradient("#071033", "#0E1B4D", 180)\n        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n        c.fade(900, 900, "#071033", 0.0, 0.8)\n        c.text(video.brief["scenes"][${i}]["headline"], 84, 1300, 100, 800, "#FFFFFF")\n        c.logo()\n    video.add_scene(3, a${i}, "fade")\n`;
      const found = await runner(dir, '--lint', `def build(video):\n${[0, 1, 2, 3].map(same).join('')}`);
      expect(found.ok).toBe(false); expect(found.errors?.join(' ')).toMatch(/Scenes 1, 2, 3, 4 have the same composition: the headline sits bottom left/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not complain when the scenes are composed differently (a centred title, a left headline with a scrim, no words at all)', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rep2-')); try {
      const move = '        c.rect(84, 300, 900 * ((t % 2.0) / 2.0), 30, "#2F6BFF")\n';
      const varied = `def build(video):
    b = video.brief["scenes"]
    def a(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
${move}        c.fade(900, 900, "#071033", 0.0, 0.8)
        c.text(b[0]["headline"], 84, 1300, 100, 800, "#FFFFFF")
        c.logo()
    def d(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
${move}        c.text(b[1]["headline"], 540, 800, 110, 800, "#FFFFFF", align="center")
        c.logo()
    def e(c, t, u):
        c.gradient("#0E1B4D", "#071033", 180)
${move}        c.text(b[2]["headline"], 84, 300, 70, 800, "#FFFFFF")
        c.logo()
    def f(c, t, u):
        c.gradient("#071033", "#0E1B4D", 180)
${move}        c.fade(300, 500, "#071033", 0.0, 0.5)
        c.text(b[3]["headline"], 84, 1300, 100, 800, "#FFFFFF")
        c.logo()
    video.add_scene(3, a, "fade")
    video.add_scene(3, d, "fade")
    video.add_scene(3, e, "fade")
    video.add_scene(3, f, "fade")
`;
      const result = await runner(dir, '--lint', varied);
      expect((result.errors ?? []).join(' ')).not.toMatch(/same composition/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('the critic says what is wrong and where', () => {
  const brief = { width: 1080, height: 1920, fps: 30, ffmpeg: '', font_dir: '', out: '', brand: { name: 'Somerset' }, palette: {}, assets: {}, photos: [{ name: 'p1', label: 'Pouring salt', width: 1, height: 1, orientation: 'portrait', shows: 'hands pouring powder into a pool' }], scenes: [{ role: 'hook', seconds: 3, headline: 'Winter is coming', subtext: '', items: [], photo: 'p1', visual: 'slow push-in', transition: 'whip' }, { role: 'scene', seconds: 3, headline: 'Balanced water', subtext: '', items: [], photo: 'p1', visual: 'macro', transition: 'fade' }], total_seconds: 6 } as CodeBrief;
  it('gives it the storyboard and what each picture really shows, and turns its findings into repairs that name the scene, the kind, the problem and the fix', async () => {
    let prompt = '';
    const result = await critique({ sheet: Buffer.from('x'), brief, complete: async (_system, p) => { prompt = p; return { text: JSON.stringify({ score: 5, findings: [{ scene: 2, kind: 'composition', problem: 'Same lower-left headline and scrim as scene 1', fix: 'Centre the title and drop the scrim' }, { scene: 9, kind: 'logo', problem: 'The logo is a dark box', fix: 'Show the logo on its own chip' }, { scene: null, kind: 'hook', problem: 'Weak opening', fix: 'Open on the strongest crop' }] }) }; } });
    expect(prompt).toMatch(/1\. \[hook, 3s\] "Winter is coming"/); expect(prompt).toMatch(/picture p1: hands pouring powder into a pool/); expect(prompt).toMatch(/hands over by: whip/);
    expect(result?.score).toBe(5); expect(result?.issues[0]).toBe('Scene 2 (composition): Same lower-left headline and scrim as scene 1. Fix: Centre the title and drop the scrim');
    expect(result?.findings?.[1].scene).toBeNull(); // a scene that does not exist is not trusted
    expect(findingText(result!.findings![2])).toMatch(/^The whole video \(hook\)/);
  });
  it('still accepts the older reply shape', async () => {
    const result = await critique({ sheet: Buffer.from('x'), brief, complete: async () => ({ text: '{"score": 7, "issues": ["Scene 1: dead area"]}' }) });
    expect(result).toMatchObject({ score: 7, issues: ['Scene 1: dead area'] });
  });
  it('lists each scene with its direction in the storyboard text', () => { expect(storyForCritic(brief).split('\n').length).toBe(2); });
});

describe('the concept carries the model’s composition decision into the scene’s direction', () => {
  it('adds COMPOSITION: ... to the direction the code writer reads', () => {
    const input = { request: 'x', subject: 'pool closing', seconds: 12, business: { name: 'Somerset', type: 'Pool', location: '', services: [], description: '', tone: '' }, photos: [], props: [] } as ConceptInput;
    const scenes = [0, 1, 2, 3].map((i) => ({ role: i === 0 ? 'hook' : 'scene', seconds: 3, headline: i === 2 ? '' : `Line ${i}`, subtext: '', items: [], visual: 'the pool cover', direction: 'slow push-in', composition: i === 2 ? 'No words: the leaves alone are the payoff; quiet after the loud hook' : 'big type', photo: null }));
    const concept = sanitizeConcept({ scenes }, input);
    expect(concept?.scenes[2].direction).toBe('slow push-in. COMPOSITION: No words: the leaves alone are the payoff; quiet after the loud hook');
  });
});
