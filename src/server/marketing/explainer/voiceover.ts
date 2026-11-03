import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { getSecret } from '#airo/secrets';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { videoSeconds } from '../music.js';

const run = promisify(execFile);

/**
 * The voice for an explainer. Providers, in the order PILOT_VOICEOVER chooses:
 *   openai  OpenAI's text-to-speech (the same OPENAI_API_KEY Pilot writes with): natural, warm voice, about 1 US cent for a 40-second video
 *   system  this computer's own voice (macOS `say`): free, works offline, but sounds robotic and exists only on a Mac
 *   off     no voice (music only)
 * "auto" (the default) uses openai only when PILOT_VOICEOVER=openai is set explicitly (it costs money), otherwise the free system voice where there is
 * one, otherwise none. A scene's narration that cannot be spoken is simply silent: the video is still made.
 */
export type VoiceProvider = 'openai' | 'system';
export type Narration = { provider: VoiceProvider | null; /** one file per scene, or null where it could not be made */ files: Array<string | null>; seconds: number[] };

export const voiceMode = (): 'auto' | 'openai' | 'system' | 'off' => { const v = (process.env.PILOT_VOICEOVER ?? 'auto').trim().toLowerCase(); return v === 'openai' || v === 'system' || v === 'off' ? v : 'auto'; };

async function systemVoice(): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  try { const { stdout } = await run('/usr/bin/say', ['-v', '?'], { timeout: 10_000 }); const names = stdout.split('\n').map((line) => line.split(/\s{2,}/)[0]?.trim()).filter(Boolean); return ['Samantha', 'Ava (Premium)', 'Ava', 'Daniel'].find((voice) => names.includes(voice)) ?? 'Samantha'; } catch { return null; }
}

export async function pickProvider(): Promise<VoiceProvider | null> {
  const mode = voiceMode();
  if (mode === 'off') return null;
  const key = getSecret('OPENAI_API_KEY');
  if (mode === 'openai') return typeof key === 'string' && key ? 'openai' : (await systemVoice()) ? 'system' : null;
  return (await systemVoice()) ? 'system' : null;
}

async function openAiSpeech(text: string, file: string): Promise<void> {
  const key = getSecret('OPENAI_API_KEY'); if (typeof key !== 'string' || !key) throw new Error('no key');
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'nova', input: text, response_format: 'mp3', instructions: 'Warm, upbeat and clear, like a friendly guide in a product explainer. A steady, unhurried pace with natural pauses between sentences.' }),
  });
  if (!response.ok) throw new Error(`speech ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function systemSpeech(text: string, file: string): Promise<void> {
  const voice = await systemVoice(); if (!voice) throw new Error('no system voice');
  await run('/usr/bin/say', ['-v', voice, '-r', '178', '-o', file, '--', text], { timeout: 60_000 });
}

/** Speaks each scene's narration. A line that fails comes back as null (its scene is silent); the others are kept. */
export async function narrate({ lines, workDir, provider, speak }: { lines: string[]; workDir: string; provider?: VoiceProvider | null; speak?: (text: string, file: string) => Promise<void> }): Promise<Narration> {
  const chosen = provider === undefined ? await pickProvider() : provider;
  if (!chosen && !speak) return { provider: null, files: lines.map(() => null), seconds: lines.map(() => 0) };
  const files: Array<string | null> = []; const seconds: number[] = [];
  for (const [index, line] of lines.entries()) {
    const file = path.join(workDir, `voice-${index}.${chosen === 'system' ? 'aiff' : 'mp3'}`);
    try {
      await (speak ?? (chosen === 'openai' ? openAiSpeech : systemSpeech))(line, file);
      const length = await videoSeconds(file, ffmpegPath() ?? undefined);
      if (!(length > 0.3)) throw new Error('empty speech');
      files.push(file); seconds.push(length);
    } catch (error) { console.error('voice line failed', error instanceof Error ? error.message.replace(/sk-[\w-]+/g, '[key]').slice(0, 120) : 'unknown'); files.push(null); seconds.push(0); }
  }
  return { provider: files.some(Boolean) ? chosen ?? 'system' : null, files, seconds };
}
