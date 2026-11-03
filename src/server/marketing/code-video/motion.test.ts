import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { lookFor, wantsMotion } from './choose.js';
import { motionProblems } from './index.js';
import { RUNTIME_DIR } from './sandbox.js';

const run = promisify(execFile);
afterEach(() => { delete process.env.PILOT_CODE_VIDEO; });

describe('which look a custom video has', () => {
  it('invents graphics and app UI for an explainer, an offer, steps or a list', () => {
    for (const message of ['Make an explainer video about how it works', 'Make a pricing post for our plan', 'a video showing our booking schedule', 'a checklist of what we do']) expect(wantsMotion(message)).toBe(true);
  });
  it('keeps the photograph-led look when a photo is the right main visual', () => {
    expect(lookFor({ message: 'Make a cinematic reel about pool openings', hasHeroPhoto: true })).toBe('photo');
    expect(lookFor({ message: 'Make a video about a chocolate cake', hasHeroPhoto: false, hasProp: true })).toBe('photo'); // a ready-made prop draws it
  });
  it('invents the visuals when there is no photograph to lead with, or the request is about an offer', () => {
    expect(lookFor({ message: 'Make a creative video about our weekly service', hasHeroPhoto: false })).toBe('motion');
    expect(lookFor({ message: 'Show our pricing', hasHeroPhoto: true })).toBe('motion');
  });
});

describe('a motion-graphics script', () => {
  const good = `def build(video):
    def a(c, t, u):
        c.swarm(["x"], t, 540, 900)
        c.card(84, 500, 900, 600, "Draft", "Plan")
        c.mark("yes", 84, 1200)
    video.add_scene(4, a, "whip", 0.7)
    video.add_scene(4, a, "lightleak", 0.7)
    video.add_scene(4, a, "fade")`;
  it('is accepted when it uses the kit and joins scenes with real transitions', () => { expect(motionProblems(good)).toEqual([]); });
  it('is sent back when it is photographs in cards, or barely uses the kit', () => {
    const weak = `def build(video):
    def a(c, t, u):
        c.photo("p1", 84, 200, 900, 800, shape="round", shadow=0.5)
        c.text("Hello", 84, 100, 80)
    video.add_scene(4, a, "fade")
    video.add_scene(4, a, "fade")
    video.add_scene(4, a, "fade")`;
    const found = motionProblems(weak).join(' ');
    expect(found).toMatch(/at least three kinds of piece/); expect(found).toMatch(/rounded or shadowed card/); expect(found).toMatch(/two different transitions/);
  });
});

describe('the motion-graphics kit runs in the real runtime', () => {
  it('draws chips, a swarm, a card with a typing field, a row, marks, a counter, a gradient card, serif type and a cursor, and refuses words that are not the business\'s', async () => {
    const python = path.join(process.cwd(), '.venv-codevideo/bin/python'); if (!existsSync(python)) return;
    const fontDir = path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kit-'));
    try {
      const make = async (body: string, name: string) => {
        const brief = { width: 540, height: 960, fps: 30, ffmpeg: 'x', font_dir: fontDir, out: path.join(dir, 'o.mp4'), brand: { name: 'Somerset' }, assets: {}, palette: { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033' }, look: 'motion', preview_dir: dir, preview_times: [1.2, 2.5], scenes: [{ role: 'hook', seconds: 3, headline: 'Pool season handled.', subtext: 'Pool opening', items: ['Cover off', 'Leaves', 'Pool opening', 'Saturday morning', '20', 'No leaves to fish out'], photo: null, visual: null }], total_seconds: 3 };
        await writeFile(path.join(dir, `${name}.json`), JSON.stringify(brief)); await writeFile(path.join(dir, `${name}.py`), body);
        const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, `${name}.json`), path.join(dir, `${name}.py`), '--preview'], { env: {}, timeout: 120_000 }).catch((e) => ({ stdout: String(e.stdout ?? '') }));
        return JSON.parse(stdout.trim().split('\n').pop() || '{}') as { ok: boolean; errors?: string[] };
      };
      const ok = await make(`def build(video):
    b = video.brief["scenes"][0]
    def a(c, t, u):
        c.gradient("#FFFFFF", "#EEF2F9", 180)
        c.swarm(b["items"], t, 540, 700, 380, 240, 12, 30, 3, 1.0, progress(t, 0.2, 1.0, "linear"), 0.2)
        c.silhouette(540, 1500, 250)
        y = c.card(84, 500, 900, 700, "New booking", "Draft")
        y = c.field(122, y, 836, "Pool opening", "Saturday morning", t, 0.5)
        c.row(122, y, 836, "20", "Cover off", t, 0.2)
        c.mark("no", 84, 1300, 50, 1.0)
        c.mark("yes", 84, 1380, 50, 1.0)
        c.badge("1", 300, 1300)
        c.counter("20", 540, 200, t, 0.0, 1.5, 120, "#0B1F44")
        c.mesh(84, 100, 900, 300, ["#E6EDFF", "#2F6BFF", "#7FA6FF"], t)
        c.text("Pool season", 84, 1500, 100, 700, "#0B1F44", face="serif")
        c.text("handled.", 84, 1600, 100, 700, "#2F6BFF", face="serif_italic")
        c.button(84, 1700, 900, "Confirm", 1.0, 0.0)
        c.pill("Pool opening", 700, 460, t, 0.1)
        c.cursor(600, 1000, 1.0, 0.5, 1.4)
        c.logo()
    video.add_scene(3, a, "fade")`, 'ok');
      expect(ok).toEqual(expect.objectContaining({ ok: true })); expect((await readdir(dir)).filter((f) => f.startsWith('frame_')).length).toBe(2);
      const bad = await make(`def build(video):
    def a(c, t, u):
        c.card(84, 500, 900, 700, "Free pizza for everyone", "Draft")
    video.add_scene(3, a, "fade")`, 'bad');
      expect(bad.ok).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
