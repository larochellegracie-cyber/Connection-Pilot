import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Where model-written Python is run, and how it is contained. The script is checked before it runs (validate_script.py) and runs with almost
 * nothing in scope (runner.py); this adds the operating-system layer, which does not rely on the script behaving:
 *   - macOS: sandbox-exec with NO network, writes only inside the job's own folder, and reads only the video runtime, its Python environment,
 *     the bundled font, ffmpeg and the job's folder (the rest of the home folder, including .env, is unreadable)
 *   - Linux: bubblewrap (bwrap) with a new network namespace, a read-only filesystem, and the job's folder as the only writable place
 *   - anywhere else, or without these tools: code-written video is switched off, and Pilot uses its standard renderer. It is never run unsandboxed.
 * The process also gets an empty environment (no API keys), a time limit, and CPU and file-size limits.
 */
export type SandboxKind = 'sandbox-exec' | 'bwrap';

export const RUNTIME_DIR = path.join(process.cwd(), 'src/server/marketing/code-video/runtime');
const VENV_PYTHON = path.join(process.cwd(), '.venv-codevideo/bin/python');

let cached: { python: string | null; sandbox: SandboxKind | null; reason: string } | null = null;

/** The Python to use (PILOT_CODE_VIDEO_PYTHON, or the project's own .venv-codevideo with Pillow and numpy) and the sandbox available, if any. */
export async function codeVideoSupport(): Promise<{ ok: boolean; python: string | null; sandbox: SandboxKind | null; reason: string }> {
  if (!cached) {
    const python = [process.env.PILOT_CODE_VIDEO_PYTHON, VENV_PYTHON].find((candidate): candidate is string => !!candidate && existsSync(candidate)) ?? null;
    const sandbox: SandboxKind | null = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') ? 'sandbox-exec' : process.platform === 'linux' && existsSync('/usr/bin/bwrap') ? 'bwrap' : null;
    let reason = '';
    if (!python) reason = 'Python with Pillow is not set up (python3 -m venv .venv-codevideo && .venv-codevideo/bin/pip install pillow numpy).';
    else if (!sandbox) reason = 'No sandbox is available on this server (macOS sandbox-exec or Linux bubblewrap), so model-written code is not run here.';
    else { try { await run(python, ['-c', 'import PIL, numpy'], { timeout: 15_000, env: {} }); } catch { reason = 'Pillow and numpy are not installed for the video Python.'; } }
    cached = { python: reason ? null : python, sandbox: reason ? null : sandbox, reason };
  }
  return { ok: !!cached.python && !!cached.sandbox, ...cached };
}

const sbQuote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const ancestors = (places: string[]) => [...new Set(places.flatMap((place) => { const parts: string[] = []; let current = path.dirname(place); while (current !== path.dirname(current)) { parts.push(current); current = path.dirname(current); } return parts; }))];

/** The macOS sandbox profile: everything allowed except network and file writes; then reads outside the listed places are removed again. */
export function macProfile({ jobDir, readable }: { jobDir: string; readable: string[] }): string {
  const home = os.homedir();
  return [
    '(version 1)', '(allow default)', '(deny network*)',
    '(deny file-write*)', `(allow file-write* (subpath ${sbQuote(jobDir)}) (literal "/dev/null"))`,
    `(deny file-read* (subpath ${sbQuote(home)}))`,
    `(allow file-read* ${[jobDir, ...readable].map((place) => `(subpath ${sbQuote(place)})`).join(' ')})`,
    // resolving a path looks at each folder above it; that is allowed (names and sizes only, never the contents of the folders in between)
    `(allow file-read-metadata ${ancestors([jobDir, ...readable]).map((place) => `(literal ${sbQuote(place)})`).join(' ')})`,
  ].join('\n');
}

export type SandboxRun = { ok: boolean; errors: string[]; seconds?: number; scenes?: number; timedOut?: boolean; /** measureOnly: what each scene really contains */ measured?: unknown[] };

/** Runs the runner (check-only or full) inside the sandbox and returns the one JSON line it prints. */
export async function runSandboxed({ python, sandbox, jobDir, briefPath, scriptPath, fontDir, ffmpegPath, checkOnly = false, lintOnly = false, previewOnly = false, measureOnly = false, timeoutMs = 5 * 60_000 }: { /** report what every scene really contains (text, camera, scrim, pictures), for the storyboard check */ measureOnly?: boolean; python: string; sandbox: SandboxKind; jobDir: string; briefPath: string; scriptPath: string; fontDir: string; ffmpegPath: string; /** validate only */ checkOnly?: boolean; /** validate, then draw sample frames and report layout problems */ lintOnly?: boolean; /** validate, then write still frames at the times in the brief (for a design review) */ previewOnly?: boolean; timeoutMs?: number }): Promise<SandboxRun> {
  // the sandbox rules match real paths: a work folder reached through a symlink (macOS /var -> /private/var) is resolved first
  const real = (place: string) => { try { return realpathSync(place); } catch { return place; } };
  jobDir = real(jobDir);
  const venv = path.resolve(path.dirname(python), '..');
  const readable = [RUNTIME_DIR, venv, fontDir, path.resolve(fontDir, '../../lora/files'), path.dirname(ffmpegPath)]; // Lora is the serif face (face="serif")
  const args = ['-I', path.join(RUNTIME_DIR, 'runner.py'), briefPath, scriptPath, ...(checkOnly ? ['--check'] : lintOnly ? ['--lint'] : previewOnly ? ['--preview'] : measureOnly ? ['--measure'] : [])];
  const env = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', PYTHONDONTWRITEBYTECODE: '1', HOME: jobDir, TMPDIR: jobDir };
  let command: string; let commandArgs: string[];
  if (sandbox === 'sandbox-exec') { command = '/usr/bin/sandbox-exec'; commandArgs = ['-p', macProfile({ jobDir, readable }), python, ...args]; }
  else { command = '/usr/bin/bwrap'; commandArgs = ['--unshare-all', '--die-with-parent', '--ro-bind', '/', '/', '--dev', '/dev', '--tmpfs', os.homedir(), ...readable.flatMap((place) => ['--ro-bind', place, place]), '--bind', jobDir, jobDir, python, ...args]; }

  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { env, cwd: jobDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => { out += chunk; if (out.length > 100_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { err += chunk; if (err.length > 100_000) err = err.slice(-50_000); });
    child.on('close', () => {
      clearTimeout(timer);
      if (timedOut) return resolve({ ok: false, errors: ['The animation took too long to draw and was stopped.'], timedOut: true });
      const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
      try { const parsed = JSON.parse(line) as { ok: boolean; errors?: string[]; seconds?: number; scenes?: number; measured?: unknown[] }; resolve({ ok: !!parsed.ok, errors: parsed.errors ?? [], seconds: parsed.seconds, scenes: parsed.scenes, ...(parsed.measured ? { measured: parsed.measured } : {}) }); }
      catch { resolve({ ok: false, errors: [`The animation process stopped without a result. ${err.trim().split('\n').pop() ?? ''}`.trim().slice(0, 300)] }); }
    });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, errors: [error.message.slice(0, 200)] }); });
  });
}
