import { afterEach, describe, expect, it } from 'vitest';
import { defaultPrefs, eventColor, loadPrefs, palette, preferencesKey, sanitizePrefs, savePrefs, statusKey, eventTextColor } from './calendar-preferences';

afterEach(() => window.localStorage.clear());

describe('saved calendar preferences', () => {
  it('starts from sensible defaults', () => {
    expect(loadPrefs('user-1')).toEqual(defaultPrefs);
    expect(defaultPrefs).toMatchObject({ view: 'month', weekStartsOn: 0, showWeekends: true, density: 'comfortable', colorBy: 'status' });
  });

  it('remembers what was saved, and keeps each user’s choices apart', () => {
    savePrefs('user-1', { ...defaultPrefs, view: 'week', weekStartsOn: 1, showWeekends: false, density: 'compact', colorBy: 'employee', employeeColors: { avery: 'blue', sarah: 'purple' } });
    savePrefs('user-2', { ...defaultPrefs, view: 'day' });
    expect(loadPrefs('user-1')).toMatchObject({ view: 'week', weekStartsOn: 1, showWeekends: false, density: 'compact', colorBy: 'employee', employeeColors: { avery: 'blue', sarah: 'purple' } });
    expect(loadPrefs('user-2').view).toBe('day');
    expect(loadPrefs('user-3')).toEqual(defaultPrefs);
    expect(preferencesKey('user-1')).not.toBe(preferencesKey('user-2'));
  });

  it('ignores damaged, old or malicious saved values instead of breaking', () => {
    window.localStorage.setItem(preferencesKey('user-1'), '{not json');
    expect(loadPrefs('user-1')).toEqual(defaultPrefs);
    const cleaned = sanitizePrefs({ view: 'year', weekStartsOn: 5, density: 'huge', colorBy: 'mood', showWeekends: 'yes', employeeColors: { avery: 'blue', sam: 'hotpink', '__proto__': 'blue' }, statusColors: { completed: 'green', weird: 'blue', cancelled: 'nope' }, show: { customer: false, status: 'yes' } });
    expect(cleaned).toMatchObject({ view: 'month', weekStartsOn: 0, density: 'comfortable', colorBy: 'status', showWeekends: true });
    expect(cleaned.employeeColors).toEqual({ avery: 'blue' });
    expect(cleaned.statusColors).toEqual({ completed: 'green' });
    expect(cleaned.show).toMatchObject({ customer: false, status: false, service: true });
    expect(loadPrefs(undefined)).toEqual(defaultPrefs);
  });
});

describe('event colours', () => {
  const names = ['Avery', 'Mike', 'Sarah'];
  const event = (overrides = {}) => ({ employee: 'Avery', service: 'Pool opening', status: 'scheduled', ...overrides });

  it('colours by status with readable defaults, and lets each status be changed', () => {
    expect(eventColor(defaultPrefs, event({ status: 'completed' }), names).id).toBe('green');
    expect(eventColor(defaultPrefs, event({ status: 'cancelled' }), names).id).toBe('gray');
    expect(eventColor(defaultPrefs, event({ status: 'booked' }), names).id).toBe('blue'); // a booked job is scheduled
    expect(eventColor(defaultPrefs, event({ status: 'in progress' }), names).id).toBe('sky');
    expect(eventColor({ ...defaultPrefs, statusColors: { completed: 'purple' } }, event({ status: 'paid' }), names).id).toBe('purple');
  });

  it('colours by employee: a custom colour wins, others get stable defaults, and nobody assigned is gray', () => {
    const prefs = { ...defaultPrefs, colorBy: 'employee' as const, employeeColors: { sarah: 'purple' } };
    expect(eventColor(prefs, event({ employee: 'sarah' }), names).id).toBe('purple');
    expect(eventColor(prefs, event({ employee: 'AVERY' }), names).id).toBe('blue');
    expect(eventColor(prefs, event({ employee: 'Mike' }), names).id).toBe('navy');
    expect(eventColor(prefs, event({ employee: null }), names).id).toBe('gray');
    expect(eventColor(prefs, event({ employee: 'Someone New' }), names)).toBeTruthy();
  });

  it('colours by service so the same service always matches', () => {
    const prefs = { ...defaultPrefs, colorBy: 'service' as const };
    expect(eventColor(prefs, event({ service: 'Pool opening' }), names).id).toBe(eventColor(prefs, event({ service: '  pool OPENING ' }), names).id);
  });

  it('only uses colours where navy text stays readable', () => {
    const luminance = (hex: string) => { const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a: string, b: string) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + 0.05) / (dark + 0.05); };
    for (const color of palette) expect(contrast(color.tint, eventTextColor)).toBeGreaterThanOrEqual(7);
  });

  it('folds appointment and job statuses into five', () => {
    expect(['booked', 'scheduled', 'confirmed', 'in_progress', 'invoiced', 'paid', 'canceled', 'completed'].map(statusKey)).toEqual(['scheduled', 'scheduled', 'confirmed', 'in_progress', 'completed', 'completed', 'cancelled', 'completed']);
  });
});
