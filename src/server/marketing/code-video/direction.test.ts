import { describe, expect, it } from 'vitest';
import { inferDirection } from './direction.js';

const reply = JSON.stringify({ business: { name: 'Acme Co', type: 'Software', description: 'Runs the office.', services: ['Scheduling'], location: '', tone: 'calm' }, audience: 'small business owners', selling_point: 'Saves hours of admin', objective: 'sign-ups', video_type: 'how-it-works explainer', platform: 'general', format: 'landscape', seconds: 99, pacing: 'measured', visual_direction: 'clean interface motion', music: { mood: 'optimistic', tempo: '100 bpm', instruments: 'soft piano', arc: 'builds', energy: 'medium' }, cta: 'Get started', subject: 'office admin on autopilot', why: 'a software product is best explained', brand_colour: '#2F6BFF' });

describe('the inferred brief for a bare request', () => {
  it('is decided from the business, capped at 45 seconds, and the owner\'s words win', async () => {
    const seen: string[] = []; const complete = async (_s: string, p: string) => { seen.push(p); return reply; };
    const d = await inferDirection({ request: 'Make me a video for this company', context: 'WEBSITE acme.example: Acme runs the office.' }, complete);
    expect(d?.format).toBe('landscape'); expect(d?.seconds).toBe(45); expect(d?.music.mood).toBe('optimistic'); expect(seen[0]).toMatch(/No explicit requirements/);
    const owned = await inferDirection({ request: 'Make it 15 seconds', context: 'x', owner: { seconds: 15, platform: 'tiktok' } }, complete);
    expect(owned?.seconds).toBe(15); expect(owned?.platform).toBe('tiktok');
  });
});
