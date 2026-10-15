import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarClock, Save, Settings2 } from 'lucide-react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { booking_rules } from 'virtual:content';

type DayHours = { enabled: boolean; start: string; end: string };
type WeeklyHours = Record<string, DayHours>;
type BookingSettings = {
  defaultDurationMinutes: number; bufferMinutes: number; allowOverlaps: boolean; maxConcurrentAppointments: number;
  minimumNoticeMinutes: number; bookingWindowDays: number; allowSameDay: boolean; reschedulingPolicy: 'anytime' | 'notice' | 'disabled';
  reschedulingNoticeHours: number; cancellationPolicy: 'anytime' | 'notice' | 'disabled'; cancellationNoticeHours: number; weeklyHours: WeeklyHours;
};

const fieldClass = 'mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-primary';

function minuteLabel(minutes: number) { return minutes === 0 ? 'No buffer' : minutes === 120 ? '2 hours' : `${minutes} minutes`; }

function BookingRulesContent() {
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { void (async () => {
    try {
      const response = await fetch('/api/booking-rules', { credentials: 'include' });
      const payload = await response.json() as { settings?: BookingSettings; error?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.error || booking_rules.errors.load);
      setSettings(payload.settings);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : booking_rules.errors.load); }
  })(); }, []);

  function update<K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) { setSettings((current) => current ? { ...current, [key]: value } : current); }
  function updateHours(day: string, value: Partial<DayHours>) { setSettings((current) => current ? { ...current, weeklyHours: { ...current.weeklyHours, [day]: { ...current.weeklyHours[day], ...value } } } : current); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/booking-rules', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      const payload = await response.json() as { settings?: BookingSettings; error?: string };
      if (!response.ok || !payload.settings) throw new Error(payload.error || booking_rules.errors.save);
      setSettings(payload.settings); setNotice(booking_rules.actions.saved);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : booking_rules.errors.save); } finally { setSaving(false); }
  }

  if (!settings && !error) return <WorkspaceLayout><main className="py-xxl"><p className="text-sm font-bold text-muted-foreground">Loading booking rules...</p></main></WorkspaceLayout>;
  if (!settings) return <WorkspaceLayout><main className="py-xxl"><p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p></main></WorkspaceLayout>;

  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="flex flex-col justify-between gap-base border-b border-border pb-lg sm:flex-row sm:items-end"><div><Link to="/calendar" className="text-sm font-bold text-primary hover:text-secondary">{booking_rules.navigation.back}</Link><p className="mt-base text-sm font-bold text-primary">{booking_rules.hero.eyebrow}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{booking_rules.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{booking_rules.hero.description}</p></div><span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary"><Settings2 size={23} /></span></section>
    <form onSubmit={save} className="grid gap-xl">
      <section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><CalendarClock size={20} /></span><div><h2 className="text-xl font-extrabold text-secondary">{booking_rules.sections.appointments}</h2><p className="mt-1 text-sm text-muted-foreground">These controls apply to appointments created by your calendar and receptionist.</p></div></div>
        <div className="mt-xl grid grid-cols-1 gap-base lg:grid-cols-2">
          <label className="text-sm font-bold text-secondary">{booking_rules.fields.duration}<span className="mt-1 block font-normal leading-5 text-muted-foreground">{booking_rules.fields.durationHelp}</span><select value={settings.defaultDurationMinutes} onChange={(event) => update('defaultDurationMinutes', Number(event.target.value))} className={fieldClass}>{booking_rules.durationOptions.map((value) => <option key={value} value={value}>{minuteLabel(value)}</option>)}<option value={settings.defaultDurationMinutes}>Custom: {minuteLabel(settings.defaultDurationMinutes)}</option></select></label>
          <label className="text-sm font-bold text-secondary">{booking_rules.fields.buffer}<span className="mt-1 block font-normal leading-5 text-muted-foreground">{booking_rules.fields.bufferHelp}</span><select value={settings.bufferMinutes} onChange={(event) => update('bufferMinutes', Number(event.target.value))} className={fieldClass}>{booking_rules.bufferOptions.map((value) => <option key={value} value={value}>{minuteLabel(value)}</option>)}<option value={settings.bufferMinutes}>Custom: {minuteLabel(settings.bufferMinutes)}</option></select></label>
          <label className="text-sm font-bold text-secondary">{booking_rules.fields.minimumNotice}<span className="mt-1 block font-normal leading-5 text-muted-foreground">{booking_rules.fields.minimumNoticeHelp}</span><input value={settings.minimumNoticeMinutes || ''} onChange={(event) => update('minimumNoticeMinutes', Number(event.target.value))} min="0" max="10080" type="number" className={fieldClass} placeholder="120" /></label>
          <label className="text-sm font-bold text-secondary">{booking_rules.fields.bookingWindow}<span className="mt-1 block font-normal leading-5 text-muted-foreground">{booking_rules.fields.bookingWindowHelp}</span><input value={settings.bookingWindowDays} onChange={(event) => update('bookingWindowDays', Number(event.target.value))} min="1" max="730" type="number" className={fieldClass} placeholder="90" /></label>
        </div>
        <div className="mt-base grid gap-base border-t border-border pt-base lg:grid-cols-2"><div className="rounded-2xl bg-muted p-base"><p className="text-sm font-extrabold text-secondary">{booking_rules.fields.overlaps}</p><label className="mt-3 flex items-center gap-3 text-sm text-secondary"><input checked={!settings.allowOverlaps} onChange={() => update('allowOverlaps', false)} type="radio" name="overlaps" className="h-4 w-4 accent-primary" />{booking_rules.fields.overlapsNo}</label><label className="mt-3 flex items-center gap-3 text-sm text-secondary"><input checked={settings.allowOverlaps} onChange={() => update('allowOverlaps', true)} type="radio" name="overlaps" className="h-4 w-4 accent-primary" />{booking_rules.fields.overlapsYes}</label>{settings.allowOverlaps && <input value={settings.maxConcurrentAppointments} onChange={(event) => update('maxConcurrentAppointments', Number(event.target.value))} min="2" max="20" type="number" className={fieldClass} />}</div><div className="rounded-2xl bg-muted p-base"><p className="text-sm font-extrabold text-secondary">{booking_rules.fields.sameDay}</p><label className="mt-3 flex items-center gap-3 text-sm text-secondary"><input checked={settings.allowSameDay} onChange={() => update('allowSameDay', true)} type="radio" name="same-day" className="h-4 w-4 accent-primary" />{booking_rules.fields.sameDayAllow}</label><label className="mt-3 flex items-center gap-3 text-sm text-secondary"><input checked={!settings.allowSameDay} onChange={() => update('allowSameDay', false)} type="radio" name="same-day" className="h-4 w-4 accent-primary" />{booking_rules.fields.sameDayDisallow}</label></div></div>
        <div className="mt-base grid grid-cols-1 gap-base border-t border-border pt-base lg:grid-cols-2">{([{ title: booking_rules.fields.rescheduling, policyKey: 'reschedulingPolicy', noticeKey: 'reschedulingNoticeHours', disabled: booking_rules.fields.disabledRescheduling }, { title: booking_rules.fields.cancellations, policyKey: 'cancellationPolicy', noticeKey: 'cancellationNoticeHours', disabled: booking_rules.fields.disabledCancellations }] as const).map((rule) => <div key={rule.policyKey} className="rounded-2xl border border-border p-base"><p className="text-sm font-extrabold text-secondary">{rule.title}</p><select value={settings[rule.policyKey]} onChange={(event) => update(rule.policyKey, event.target.value as BookingSettings[typeof rule.policyKey])} className={fieldClass}><option value="anytime">{booking_rules.fields.anytime}</option><option value="notice">{booking_rules.fields.notice}</option><option value="disabled">{rule.disabled}</option></select>{settings[rule.policyKey] === 'notice' && <input value={settings[rule.noticeKey]} onChange={(event) => update(rule.noticeKey, Number(event.target.value))} min="0" max="720" type="number" className={fieldClass} />}</div>)}</div>
      </section>
      <section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><h2 className="text-xl font-extrabold text-secondary">{booking_rules.sections.availability}</h2><p className="mt-1 text-sm text-muted-foreground">{booking_rules.fields.hoursHelp}</p><div className="mt-xl grid gap-3">{booking_rules.days.map((day) => { const hours = settings.weeklyHours[day.key]; return <div key={day.key} className="grid grid-cols-1 items-center gap-3 rounded-2xl bg-muted p-4 md:grid-cols-[150px_1fr_1fr]"><label className="flex items-center gap-3 text-sm font-extrabold text-secondary"><input checked={hours.enabled} onChange={(event) => updateHours(day.key, { enabled: event.target.checked })} type="checkbox" className="h-4 w-4 accent-primary" />{day.label}</label>{hours.enabled ? <><input aria-label={`${day.label} start time`} type="time" value={hours.start} onChange={(event) => updateHours(day.key, { start: event.target.value })} className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-secondary" /><input aria-label={`${day.label} end time`} type="time" value={hours.end} onChange={(event) => updateHours(day.key, { end: event.target.value })} className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-secondary" /></> : <p className="text-sm font-semibold text-muted-foreground md:col-span-2">{booking_rules.fields.closed}</p>}</div>; })}</div></section>
      {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}{notice && <p role="status" className="rounded-xl border border-primary bg-accent p-4 text-sm font-bold text-secondary">{notice}</p>}<div className="flex justify-end"><button disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-secondary disabled:opacity-60"><Save size={17} />{saving ? booking_rules.actions.saving : booking_rules.actions.save}</button></div>
    </form>
  </main></WorkspaceLayout>;
}

export default function BookingRulesPage() { return <><Helmet><title>{booking_rules.seo.title}</title><meta name="description" content={booking_rules.seo.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><BookingRulesContent /></ProtectedRoute></>; }
