import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { RUNTIME_DIR } from './sandbox.js';

const run = promisify(execFile);
const python = path.join(process.cwd(), '.venv-codevideo/bin/python');
const fontDir = () => path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
const pyJson = async (code: string, args: string[] = []) => { const { stdout } = await run(python, ['-I', '-c', code, ...args], { env: {}, timeout: 240_000, maxBuffer: 20_000_000 }); return JSON.parse(stdout.trim().split('\n').pop() || '{}'); };

describe('the camera cannot crash a video, at any valid setting', () => {
  it('draws every move, crop, aim, amount and moment over pictures of every shape, including the exact edge that crashed run 11', async () => {
    if (!existsSync(python)) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cam-'));
    try {
      const shapes: Array<[number, number]> = [[200, 300], [300, 200], [100, 1000], [1000, 100], [256, 256], [1018, 1024]];
      const files: string[] = [];
      for (const [i, [w, h]] of shapes.entries()) { const c = createCanvas(w, h); const g = c.getContext('2d'); g.fillStyle = '#336699'; g.fillRect(0, 0, w, h); g.fillStyle = '#CC6633'; g.fillRect(0, 0, w / 2, h / 2); const f = path.join(dir, `p${i}.png`); await writeFile(f, c.toBuffer('image/png')); files.push(f); }
      const code = `
import sys, json, itertools
sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})
import pilot_scenes, pilot_canvas
from PIL import Image
files = json.loads(sys.argv[1])
brief = {"width": 108, "height": 192, "fps": 30, "ffmpeg": "x", "font_dir": ${JSON.stringify(fontDir())}, "out": "o.mp4", "brand": {"name": "S"}, "assets": {"p%d" % i: f for i, f in enumerate(files)}, "palette": {"dark": True, "bg_a": "#071033", "bg_b": "#0E1B4D", "text": "#FFFFFF", "accent": "#2F6BFF", "on_accent": "#FFFFFF", "glow": "#3D6BFF", "glow2": "#80B0FF", "scrim": "#071033"}, "scenes": [{"role": "scene", "seconds": 3, "headline": "x", "subtext": "", "items": [], "photo": None, "visual": None}], "total_seconds": 3}
video = pilot_scenes.Video(brief)
moves = ["push", "pull", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit", "handheld", "drift"]
ats = [None, (0, 0), (1, 1), (0, 1), (1, 0), (0.5, 0.5)]
count = 0
for i in range(len(files)):
    for move, crop, at, amount, u in itertools.product(moves, (1.0, 2.5, 3.0), ats, (0.3, 2.0), (0.0, 0.5, 1.0)):
        canvas = pilot_canvas.Canvas(video, Image.new("RGB", (video.width, video.height)))
        canvas.camera("p%d" % i, u, move, amount, u * 3.0, zoom=crop, at=at, focus_y=0.4)
        count += 1
    for pan in (-1.0, 0.0, 1.0):
        for zoom in (1.0, 4.0):
            canvas = pilot_canvas.Canvas(video, Image.new("RGB", (video.width, video.height)))
            canvas.photo("p%d" % i, 0, 0, canvas.W, canvas.H, zoom=zoom, pan_x=pan, pan_y=-pan)
            count += 1
print(json.dumps({"ok": True, "calls": count}))`;
      const result = await pyJson(code, [JSON.stringify(files)]);
      expect(result).toMatchObject({ ok: true }); expect(result.calls).toBeGreaterThan(5000);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 300_000);
});

describe('no live transition fills the frame with black', () => {
  it('slice, whip, crosszoom and lightleak never leave black tiles or bands, at any moment of the transition', async () => {
    if (!existsSync(python)) return;
    const code = `
import sys, json
sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})
import numpy as np
from PIL import Image
import pilot_scenes
a = Image.new("RGB", (216, 384), (220, 70, 60)); b = Image.new("RGB", (216, 384), (60, 80, 220))
worst = {}
for kind in ("slice", "whip", "crosszoom", "lightleak"):
    top = 0.0
    for step in range(0, 41):
        k = step / 40.0
        arr = np.asarray(pilot_scenes.live_transition(kind, a, b, k)).astype(int)
        dark = float(((arr.max(axis=2)) < 40).mean())  # a pixel with no colour in it at all: black fill, not a blend of the two
        top = max(top, dark)
    worst[kind] = round(top, 4)
print(json.dumps({"ok": True, "worst": worst}))`;
    const result = await pyJson(code);
    for (const kind of ['slice', 'whip', 'crosszoom', 'lightleak']) expect(result.worst[kind], `${kind} black fraction`).toBeLessThan(0.002);
  });
  it('slice shows the leaving scene and the arriving scene, and only those', async () => {
    if (!existsSync(python)) return;
    const result = await pyJson(`
import sys, json
sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})
import numpy as np
from PIL import Image
import pilot_scenes
a = Image.new("RGB", (216, 384), (220, 70, 60)); b = Image.new("RGB", (216, 384), (60, 80, 220))
mid = np.asarray(pilot_scenes.live_transition("slice", a, b, 0.5)).reshape(-1, 3)
start = np.asarray(pilot_scenes.live_transition("slice", a, b, 0.0)).reshape(-1, 3)
end = np.asarray(pilot_scenes.live_transition("slice", a, b, 1.0)).reshape(-1, 3)
isa = lambda px: (abs(px - np.array([220, 70, 60])).sum(axis=1) < 6)
isb = lambda px: (abs(px - np.array([60, 80, 220])).sum(axis=1) < 6)
print(json.dumps({"ok": True, "start_all_a": bool(isa(start).all()), "end_all_b": bool(isb(end).all()), "mid_only_a_or_b": bool((isa(mid) | isb(mid)).all()), "mid_has_both": bool(isa(mid).any() and isb(mid).any())}))`);
    expect(result).toMatchObject({ start_all_a: true, end_all_b: true, mid_only_a_or_b: true, mid_has_both: true });
  });
});
