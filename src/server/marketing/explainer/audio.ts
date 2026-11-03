import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ffmpegPath } from '../standard-video/ffmpeg.js';
import { composeMusic, toWav, videoSeconds, type MusicProfile } from '../music.js';

/**
 * Puts the voice and the music under the silent picture. Each scene's narration starts a moment after its scene does; the music is original (made
 * for this video), sits low, and ducks (dips further) whenever the voice speaks, so the words stay clear. If this FFmpeg has no ducking filter the
 * music is simply kept low. The picture is copied untouched.
 */
export type VoiceClip = { file: string; startSeconds: number };

function ffmpeg(args: string[]): Promise<void> {
  const binary = ffmpegPath();
  if (!binary) return Promise.reject(new Error('FFmpeg is not available on this server.'));
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-600); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Mixing the sound took too long and was stopped.')); }, 3 * 60_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg stopped with code ${code}. ${errors.trim()}`)); });
  });
}

export async function mixSound({ videoPath, outPath, voice, music, seed = '', workDir }: { videoPath: string; outPath: string; voice: VoiceClip[]; music: MusicProfile | null; seed?: string; workDir: string }): Promise<{ seconds: number; ducked: boolean }> {
  const seconds = await videoSeconds(videoPath);
  if (!voice.length && !music) { await ffmpeg(['-i', videoPath, '-c', 'copy', '-movflags', '+faststart', outPath]); return { seconds, ducked: false }; }
  const inputs = ['-i', videoPath]; const filters: string[] = [];
  let musicLabel: string | null = null;
  if (music) { const wav = path.join(workDir, 'music-bed.wav'); await writeFile(wav, toWav(composeMusic(music, seconds, seed))); inputs.push('-i', wav); musicLabel = `${voice.length ? 0.3 : 0.7}`; }
  const offset = music ? 2 : 1;
  voice.forEach((clip) => inputs.push('-i', clip.file));
  const voiceLabels = voice.map((clip, i) => { filters.push(`[${offset + i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(clip.startSeconds * 1000)}|${Math.round(clip.startSeconds * 1000)},volume=1.25[v${i}]`); return `[v${i}]`; });
  let ducked = false;
  const finish = (graph: string[], map: string) => ffmpeg([...inputs, '-filter_complex', graph.join(';'), '-map', '0:v:0', '-map', map, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(seconds), '-movflags', '+faststart', outPath]);

  if (voice.length && music) {
    const voiceMix = voiceLabels.length === 1 ? [`${voiceLabels[0]}anull[vm]`] : [`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[vm]`];
    const bed = [`[1:a]volume=${musicLabel}[m]`];
    try {
      await finish([...filters, ...voiceMix, ...bed, '[vm]asplit=2[vm1][vm2]', '[m][vm1]sidechaincompress=threshold=0.015:ratio=9:attack=15:release=450[md]', '[md][vm2]amix=inputs=2:normalize=0:duration=longest[aud]'], '[aud]');
      ducked = true;
    } catch { await finish([...filters, ...voiceMix, ...bed, '[m][vm]amix=inputs=2:normalize=0:duration=longest[aud]'], '[aud]'); }
  } else if (voice.length) {
    await finish([...filters, `${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0[aud]`.replace(/^\[v0\]amix=inputs=1:normalize=0:dropout_transition=0/, '[v0]anull')], '[aud]');
  } else {
    await finish([`[1:a]volume=${musicLabel}[aud]`], '[aud]');
  }
  return { seconds, ducked };
}
