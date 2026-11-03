import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { codeVideoStyle, extractCode, repairScript, writeScript, type CodeBrief } from './generate.js';
import { buildCodeBrief, codeVideoMode, useCodeVideo, wantsCodeVideo } from './index.js';
import { macProfile, RUNTIME_DIR } from './sandbox.js';

const run = promisify(execFile);
const python = path.join(process.cwd(), '.venv-codevideo/bin/python');
const haveVenv = existsSync(python);

const brief: CodeBrief = { width: 540, height: 960, fps: 30, ffmpeg: '/x/ffmpeg', font_dir: '/x/fonts', out: '/x/out.mp4', brand: { name: 'Somerset Pool Service' }, palette: { dark: true, bg_a: '#233D48' }, assets: { p1: '/x/p1.jpg' }, total_seconds: 8,
  scenes: [{ role: 'hook', seconds: 4, headline: 'Is your pool ready for winter?', subtext: 'Pool closing, done right', items: [], photo: 'p1', visual: null }, { role: 'cta', seconds: 4, headline: 'Book your pool closing', subtext: '', items: ['Thorough cleaning'], photo: null, visual: null }] };

describe('when the code path is used', () => {
  afterEach(() => { delete process.env.PILOT_CODE_VIDEO; });
  it('only when asked or when the templates do not fit (auto, the default), for everything when asked, never when off', () => {
    expect(codeVideoMode()).toBe('primary'); process.env.PILOT_CODE_VIDEO = 'auto';
    expect(wantsCodeVideo('Make me a custom animation about pool closing')).toBe(true); expect(wantsCodeVideo('use code-drawn animation')).toBe(true); expect(wantsCodeVideo('Make me a video about pool closing')).toBe(false);
    expect(useCodeVideo('Make me a video about pool closing')).toBe(false); expect(useCodeVideo('Make me a custom animated video')).toBe(true);
    process.env.PILOT_CODE_VIDEO = 'default'; expect(useCodeVideo('Make me a video')).toBe(true);
    process.env.PILOT_CODE_VIDEO = 'off'; expect(useCodeVideo('Make me a custom animation')).toBe(false); expect(useCodeVideo('x', true)).toBe(false);
  });
});

describe('writing the script', () => {
  it('takes the code out of a reply', () => {
    expect(extractCode('Here you go:\n```python\ndef build(video):\n    pass\n```\nEnjoy')).toBe('def build(video):\n    pass');
    expect(extractCode('def build(video):\n    pass')).toBe('def build(video):\n    pass');
  });
  it('asks once more, with the checker’s complaints, when the first script is refused, and gives up after that', async () => {
    const prompts: string[] = []; let call = 0;
    const complete = async (_system: string, prompt: string) => { prompts.push(prompt); call += 1; return { text: call === 1 ? 'import os\ndef build(video): pass' : 'def build(video):\n    video.cta("Book your pool closing")', usage: { inputTokens: 10, outputTokens: 5 } }; };
    const check = async (script: string) => (script.includes('import') ? ['Not allowed: Import (line 1).'] : []);
    const ok = await writeScript({ brief, complete, check });
    expect('script' in ok && ok.script).toContain('video.cta'); expect(ok.usage).toEqual({ calls: 2, inputTokens: 20, outputTokens: 10 }); expect(prompts[1]).toContain('Not allowed: Import');
    const bad = await writeScript({ brief, complete: async () => ({ text: 'import os' }), check });
    expect('error' in bad && bad.error).toContain('safety check');
  });
  it('repairs a script that failed while drawing only if the repair also passes the checks', async () => {
    const usage = { calls: 1, inputTokens: 0, outputTokens: 0 };
    expect(await repairScript({ brief, complete: async () => ({ text: 'def build(video):\n    pass' }), script: 'x', errors: ['ValueError: boom'], check: async () => [], usage })).toBe('def build(video):\n    pass'); expect(usage.calls).toBe(2);
    expect(await repairScript({ brief, complete: async () => ({ text: 'import os' }), script: 'x', errors: ['e'], check: async () => ['no'], usage })).toBeNull();
  });
});

describe('the brief the model gets', () => {
  it('carries the business’s own words, photo names and brand palette, with the first photo for the first scene', () => {
    const plan = { spec: { size: '1080x1920' }, summary: { durationSeconds: 8, photosUsed: [{ id: 'asset-1', label: 'Pool' }], scenes: [{ role: 'hook', seconds: 4, headline: 'Windsor‑Essex pools', subtext: 'Hello', photoId: 'asset-1', items: ['A'] }, { role: 'cta', seconds: 4, headline: 'Book', subtext: '', photoId: null }] } } as never;
    const built = buildCodeBrief({ plan, kit: { name: 'Somerset', primary: '#233D48', secondary: '#E1611A', accent: '#188BF6', logoUrl: null }, assets: { p1: '/j/p1.jpg' }, fontDir: '/f', ffmpeg: '/ff', out: '/o.mp4' });
    expect(built).toMatchObject({ width: 1080, height: 1920, total_seconds: 8 }); expect(built.scenes[0]).toMatchObject({ headline: 'Windsor-Essex pools', photo: 'p1', items: ['A'] }); expect(built.scenes[1].photo).toBeNull();
    expect(built.palette).toMatchObject({ dark: true, bg_a: '#233D48', accent: '#188BF6' });
  });
});

describe('the sandbox profile (macOS)', () => {
  it('denies network and writes, allows writes only in the job folder, and hides the rest of the home folder', () => {
    const profile = macProfile({ jobDir: '/work/job-1', readable: ['/app/runtime', '/app/.venv'] });
    expect(profile).toContain('(deny network*)'); expect(profile).toContain('(deny file-write*)'); expect(profile).toContain('(allow file-write* (subpath "/work/job-1")');
    expect(profile).toContain(`(deny file-read* (subpath "${os.homedir()}"))`); expect(profile).toContain('(subpath "/app/runtime")');
    expect(profile.indexOf('(deny file-read*')).toBeLessThan(profile.indexOf('(allow file-read* ')); // later rules win, so the allowed places come after the home-folder denial
  });
});

describe.skipIf(!haveVenv)('the safety checker', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });
  const check = async (script: string) => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cv-check-')); await writeFile(path.join(dir, 'brief.json'), JSON.stringify(brief)); await writeFile(path.join(dir, 's.py'), script);
    const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'brief.json'), path.join(dir, 's.py'), '--check'], { env: {} }).catch((error) => error as { stdout: string });
    return JSON.parse(stdout.trim().split('\n').pop()!) as { ok: boolean; errors?: string[] };
  };
  it('accepts a script that only calls the scene library with the business’s own words', async () => {
    expect((await check('def build(video):\n    b = video.brief["scenes"]\n    video.photo_hero("p1", "Is your pool ready for winter?", "Pool closing, done right", seconds=4)\n    for i in range(2):\n        video.statement(b[1]["headline"], seconds=2)\n    video.cta("Book your pool closing", seconds=4)\n')).ok).toBe(true);
  });
  it.each([
    ['an import', 'import os\ndef build(video):\n    pass\n', /Import/],
    ['opening a file', 'def build(video):\n    open("/etc/passwd")\n', /open/],
    ['reaching into object internals', 'def build(video):\n    video.__class__\n', /__class__/],
    ['str.format tricks', 'def build(video):\n    "{0.__class__}".format(video)\n', /format|not from the business/],
    ['a loop that never ends', 'def build(video):\n    while True:\n        pass\n', /While/],
    ['a class', 'class A:\n    pass\ndef build(video):\n    pass\n', /ClassDef/],
    ['eval', 'def build(video):\n    eval("1")\n', /eval/],
    ['text the business never said', 'def build(video):\n    video.statement("Free pool service for life, guaranteed forever!")\n', /not from the business/],
    ['no build function', 'x = 1\n', /build/],
  ])('refuses %s', async (_name, script, why) => {
    const result = await check(script as string); expect(result.ok).toBe(false); expect(result.errors!.join(' ')).toMatch(why as RegExp);
  });
});

describe('open drawing', () => {
  it('drops the harmless "import math" habit, but nothing else that is an import', () => {
    expect(extractCode('```python\ndef build(video):\n    import math\n    x = math.sin(1)\n```')).not.toContain('import');
    expect(extractCode('import os\ndef build(video): pass')).toContain('import os');
  });
  it('is the default style, and the library-only style can be chosen', () => {
    expect(codeVideoStyle()).toBe('open'); process.env.PILOT_CODE_VIDEO_STYLE = 'library'; expect(codeVideoStyle()).toBe('library'); delete process.env.PILOT_CODE_VIDEO_STYLE;
  });
});

describe.skipIf(!haveVenv)('open scripts: safety checker, runtime text rule and layout check', () => {
  let dir = '';
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });
  const photo = () => { const c = createCanvas(600, 400); const x = c.getContext('2d'); x.fillStyle = '#2E75B6'; x.fillRect(0, 0, 600, 400); return c.toBuffer('image/png'); };
  const runMode = async (script: string, mode: '--check' | '--lint' | 'render') => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'cv-open-'));
    await writeFile(path.join(dir, 'p1.png'), photo());
    const small = { ...brief, width: 270, height: 480, fps: 10, font_dir: path.join(process.cwd(), 'node_modules/@fontsource/inter/files'), out: path.join(dir, 'out.mp4'), assets: { p1: path.join(dir, 'p1.png') }, ffmpeg: (await import('../standard-video/ffmpeg.js')).ffmpegPath()!,
      palette: { dark: true, bg_a: '#233D48', bg_b: '#131F27', text: '#FFFFFF', accent: '#E1611A', on_accent: '#FFFFFF', glow: '#188BF6', glow2: '#E1611A', scrim: '#233D48' }, total_seconds: 2,
      scenes: [{ role: 'hook', seconds: 2, headline: 'Is your pool ready for winter?', subtext: 'Pool closing, done right', items: [], photo: 'p1', visual: null }] };
    await writeFile(path.join(dir, 'brief.json'), JSON.stringify(small)); await writeFile(path.join(dir, 's.py'), script);
    const { stdout } = await run(python, ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'brief.json'), path.join(dir, 's.py'), ...(mode === 'render' ? [] : [mode])], { env: {}, timeout: 120_000 }).catch((error) => error as { stdout: string });
    return JSON.parse(stdout.trim().split('\n').pop()!) as { ok: boolean; errors?: string[] };
  };
  const good = `def build(video):
    def draw(c, t, u):
        c.gradient(video.palette.bg_a, video.palette.bg_b, 150)
        c.photo("p1", 0, 0, c.W, c.H * 0.5, zoom=lerp(1.05, 1.2, u), tint=video.palette["bg_a"], tint_alpha=0.2)
        c.push(84, 760, 912, 500, alpha=progress(t, 0.1, 0.8))
        h = c.text("Is your pool ready for winter?", 0, 0, 100, 800, "#FFFFFF", width=912)
        c.text("Pool closing, done right", 0, h + 24, 44, 400, "#FFFFFF", width=912)
        c.pop()
        c.circle(900, 300 + 20 * wobble(1, t), 40, video.palette["accent"], alpha=0.5)
        c.logo()
    video.add_scene(2.0, draw)
`;
  it('accepts a script that draws its own composition with the canvas', async () => { expect((await runMode(good, '--check')).ok).toBe(true); });
  it('renders it to a real video', async () => { const r = await runMode(good, 'render'); expect(r).toMatchObject({ ok: true }); }, 120_000);
  it('passes the layout check when text is stacked using the height c.text() returns, and the logo is called', async () => { expect(await runMode(good, '--lint')).toMatchObject({ ok: true, errors: [] }); });
  it.each([
    ['text overlapping text', good.replace('h + 24', '10'), /overlaps/],
    ['no logo', good.replace('        c.logo()\n', ''), /never calls c.logo/],
    ['a photo cut off by the edge', good.replace('c.photo("p1", 0, 0, c.W, c.H * 0.5,', 'c.photo("p1", 600, 100, 700, 600,'), /cut off/],
    ['text too small', good.replace('44, 400', '20, 400'), /too small/],
  ])('the layout check reports %s', async (_n, script, why) => { const r = await runMode(script as string, '--lint'); expect(r.ok).toBe(false); expect(r.errors!.join(' ')).toMatch(why as RegExp); });
  it('refuses, at run time, text built from the brief’s words into something the business never said', async () => {
    const r = await runMode(good.replace('c.text("Pool closing, done right", 0, h + 24', 'c.text("Free " + "Pool closing, done right", 0, h + 24'), 'render'); expect(r.ok).toBe(false); expect(r.errors!.join(' ')).toMatch(/not from the business/);
  }, 120_000);
  const premium = `def build(video):
    b = video.brief["scenes"]
    video.hook_kinetic("p1", "Is your pool ready for winter?", "Pool closing, done right", seconds=2.0, pan="left", anchor="center", transition="wipe")
`;
  it('accepts the premium scenes, lints them clean, and renders them', async () => {
    expect((await runMode(premium, '--check')).ok).toBe(true);
    expect(await runMode(premium, '--lint')).toMatchObject({ ok: true });
    expect(await runMode(premium, 'render')).toMatchObject({ ok: true, scenes: 1 });
  }, 120_000);
  it('keeps the other premium scenes inside the business’s own words too', async () => {
    const r = await runMode('def build(video):\n    video.statement_kinetic("Free pool for life, guaranteed!", "", seconds=2)\n', '--check'); expect(r.ok).toBe(false); expect(r.errors!.join(' ')).toMatch(/not from the business/);
  });
  it('draws a vertical timeline, a ring and kinetic text without errors, even when a bar starts at zero size', async () => {
    const script = `def build(video):\n    def draw(c, t, u):\n        c.gradient(video.palette.bg_a, video.palette.bg_b, 150)\n        c.rect(84, 300, 0, 0, "#FFFFFF")\n        c.ring(500, 500, 80, u, video.palette.accent, 10, "#FFFFFF", 0.2)\n        h = c.reveal_text("Is your pool ready for winter?", 84, 700, 100, 800, "#FFFFFF", t, width=900)\n        c.timeline(["Pool closing, done right"], 84, 700 + h + 40, t, size=40, width=800)\n        c.logo()\n    video.add_scene(2.0, draw, "iris")\n`;
    expect(await runMode(script, 'render')).toMatchObject({ ok: true });
  }, 120_000);
  it.each([
    ['walking to internals through the canvas', 'def build(video):\n    def draw(c, t, u):\n        c.frame.save("/tmp/x.png")\n    video.add_scene(1, draw)\n', /attribute frame/],
    ['the photo’s file path', 'def build(video):\n    x = video.assets["p1"]\n', /attribute assets/],
    ['a huge power', 'def build(video):\n    x = 10 ** 10 ** 10\n', /power/],
    ['repeating a list to exhaust memory', 'def build(video):\n    x = [0] * 1000000000\n', /repeating/],
    ['a name from outside', 'def build(video):\n    import os\n', /Import/],
  ])('the checker refuses %s', async (_n, script, why) => { const r = await runMode(script as string, '--check'); expect(r.ok).toBe(false); expect(r.errors!.join(' ')).toMatch(why as RegExp); });
});
