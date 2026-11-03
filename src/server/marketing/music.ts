import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { ffmpegPath } from './standard-video/ffmpeg.js';

/**
 * Background music for the finished video. There is no music library and no paid music service behind this: Pilot composes a short
 * original instrumental in code (drums, bass, pads, a plucked or bouncing lead, a drone and a riser, depending on the mood), writes it
 * as audio, and mixes it into the video. Because it is made here for this one video, there is nothing to license.
 *
 * How the music is chosen: the brief's style words (and its instructions) become a MusicProfile (feel, tempo, key and drum level):
 *   dark / dramatic / cinematic  -> a low drone and slow pulse in a minor key (about 84 BPM), with a rising swell and a final hit
 *   fast / high energy / bold    -> a driving beat with kick, snare, hats and bass (about 124 BPM)
 *   luxury / elegant / calm      -> soft, wide pads with gentle chords and no hard drums (about 72 BPM)
 *   bright / fun / playful       -> a bouncy major-key lead over a light beat (about 112 BPM)
 *   retro                        -> a square-wave arpeggio over a steady beat (about 100 BPM)
 *   anything else                -> a clean, steady beat under soft pads (about 100 BPM)
 * A combination (dark and fast) takes the beat at a faster tempo in a minor key. If the owner asked for no music, none is added.
 * The same style and seed always give the same track.
 */
export type MusicFeel = 'drone' | 'pad' | 'beat' | 'bounce' | 'retro';
export type MusicProfile = { name: string; description: string; feel: MusicFeel; bpm: number; minor: boolean; /** 0 none, 1 light, 2 full */ drums: 0 | 1 | 2; rootMidi: number; chordBeats: number };

const has = (text: string, pattern: RegExp) => pattern.test(text);
const ROOTS_MINOR = [57, 50, 52, 55]; // A, D, E, G
const ROOTS_MAJOR = [48, 55, 50, 53]; // C, G, D, F
const hash = (text: string) => { let h = 2166136261; for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The music for a brief's style, or null when the owner asked for none. */
export function musicProfile(style: string[], instructions: string[] = [], seed = ''): MusicProfile | null {
  const asked = instructions.join(' ').toLowerCase();
  if (has(asked, /\b(?:no|without)\s+(?:background\s+)?(?:music|sound|audio|soundtrack)\b|\b(?:remove|drop|delete|turn off|mute|get rid of|take out|cut)\s+(?:the\s+)?(?:background\s+)?(?:music|sound|audio|soundtrack)\b|\b(?:silent|muted)\b/)) return null;
  const words = style.join(' ').toLowerCase();
  const fast = has(words, /\b(?:fast|high energy|energetic|tiktok style|bold|attention-grabbing|snappy)\b/);
  const dark = has(words, /\b(?:dark|dramatic|cinematic|moody|halloween)\b/);
  const soft = has(words, /\b(?:luxury|elegant|calm|slow|peaceful|minimal)\b/);
  const bright = has(words, /\b(?:bright|fun|playful|summer|christmas|valentine's|valentine|cheerful)\b/);
  const retro = has(words, /\b(?:retro|vintage)\b/);
  const dramaticAsked = has(asked, /\b(?:dramatic|cinematic|epic|intense)\b/);
  const pick = <T,>(options: T[]) => options[hash(`${seed}:${words}`) % options.length];

  let feel: MusicFeel; let bpm: number; let minor: boolean; let drums: 0 | 1 | 2; let chordBeats = 8;
  if (retro) { feel = 'retro'; bpm = 100; minor = dark; drums = 1; chordBeats = 8; }
  else if ((dark || dramaticAsked) && !fast) { feel = 'drone'; bpm = 84; minor = true; drums = 1; chordBeats = 8; }
  else if (fast) { feel = 'beat'; bpm = dark ? 110 : 124; minor = dark || !bright; drums = 2; chordBeats = 4; }
  else if (soft) { feel = 'pad'; bpm = 72; minor = false; drums = 0; chordBeats = 8; }
  else if (bright) { feel = 'bounce'; bpm = 112; minor = false; drums = 1; chordBeats = 4; }
  else { feel = 'beat'; bpm = 100; minor = false; drums = 1; chordBeats = 8; }
  const rootMidi = pick(minor ? ROOTS_MINOR : ROOTS_MAJOR);
  const kind: Record<MusicFeel, [string, string]> = {
    drone: ['Dark cinematic', 'a low drone and slow pulse in a minor key, with a rising swell and a final hit'],
    beat: [fast ? 'Driving' : 'Clean modern', fast ? 'a driving beat with kick, snare, hats and bass' : 'a clean, steady beat under soft pads'],
    pad: ['Soft and elegant', 'wide, gentle pads with slow chords and no hard drums'],
    bounce: ['Bright and bouncy', 'a bouncy major-key lead over a light beat'],
    retro: ['Retro', 'a square-wave arpeggio over a steady beat'],
  };
  return { name: kind[feel][0], description: `${kind[feel][1]}, ${bpm} BPM`, feel, bpm, minor, drums, rootMidi, chordBeats };
}

// ---- the composer ----------------------------------------------------------------------------------------------------

export const SAMPLE_RATE = 44100;
export type Track = { left: Float32Array; right: Float32Array; sampleRate: number };

const midi = (note: number) => 440 * 2 ** ((note - 69) / 12);
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1; }; }

const MINOR_PROGRESSION = [{ step: 0, third: 3 }, { step: 8, third: 4 }, { step: 3, third: 4 }, { step: 10, third: 4 }]; // i, VI, III, VII
const MAJOR_PROGRESSION = [{ step: 0, third: 4 }, { step: 7, third: 4 }, { step: 9, third: 3 }, { step: 5, third: 4 }]; // I, V, vi, IV
const chordNotes = (profile: MusicProfile, index: number, rich: boolean) => {
  const chord = (profile.minor ? MINOR_PROGRESSION : MAJOR_PROGRESSION)[index % 4];
  const root = profile.rootMidi + chord.step;
  return { root, notes: [root, root + chord.third, root + 7, ...(rich ? [root + (chord.third === 3 ? 10 : 11), root + 14] : [])] };
};

/** Composes the track. Deterministic: the same profile, length and seed always give the same audio. */
export function composeMusic(profile: MusicProfile, seconds: number, seed = ''): Track {
  const sr = SAMPLE_RATE; const total = Math.max(1, Math.round(seconds * sr));
  const noise = rng(hash(`${seed}:${profile.name}`));
  const bus = { drums: new Float32Array(total), bass: new Float32Array(total), pad: new Float32Array(total), lead: new Float32Array(total), fx: new Float32Array(total) };
  const beat = 60 / profile.bpm; const beats = Math.floor(seconds / beat);
  const add = (buffer: Float32Array, startSec: number, length: number, sample: (t: number, i: number) => number) => { const start = Math.floor(startSec * sr); const n = Math.min(Math.floor(length * sr), total - start); for (let i = 0; i < n; i += 1) buffer[start + i] += sample(i / sr, i); };

  const kick = (at: number, level = 1) => { let phase = 0; add(bus.drums, at, 0.28, (t) => { phase += (2 * Math.PI * (45 + 95 * Math.exp(-t * 26))) / sr; return Math.sin(phase) * Math.exp(-t * 8.5) * 0.9 * level; }); };
  const snare = (at: number, level = 1) => add(bus.drums, at, 0.2, (t) => (noise() * 0.5 * Math.exp(-t * 24) + Math.sin(2 * Math.PI * 190 * t) * 0.35 * Math.exp(-t * 22)) * level);
  const hat = (at: number, level = 1) => { let prev = 0; add(bus.drums, at, 0.06, (t) => { const n = noise(); const hp = n - prev; prev = n; return hp * 0.32 * Math.exp(-t * 80) * level; }); };
  const bass = (at: number, note: number, length: number, level = 1) => add(bus.bass, at, length, (t) => { const f = midi(note); const env = Math.min(1, t / 0.01) * Math.exp(-t * 3.2); return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * 0.5 * env * level; });
  const pad = (at: number, note: number, length: number, level: number, wide: number) => { const f = midi(note); const attack = Math.min(0.9, length * 0.35); const release = Math.min(1.2, length * 0.4);
    add(bus.pad, at, length + release, (t) => { const env = Math.min(1, t / attack) * (t > length ? Math.max(0, 1 - (t - length) / release) : 1);
      return [1 - wide, 1, 1 + wide].reduce((sum, detune) => sum + Math.sin(2 * Math.PI * f * detune * t) * 0.5 + Math.sin(4 * Math.PI * f * detune * t) * 0.18 + Math.sin(6 * Math.PI * f * detune * t) * 0.06, 0) * env * level / 3; }); };
  const pluck = (at: number, note: number, square: boolean, level = 1) => { const f = midi(note); add(bus.lead, at, 0.45, (t) => { const s = Math.sin(2 * Math.PI * f * t); const w = square ? Math.sign(s) * 0.5 + s * 0.3 : s + 0.3 * Math.sin(4 * Math.PI * f * t); return w * 0.34 * Math.min(1, t / 0.004) * Math.exp(-t * 7) * level; }); };

  const chordLength = profile.chordBeats * beat;
  const chords = Math.ceil(seconds / chordLength);
  for (let c = 0; c < chords; c += 1) {
    const at = c * chordLength; const { root, notes } = chordNotes(profile, c, profile.feel === 'pad' || profile.feel === 'drone');
    const length = Math.min(chordLength, seconds - at);
    const level = profile.feel === 'pad' ? 0.5 : profile.feel === 'drone' ? 0.32 : 0.26;
    notes.forEach((note, index) => pad(at, note + (profile.feel === 'drone' ? -12 : 0), length, level, 0.003 + index * 0.0007));
    if (profile.feel === 'drone') add(bus.fx, at, length + 0.5, (t) => Math.sin(2 * Math.PI * midi(root - 24) * t) * 0.5 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.18 * t)) * Math.min(1, t / 0.6));
    if (profile.drums > 0 && profile.feel !== 'pad') for (let b = 0; b < profile.chordBeats; b += 1) {
      const t0 = at + b * beat; if (t0 >= seconds - 0.2) break;
      const bassNote = root - 24; const eighth = beat / 2;
      if (profile.feel === 'beat') { bass(t0, bassNote, beat * 0.9, 0.9); bass(t0 + eighth, b % 2 ? bassNote + 7 : bassNote, eighth * 0.8, 0.6); }
      if (profile.feel === 'bounce') bass(t0, bassNote, beat * 0.55, 0.7);
      if (profile.feel === 'retro') bass(t0, bassNote, beat * 0.8, 0.7);
    }
  }

  // drums, one bar at a time
  for (let b = 0; b < beats; b += 1) {
    const at = b * beat; const inBar = b % 4;
    if (profile.feel === 'drone') { if (profile.drums && inBar === 0) kick(at, 0.7); continue; }
    if (profile.feel === 'pad') { if (inBar % 2 === 0 && b > 0) hat(at + beat / 2, 0.35); continue; }
    if (profile.drums === 2) { kick(at, 1); if (inBar === 1 || inBar === 3) snare(at, 0.85); hat(at + beat / 2, 0.9); hat(at, 0.45); }
    else { if (inBar === 0 || inBar === 2) kick(at, 0.75); if (inBar === 1 || inBar === 3) hat(at, 0.55); hat(at + beat / 2, 0.4); if (inBar === 3) snare(at, 0.5); }
  }

  // the lead: arpeggios for the bouncy and retro feels, and for the beat when it is at full drive
  if (profile.feel === 'bounce' || profile.feel === 'retro' || profile.feel === 'beat') {
    const eighth = beat / 2; const steps = Math.floor(seconds / eighth);
    for (let s = 0; s < steps; s += 1) {
      const t0 = s * eighth; const { notes } = chordNotes(profile, Math.floor(t0 / chordLength), false);
      if (profile.feel === 'beat' && s % 2 === 1) continue;
      const pattern = [0, 1, 2, 1, 0, 2, 1, 2]; const note = notes[pattern[s % 8]] + (profile.feel === 'retro' ? 12 : 12);
      pluck(t0, note, profile.feel === 'retro', profile.feel === 'beat' ? 0.55 : 1);
    }
  }

  // the dark feel builds a swell, then lands a low hit before the track fades
  if (profile.feel === 'drone') {
    const riseFrom = seconds * 0.45; const hit = Math.max(riseFrom + 0.5, seconds - 1.2); let prev = 0;
    add(bus.fx, riseFrom, hit - riseFrom, (t) => { const n = noise(); const hp = n - prev; prev = n; const k = t / (hit - riseFrom); return hp * 0.16 * k * k; });
    add(bus.fx, hit, 1.1, (t) => (Math.sin(2 * Math.PI * (48 - 8 * Math.min(1, t)) * t) * 0.85 + noise() * 0.2) * Math.exp(-t * 4));
  }

  // space: a soft echo on the pads and lead, so they sit in a room instead of sounding dry
  const echo = (buffer: Float32Array, delaySec: number, feedback: number) => { const d = Math.floor(delaySec * sr); for (let i = d; i < buffer.length; i += 1) buffer[i] += buffer[i - d] * feedback; };
  echo(bus.lead, beat * 0.75, 0.3); echo(bus.pad, beat * 1.5, 0.22);

  const gain = { drums: 0.9, bass: 0.8, pad: 0.7, lead: 0.55, fx: 0.7 };
  const left = new Float32Array(total); const right = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const centre = bus.drums[i] * gain.drums + bus.bass[i] * gain.bass + bus.fx[i] * gain.fx;
    const widePad = bus.pad[i] * gain.pad; const lead = bus.lead[i] * gain.lead;
    const lag = i > 18 ? bus.pad[i - 18] * gain.pad : 0; // a few samples of delay on one side widens the pads
    left[i] = centre + widePad + lead * 0.8; right[i] = centre + lag + lead * 1.1;
  }
  // soft limiting, then level and fades
  let peak = 0;
  for (let i = 0; i < total; i += 1) { left[i] = Math.tanh(left[i] * 1.1); right[i] = Math.tanh(right[i] * 1.1); peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
  // peak at about -3 dB: the AAC encode adds up to ~1.5 dB, so this leaves it clear of clipping
  const scale = peak > 0 ? 0.7 / peak : 1; const fadeIn = Math.min(0.3, seconds * 0.1) * sr; const fadeOut = Math.min(1.4, seconds * 0.22) * sr;
  for (let i = 0; i < total; i += 1) { const envelope = Math.min(1, i / fadeIn, (total - 1 - i) / fadeOut) * scale; left[i] *= Math.max(0, envelope); right[i] *= Math.max(0, envelope); }
  return { left, right, sampleRate: sr };
}

/** A 16-bit stereo WAV file of the track. */
export function toWav(track: Track): Buffer {
  const frames = track.left.length; const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i += 1) { data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(track.left[i] * 32767))), i * 4); data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(track.right[i] * 32767))), i * 4 + 2); }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(track.sampleRate, 24); header.writeUInt32LE(track.sampleRate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Puts the music into the video: the picture is copied untouched (no second encode), and the silent audio is replaced by the track.
 * The result is as long as the picture.
 */
export async function addMusic({ videoPath, outPath, profile, wavPath, seed = '' }: { videoPath: string; outPath: string; profile: MusicProfile; wavPath: string; seed?: string }): Promise<{ seconds: number }> {
  const binary = ffmpegPath();
  if (!binary) throw new Error('FFmpeg is not available on this server.');
  const seconds = await videoSeconds(videoPath, binary); // the track is composed to the video's real length, so it ends with the last frame
  await writeFile(wavPath, toWav(composeMusic(profile, seconds, seed)));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-i', wavPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-500); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Adding the music took too long and was stopped.')); }, 2 * 60_000);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`FFmpeg could not start: ${error.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg stopped with code ${code}. ${errors.trim()}`.trim())); });
  });
  return { seconds };
}

/** Puts a silent track under the video (used when the owner asks for the music to be taken out). The picture is copied untouched. */
export async function silenceVideo({ videoPath, outPath }: { videoPath: string; outPath: string }): Promise<void> {
  const binary = ffmpegPath();
  if (!binary) throw new Error('FFmpeg is not available on this server.');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = ''; child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-500); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Taking the music out took too long and was stopped.')); }, 2 * 60_000);
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`FFmpeg could not start: ${error.message}`)); });
    child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`FFmpeg stopped with code ${code}. ${errors.trim()}`.trim())); });
  });
}

/** How long a video is, read from FFmpeg's own report. */
export async function videoSeconds(videoPath: string, binary = ffmpegPath()): Promise<number> {
  if (!binary) throw new Error('FFmpeg is not available on this server.');
  const report = await new Promise<string>((resolve) => { const child = spawn(binary, ['-hide_banner', '-i', videoPath], { stdio: ['ignore', 'ignore', 'pipe'] }); let out = ''; child.stderr.on('data', (chunk: Buffer) => { out += chunk.toString(); }); child.on('close', () => resolve(out)); child.on('error', () => resolve(out)); });
  const match = report.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  if (!(seconds > 0.5 && seconds < 300)) throw new Error('The video length could not be read.');
  return seconds;
}
