import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('#airo/secrets', () => ({ getSecret: () => undefined }));

import { RUNTIME_DIR } from '../code-video/sandbox';
import { musicProfile, videoSeconds } from '../music';
import { ffmpegPath } from '../standard-video/ffmpeg';
import { mixSound } from './audio';
import { buildScript, minimumSeconds, sceneSeconds } from './index';
import { cleanLine, explainerMode, sanitizeStoryboard, trimTo, useExplainer, wantsExplainer, type ExplainerStoryboard, type StoryboardInput } from './storyboard';
import { narrate, voiceMode } from './voiceover';

const run = promisify(execFile);
const input: StoryboardInput = { request: 'Make an explainer video with a voiceover about how Pilot helps Somerset schedule pool closings.', character: 'pilot', targetSeconds: 35, photos: [{ name: 'p1', label: 'pool closing' }],
  business: { name: 'Somerset Pool Service', type: 'Pool cleaning', location: 'Windsor-Essex', services: ['Pool closing', 'Pool opening', 'Weekly maintenance'], description: 'Pool openings and closings in Windsor-Essex.', tone: 'Friendly' } };
const good = {
  title: 'Pool closings, handled',
  scenes: [
    { type: 'intro', headline: 'Pool closings, handled', subtext: 'Booked in minutes with a friendly helper and more words after that', labels: ['Answer calls', 'Quote a closing', 'Book Tuesday'], narration: 'Closing a pool takes a hundred small jobs. Pilot keeps track of them for you.' },
    { type: 'chaos', headline: 'So many things', subtext: '', labels: ['Answer calls', 'Quote a closing', 'Book Tuesday', 'Order covers', 'Send invoices', 'Reply to texts'], narration: 'Calls, quotes, covers, invoices. It all piles up fast.' },
    { type: 'form', title: 'Booking form', fields: [['Name', 'Somerset Pool Service'], ['Phone', '519 555 0100'], ['Date', 'Next Tuesday morning'], ['Extra', 'x']], button: 'Book it', success: 'Booked', narration: 'A customer fills in a form, and Pilot has the details at once.' },
    { type: 'schedule', title: 'This week', entries: [['Mon', 0, 'Closing'], ['Tue', 1, 'Opening'], ['Funday', 2, 'Nope'], ['Fri', 9, 'Cleaning']], narration: 'Then the week builds itself, with every job in its place.' },
    { type: 'chat', title: 'Somerset Pool Service', messages: [['customer', 'Can you close my pool this fall?'], ['business', 'Yes. Does next Tuesday morning work?'], ['robot', 'hack']], narration: 'Customers get quick answers any time of day.' },
    { type: 'photo', headline: 'Ready for winter', subtext: 'Closed right', photo: 'p9', narration: 'Your pool is ready for winter.' },
    { type: 'cta', headline: 'Book your closing', photo: null, narration: 'Ready when you are. Book your closing with Somerset.' },
  ],
};

describe('when an explainer is made', () => {
  afterEach(() => { delete process.env.PILOT_EXPLAINER_VIDEO; delete process.env.PILOT_VOICEOVER; });
  it('only when the owner asks for one, unless switched to every video or off', () => {
    expect(wantsExplainer('Make an explainer video about scheduling')).toBe(true); expect(wantsExplainer('make a video with a voiceover')).toBe(true); expect(wantsExplainer('how Pilot helps with scheduling')).toBe(true); expect(wantsExplainer('Make me a video about pool closing')).toBe(false);
    expect(useExplainer('Make me a video about pool closing')).toBe(false); process.env.PILOT_EXPLAINER_VIDEO = 'default'; expect(useExplainer('Make me a video')).toBe(true); process.env.PILOT_EXPLAINER_VIDEO = 'off'; expect(explainerMode()).toBe('off'); expect(useExplainer('explainer please')).toBe(false);
  });
});

describe('checking the storyboard', () => {
  it('keeps the scenes Pilot can draw and drops the rest: unknown scene kinds, unknown photos, bad days, made-up values, stray speakers', () => {
    const board = sanitizeStoryboard(good, input)!;
    expect(board.scenes.map((scene) => scene.type)).toEqual(['intro', 'chaos', 'form', 'schedule', 'chat', 'cta']); // the photo scene named a photo that does not exist
    const form = board.scenes[2] as Extract<typeof board.scenes[number], { type: 'form' }>; expect(form.fields.find(([label]) => label === 'Phone')![1]).toBe(''); expect(form.fields.find(([label]) => label === 'Name')![1]).toBe('Somerset Pool Service'); expect(form.fields.find(([label]) => label === 'Date')![1]).toBe('Next Tuesday morning'); expect(form.fields).toHaveLength(3); // at most three fields
    const schedule = board.scenes[3] as Extract<typeof board.scenes[number], { type: 'schedule' }>; expect(schedule.entries).toEqual([['Mon', 0, 'Closing'], ['Tue', 1, 'Opening'], ['Fri', 4, 'Cleaning']]);
    const chat = board.scenes[4] as Extract<typeof board.scenes[number], { type: 'chat' }>; expect(chat.messages).toHaveLength(2);
    expect(board.scenes.at(-1)!.type).toBe('cta');
  });
  it('removes numbers, prices, links and phone numbers the business never gave, and ends every phrase on a whole word', () => {
    expect(cleanLine('Book for $49 at example.com or call 519-555-0100 today', 80, 'Somerset Pool Service')).toBe('Book for at or call today'); expect(cleanLine('Email me@x.ca now', 40, '')).toBe('Email now');
    expect(cleanLine('Pool closings in 3 easy steps', 60, 'Somerset')).not.toMatch(/\d/);
    expect(trimTo('Pilot helps Somerset schedule and manage pool closings with a friendly', 66)).toBe('Pilot helps Somerset schedule and manage pool closings');
    expect(trimTo('Short one', 40)).toBe('Short one');
    const board = sanitizeStoryboard(good, input)!; expect((board.scenes[0] as { subtext: string }).subtext).not.toMatch(/\b(?:and|with|a|the)$/);
  });
  it('is thrown away when too little is usable, and always ends with one call to action', () => {
    expect(sanitizeStoryboard({ scenes: [{ type: 'intro', headline: 'x', narration: 'y' }] }, input)).toBeNull(); expect(sanitizeStoryboard('nope', input)).toBeNull();
    const noCta = sanitizeStoryboard({ scenes: good.scenes.slice(0, 5) }, input)!; expect(noCta.scenes.at(-1)!.type).toBe('cta'); expect(noCta.scenes.filter((scene) => scene.type === 'cta')).toHaveLength(1);
  });
});

describe('timing and the script', () => {
  const board = sanitizeStoryboard(good, input) as ExplainerStoryboard;
  it('makes each scene long enough for its animation and for its narration, but never longer than 16 seconds', () => {
    const seconds = sceneSeconds(board, board.scenes.map(() => 3)); board.scenes.forEach((scene, i) => expect(seconds[i]).toBeGreaterThanOrEqual(minimumSeconds(scene)));
    expect(sceneSeconds(board, board.scenes.map(() => 30)).every((value) => value <= 16)).toBe(true);
    expect(sceneSeconds(board, board.scenes.map((_, i) => (i === 0 ? 9 : 0)))[0]).toBeCloseTo(10, 1); // 9 seconds of speech plus a pause
  });
  it('writes plain calls with the business’s words, a different transition each time, and the ending photo falling back to the first photo', () => {
    const script = buildScript(board, board.scenes.map(() => 5), (name) => (name === 'p1' ? 'p1' : null));
    expect(script).toContain('video.explainer_intro("Pool closings, handled"'); expect(script).toContain('video.explainer_form("Booking form"'); expect(script).toContain('video.cta_pro("Book your closing", seconds=5, photo="p1"');
    const transitions = [...script.matchAll(/transition="(\w+)"/g)].map((m) => m[1]); expect(transitions.length).toBe(board.scenes.length); expect(transitions.every((t, i) => i === 0 || t !== transitions[i - 1])).toBe(true);
  });
  it.skipIf(!existsSync(path.join(process.cwd(), '.venv-codevideo/bin/python')))('passes the same safety check as any code-written video', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ex-check-')); try {
      const strings = board.scenes.flatMap((scene) => JSON.stringify(scene).match(/"([^"]{15,})"/g) ?? []).map((s) => JSON.parse(s) as string);
      await writeFile(path.join(dir, 'brief.json'), JSON.stringify({ width: 270, height: 480, fps: 10, ffmpeg: ffmpegPath(), font_dir: '/x', out: '/x/o.mp4', brand: { name: 'Somerset Pool Service' }, palette: {}, assets: {}, scenes: [{ role: 'explainer', seconds: 10, headline: 'Pool closings, handled', subtext: '', items: strings }] }));
      await writeFile(path.join(dir, 's.py'), buildScript(board, board.scenes.map(() => 5), () => null));
      const { stdout } = await run(path.join(process.cwd(), '.venv-codevideo/bin/python'), ['-I', path.join(RUNTIME_DIR, 'runner.py'), path.join(dir, 'brief.json'), path.join(dir, 's.py'), '--check'], { env: {} }).catch((error) => error as { stdout: string });
      expect(JSON.parse(stdout.trim().split('\n').pop()!)).toMatchObject({ ok: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('the voice and the sound', () => {
  const tone = async (file: string, seconds: number) => run(ffmpegPath()!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, file]);
  it('picks the voice from the settings: off, the free built-in one, or OpenAI only when asked', () => { expect(voiceMode()).toBe('auto'); process.env.PILOT_VOICEOVER = 'openai'; expect(voiceMode()).toBe('openai'); process.env.PILOT_VOICEOVER = 'off'; expect(voiceMode()).toBe('off'); delete process.env.PILOT_VOICEOVER; });
  it('speaks every line, measures it, and leaves a failed line silent without losing the others', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ex-voice-')); vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const spoken = await narrate({ lines: ['one', 'two', 'three'], workDir: dir, provider: 'system', speak: async (text, file) => { if (text === 'two') throw new Error('no voice'); await tone(file.replace(/\.aiff$/, '.wav'), 1.5); await run(ffmpegPath()!, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file.replace(/\.aiff$/, '.wav'), file]); } });
      expect(spoken.provider).toBe('system'); expect(spoken.files.map(Boolean)).toEqual([true, false, true]); expect(spoken.seconds[0]).toBeGreaterThan(1.3); expect(spoken.seconds[1]).toBe(0);
      expect((await narrate({ lines: ['x'], workDir: dir, provider: null })).provider).toBeNull();
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
  it('mixes the voice at the right moments over quiet original music, keeping the picture untouched', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ex-mix-')); try {
      const video = path.join(dir, 'v.mp4'); await run(ffmpegPath()!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x233D48:s=160x284:d=6:r=15', '-pix_fmt', 'yuv420p', video]);
      const voiceFile = path.join(dir, 'a.wav'); await tone(voiceFile, 1.5);
      const out = path.join(dir, 'out.mp4'); const mixed = await mixSound({ videoPath: video, outPath: out, voice: [{ file: voiceFile, startSeconds: 1 }, { file: voiceFile, startSeconds: 3.5 }], music: musicProfile(['soft'], [], 'x'), workDir: dir });
      expect(mixed.seconds).toBeGreaterThan(5.5); const info = (await run(ffmpegPath()!, ['-hide_banner', '-i', out]).catch((e) => e as { stderr: string })).stderr; expect(info).toMatch(/Video: h264/); expect(info).toMatch(/Audio: aac/);
      expect(await videoSeconds(out)).toBeGreaterThan(5.5);
      const music = await mixSound({ videoPath: video, outPath: path.join(dir, 'm.mp4'), voice: [], music: musicProfile(['soft'], [], 'x'), workDir: dir }); expect(music.ducked).toBe(false);
      const quiet = await mixSound({ videoPath: video, outPath: path.join(dir, 'q.mp4'), voice: [], music: null, workDir: dir }); expect(quiet.seconds).toBeGreaterThan(5.5);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 90_000);
});
