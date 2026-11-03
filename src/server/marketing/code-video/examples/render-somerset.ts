/**
 * Renders the Somerset example video through the real Pilot sandbox: tsx src/server/marketing/code-video/examples/render-somerset.ts <tenant media dir> <out dir>
 * The script (somerset-pool-opening.py) is what Pilot's code writer produces for a creative request; here it is fixed so the result can be reviewed.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ffmpegPath } from '../../standard-video/ffmpeg.js';
import { codeVideoSupport, runSandboxed } from '../sandbox.js';

const [tenantDir, outDir, variant = 'v2'] = process.argv.slice(2);
// v2 (cinematic): p1 the covered pool, p2 the sunset opening, p3 the clean water. v1 (cards): p1 opening, p2 covered pool, p3 hands at work.
const pick = variant === 'v3' ? { p1: 'e6f0f37e-7ba1-4e8d-934e-c2bc6fbd90f5', logo: '1c3c4059-985e-4882-baf5-f01824a328e7' } : variant === 'v1' ? { p1: 'e6f0f37e-7ba1-4e8d-934e-c2bc6fbd90f5', p2: 'e85f0e87-3a48-4d1d-a5ac-ab7d66ef3d17', p3: '0fb68896-d5a4-42e5-b4e8-d1dbe3324b94', logo: '1c3c4059-985e-4882-baf5-f01824a328e7' } : { p1: 'e85f0e87-3a48-4d1d-a5ac-ab7d66ef3d17', p2: 'e6f0f37e-7ba1-4e8d-934e-c2bc6fbd90f5', p3: '832c220c-210b-4e0d-80aa-da4117a94676', logo: '1c3c4059-985e-4882-baf5-f01824a328e7' };
const main = async () => {
  const support = await codeVideoSupport(); if (!support.ok || !support.python || !support.sandbox) throw new Error(support.reason);
  const ffmpeg = ffmpegPath()!; const fontDir = path.join(path.dirname(createRequire(path.join(process.cwd(), 'package.json')).resolve('@fontsource/inter/package.json')), 'files');
  const job = path.join(outDir, 'job'); await mkdir(path.join(job, 'assets'), { recursive: true });
  const assets: Record<string, string> = {};
  for (const [name, id] of Object.entries(pick)) {
    const file = (await readFile(path.join(tenantDir, 'assets', `${id}.meta.json`), 'utf8').then(() => path.join(tenantDir, 'assets', id))); const target = path.join(job, 'assets', `${name}.jpg`);
    await copyFile(file, target); assets[name] = target;
  }
  const out = path.join(job, 'somerset-pool-opening-' + variant + '.mp4'); // the sandbox only writes inside the job folder
  const brief = {
    width: 1080, height: 1920, fps: 30, ffmpeg, font_dir: fontDir, out, brand: { name: 'Somerset Pool Service' }, assets,
    palette: variant === 'v3' ? { dark: true, bg_a: '#071033', bg_b: '#0E1B4D', text: '#FFFFFF', accent: '#2F6BFF', on_accent: '#FFFFFF', glow: '#3D6BFF', glow2: '#80B0FF', scrim: '#071033', tone_a: '#BDD0FF', tone_b: '#2F6BFF' } : { dark: true, bg_a: '#0B3C5D', bg_b: '#061D2E', text: '#FFFFFF', accent: '#4CC9F0', on_accent: '#061D2E', glow: '#4CC9F0', glow2: '#80ED99', scrim: '#061D2E', tone_a: '#BDEFFF', tone_b: '#2AA9E0' },
    ...(variant === 'v3' ? { look: 'motion', require_motion: true } : {}),
    scenes: variant === 'v3' ? [
      { role: 'hook', seconds: 7.4, headline: 'everything at once.', subtext: 'Owning a pool means thinking about', items: ['Cover off', 'Leaves', 'Water balance', 'Filter check', 'Pump prime', 'Chemicals', 'Skimmer baskets', 'Equipment repair', 'Power washing', 'Weekly cleaning', 'Closing day', 'Opening day'], photo: null, visual: null },
      { role: 'scene', seconds: 3, headline: 'Somerset takes it from here.', subtext: '', items: [], photo: null, visual: null },
      { role: 'scene', seconds: 11, headline: 'Your pool opening, booked.', subtext: 'Somerset plans the visit for you', items: ['Service', 'Pool opening', 'Visit', 'Saturday morning', 'Includes', 'Cover off and cleaned', 'Somerset is booking...', 'The visit. Booked.'], photo: null, visual: null },
      { role: 'scene', seconds: 4, headline: 'Opening day, built.', subtext: 'Then you just confirm', items: ['Opening day', 'Plan', '8:00', 'Cover off and cleaned', '10:00', 'Water balanced', '12:00', 'Equipment checked', 'Confirm', 'You just say yes.'], photo: null, visual: null },
      { role: 'scene', seconds: 5.2, headline: 'Pool season handled.', subtext: 'Pool openings, closings and weekly care', items: ['No cover to haul', 'No leaves to fish out', 'Open, clear and ready to swim'], photo: null, visual: null },
      { role: 'cta', seconds: 4.8, headline: 'Ready to swim.', subtext: '', items: [], photo: 'p1', visual: null },
    ] : variant === 'v2' ? [
      { role: 'hook', seconds: 3.8, headline: 'Winter is done', subtext: 'Time to wake the pool', items: [], photo: 'p1', visual: null },
      { role: 'scene', seconds: 4.4, headline: 'Pool season starts here', subtext: 'Pool openings in Windsor-Essex', items: [], photo: 'p2', visual: null },
      { role: 'scene', seconds: 4.6, headline: 'Opened right', subtext: '', items: ['Cover off and cleaned', 'Water balanced', 'Equipment checked'], photo: 'p3', visual: null },
      { role: 'cta', seconds: 4.4, headline: 'Book your pool opening', subtext: '', items: [], photo: 'p2', visual: null },
    ] : [
      { role: 'hook', seconds: 4.5, headline: 'Pool season starts here', subtext: 'Pool openings in Windsor-Essex', items: [], photo: 'p1', visual: null },
      { role: 'scene', seconds: 4.5, headline: 'Opened right', subtext: 'Clean, balanced and ready to swim', items: [], photo: 'p2', visual: null },
      { role: 'scene', seconds: 4.5, headline: 'Done by hand', subtext: '', items: ['Cover off and cleaned', 'Water balanced', 'Equipment checked'], photo: 'p3', visual: null },
      { role: 'cta', seconds: 4.5, headline: 'Book your pool opening', subtext: '', items: [], photo: 'p1', visual: null },
    ],
    total_seconds: 18,
  };
  const briefPath = path.join(job, 'brief.json'); await writeFile(briefPath, JSON.stringify(brief));
  const scriptPath = path.join(job, 'scene_script.py'); await copyFile(path.join(import.meta.dirname, variant === 'v1' ? 'somerset-pool-opening.py' : variant === 'v3' ? 'somerset-pool-opening-v3.py' : 'somerset-pool-opening-v2.py'), scriptPath);
  const args = { python: support.python, sandbox: support.sandbox, jobDir: job, briefPath, scriptPath, fontDir, ffmpegPath: ffmpeg };
  console.log('check', await runSandboxed({ ...args, checkOnly: true }));
  console.log('lint', await runSandboxed({ ...args, lintOnly: true }));
  console.log('render', await runSandboxed({ ...args, timeoutMs: 8 * 60_000 }));
  await copyFile(out, path.join(outDir, `somerset-pool-opening-${variant}.mp4`));
  console.log(path.join(outDir, `somerset-pool-opening-${variant}.mp4`));
};
main().catch((error) => { console.error(error); process.exit(1); });
