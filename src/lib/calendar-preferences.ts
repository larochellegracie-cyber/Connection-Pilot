/**
 * How an owner likes their calendar to look. Display-only: nothing here touches appointments,
 * jobs, shifts or any scheduling rule.
 */
export type CalendarView = 'month' | 'week' | 'day';
export type ColorBy = 'employee' | 'service' | 'status';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type StatusKey = 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export type CalendarPrefs = {
  view: CalendarView;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  density: Density;
  colorBy: ColorBy;
  /** Custom colour per employee, keyed by lower-case name. Values are palette ids. */
  employeeColors: Record<string, string>;
  statusColors: Partial<Record<StatusKey, string>>;
  show: { customer: boolean; service: boolean; employee: boolean; status: boolean; completed: boolean; cancelled: boolean };
};

/** Every colour pairs a strong accent (the edge and dot) with a pale tint behind navy text, so the words stay readable on any of them. */
export const palette = [
  { id: 'blue', label: 'Blue', accent: '#2454D6', tint: '#DCE7FF' },
  { id: 'navy', label: 'Navy', accent: '#0B1F44', tint: '#D9DEEA' },
  { id: 'sky', label: 'Sky', accent: '#0E7FB8', tint: '#D6EEFA' },
  { id: 'teal', label: 'Teal', accent: '#0F8F7D', tint: '#D4F1EC' },
  { id: 'green', label: 'Green', accent: '#2E8B3D', tint: '#DDF3DF' },
  { id: 'purple', label: 'Purple', accent: '#7C3AED', tint: '#EADFFD' },
  { id: 'pink', label: 'Pink', accent: '#C2377D', tint: '#FBE0EE' },
  { id: 'red', label: 'Red', accent: '#C62828', tint: '#FBDDDD' },
  { id: 'amber', label: 'Amber', accent: '#B45309', tint: '#FCEBC8' },
  { id: 'gray', label: 'Gray', accent: '#5B6B86', tint: '#E8ECF3' },
] as const;
export type PaletteColor = (typeof palette)[number];
export const eventTextColor = '#0B1F44';
const colorFor = (id: string | undefined): PaletteColor | undefined => palette.find((color) => color.id === id);
/** Colours handed out automatically; gray is kept for "nobody assigned" and cancelled. */
const automatic = palette.filter((color) => color.id !== 'gray');

export const statusDefaults: Record<StatusKey, string> = { scheduled: 'blue', confirmed: 'navy', in_progress: 'sky', completed: 'green', cancelled: 'gray' };
export const statusLabels: Record<StatusKey, string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const statusKeys = Object.keys(statusDefaults) as StatusKey[];

/** Appointments and jobs use slightly different words; this folds them into the five the calendar shows. */
export function statusKey(raw: string): StatusKey {
  const value = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (['completed', 'complete', 'done', 'invoiced', 'paid'].includes(value)) return 'completed';
  if (['cancelled', 'canceled', 'no_show'].includes(value)) return 'cancelled';
  if (['in_progress', 'active', 'started'].includes(value)) return 'in_progress';
  if (value === 'confirmed') return 'confirmed';
  return 'scheduled';
}

export const defaultPrefs: CalendarPrefs = {
  view: 'month', weekStartsOn: 0, showWeekends: true, density: 'comfortable', colorBy: 'status', employeeColors: {}, statusColors: {},
  show: { customer: true, service: true, employee: true, status: false, completed: true, cancelled: true },
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? value as T : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

/** Reads whatever was saved and keeps only values that are valid, so a damaged or old save can never break the calendar. */
export function sanitizePrefs(raw: unknown): CalendarPrefs {
  const input = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
  const colors = (value: unknown, allowedKeys?: readonly string[]) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value as Record<string, unknown> : {}).filter(([key, id]) => typeof id === 'string' && colorFor(id) && (!allowedKeys || allowedKeys.includes(key))).slice(0, 200));
  const show = input.show && typeof input.show === 'object' ? input.show as Record<string, unknown> : {};
  return {
    view: oneOf(input.view, ['month', 'week', 'day'], defaultPrefs.view),
    weekStartsOn: input.weekStartsOn === 1 ? 1 : 0,
    showWeekends: flag(input.showWeekends, defaultPrefs.showWeekends),
    density: oneOf(input.density, ['compact', 'comfortable', 'spacious'], defaultPrefs.density),
    colorBy: oneOf(input.colorBy, ['employee', 'service', 'status'], defaultPrefs.colorBy),
    employeeColors: colors(input.employeeColors) as Record<string, string>,
    statusColors: colors(input.statusColors, statusKeys) as CalendarPrefs['statusColors'],
    show: { customer: flag(show.customer, true), service: flag(show.service, true), employee: flag(show.employee, true), status: flag(show.status, false), completed: flag(show.completed, true), cancelled: flag(show.cancelled, true) },
  };
}

/** One saved set per signed-in user. Each user has one business, so this also keeps businesses apart. */
export const preferencesKey = (userId: string) => `cp-calendar-prefs:v1:${userId}`;

export function loadPrefs(userId: string | undefined): CalendarPrefs {
  if (!userId) return defaultPrefs;
  try { const raw = window.localStorage.getItem(preferencesKey(userId)); return raw ? sanitizePrefs(JSON.parse(raw)) : defaultPrefs; } catch { return defaultPrefs; }
}
export function savePrefs(userId: string | undefined, prefs: CalendarPrefs) {
  if (!userId) return;
  try { window.localStorage.setItem(preferencesKey(userId), JSON.stringify(prefs)); } catch { /* preferences are a convenience; the calendar still works without saving */ }
}

export type EventIdentity = { employee: string | null; service: string; status: string };

function hash(value: string) { let total = 0; for (const character of value) total = (total * 31 + character.charCodeAt(0)) >>> 0; return total; }

/** The colour for an event under the owner's chosen "colour by" rule. `employeeNames` is every known employee, in a stable order, so default colours do not shuffle. */
export function eventColor(prefs: CalendarPrefs, event: EventIdentity, employeeNames: string[]): PaletteColor {
  if (prefs.colorBy === 'employee') {
    const name = event.employee?.trim().toLowerCase();
    if (!name) return colorFor('gray')!;
    const custom = colorFor(prefs.employeeColors[name]);
    if (custom) return custom;
    const index = employeeNames.map((item) => item.toLowerCase()).indexOf(name);
    return automatic[(index >= 0 ? index : hash(name)) % automatic.length];
  }
  if (prefs.colorBy === 'service') return automatic[hash(event.service.trim().toLowerCase()) % automatic.length];
  const key = statusKey(event.status);
  return colorFor(prefs.statusColors[key]) ?? colorFor(statusDefaults[key])!;
}

export function defaultEmployeeColor(name: string, employeeNames: string[]): PaletteColor {
  const index = employeeNames.map((item) => item.toLowerCase()).indexOf(name.toLowerCase());
  return automatic[(index >= 0 ? index : hash(name.toLowerCase())) % automatic.length];
}
