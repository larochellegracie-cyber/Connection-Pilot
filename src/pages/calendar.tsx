import { Helmet } from '@dr.pogodin/react-helmet';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Plus, X } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { isFoodBusiness } from '@/lib/business-workflow';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { calendar } from 'virtual:content';

type Customer = { id: string; name: string; phoneNumber: string };
type Appointment = { id: string; title: string; status: 'scheduled' | 'completed' | 'cancelled'; scheduledAt: string; durationMinutes: number; notes: string | null; customerId: string; customerName: string; customerPhoneNumber: string; customerEmail: string | null };
type Job = { id: string; customerName: string; service: string; status: string; scheduledAt: string | null; assignedEmployee: string | null };
type CalendarData = { businessType: string; appointments: Appointment[]; settings: { timezone: string; defaultDurationMinutes: number } };
type View = 'month' | 'week' | 'day';
type DateParts = { year: number; month: number; day: number; hour?: number; minute?: number };

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const localDateFormat = (timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

function partsFor(date: Date, timezone: string, withTime = false): DateParts {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) });
  const parts = format.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: value('year'), month: value('month'), day: value('day'), ...(withTime ? { hour: value('hour'), minute: value('minute') } : {}) };
}
function businessDateKey(date: Date, timezone: string) { return localDateFormat(timezone).format(date); }
function zonedDate(parts: DateParts, timezone: string) {
  const hour = parts.hour ?? 12;
  const minute = parts.minute ?? 0;
  let instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute));
  for (let index = 0; index < 3; index += 1) {
    const actual = partsFor(instant, timezone, true);
    const targetMinutes = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
    const actualMinutes = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour || 0, actual.minute || 0);
    if (targetMinutes === actualMinutes) break;
    instant = new Date(instant.getTime() + targetMinutes - actualMinutes);
  }
  return instant;
}
function addBusinessDays(date: Date, days: number, timezone: string) {
  const current = partsFor(date, timezone);
  const shifted = new Date(Date.UTC(current.year, current.month - 1, current.day + days));
  return zonedDate({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }, timezone);
}
function weekStart(date: Date, timezone: string) { return addBusinessDays(date, -new Date(`${businessDateKey(date, timezone)}T12:00:00Z`).getUTCDay(), timezone); }
function rangeFor(view: View, cursor: Date, timezone: string) {
  if (view === 'day') return { from: zonedDate({ ...partsFor(cursor, timezone), hour: 0, minute: 0 }, timezone), to: addBusinessDays(cursor, 1, timezone) };
  if (view === 'week') { const from = weekStart(cursor, timezone); return { from: zonedDate({ ...partsFor(from, timezone), hour: 0, minute: 0 }, timezone), to: addBusinessDays(from, 7, timezone) }; }
  const current = partsFor(cursor, timezone); const first = zonedDate({ year: current.year, month: current.month, day: 1 }, timezone); const from = addBusinessDays(first, -new Date(Date.UTC(current.year, current.month - 1, 1)).getUTCDay(), timezone); return { from: zonedDate({ ...partsFor(from, timezone), hour: 0, minute: 0 }, timezone), to: addBusinessDays(from, 42, timezone) };
}
function inputValue(value: string, timezone: string) { const parts = partsFor(new Date(value), timezone, true); return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`; }
function parseInput(value: string, timezone: string) { const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value); return match ? zonedDate({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) }, timezone) : null; }
function timeLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function dateLabel(value: string, timezone: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function CalendarContent() {
  const [view, setView] = useState<View>('month');
  const [data, setData] = useState<CalendarData | null>(null);
  const timezone = data?.settings.timezone || 'America/Toronto';
  const [cursor, setCursor] = useState(() => zonedDate(partsFor(new Date(), 'America/Toronto'), 'America/Toronto'));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const range = useMemo(() => rangeFor(view, cursor, timezone), [view, cursor, timezone]);
  const displayedDays = useMemo(() => view === 'day' ? [cursor] : Array.from({ length: view === 'week' ? 7 : 42 }, (_, index) => addBusinessDays(range.from, index, timezone)), [view, cursor, range.from, timezone]);

  async function loadCalendar() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
      const [calendarResponse, customerResponse, jobResponse] = await Promise.all([fetch(`/api/calendar?${params}`, { credentials: 'include' }), fetch('/api/customers', { credentials: 'include' }), fetch('/api/jobs', { credentials: 'include' })]);
      const calendarPayload = await calendarResponse.json() as CalendarData & { error?: string };
      if (!calendarResponse.ok) throw new Error(calendarPayload.error || 'Unable to load your calendar.');
      setData(calendarPayload);
      if (customerResponse.ok) setCustomers((await customerResponse.json() as { customers: Customer[] }).customers);
      if (jobResponse.ok) setJobs((await jobResponse.json() as { jobs: Job[] }).jobs);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load your calendar.'); } finally { setLoading(false); }
  }
  useEffect(() => { void loadCalendar(); }, [range.from.getTime(), range.to.getTime()]);
  const appointmentsFor = (day: Date) => (data?.appointments || []).filter((appointment) => businessDateKey(new Date(appointment.scheduledAt), timezone) === businessDateKey(day, timezone));
  const jobsFor = (day: Date) => jobs.filter((job) => job.scheduledAt && job.status !== 'cancelled' && businessDateKey(new Date(job.scheduledAt), timezone) === businessDateKey(day, timezone));
  const openCreate = (day?: Date) => { const date = day ? zonedDate({ ...partsFor(day, timezone), hour: 9, minute: 0 }, timezone) : null; setSelected(date ? { id: '', title: '', status: 'scheduled', scheduledAt: date.toISOString(), durationMinutes: data?.settings.defaultDurationMinutes || 60, notes: null, customerId: customers[0]?.id || '', customerName: '', customerPhoneNumber: '', customerEmail: null } : null); setCreating(true); setEditing(false); };
  const moveCursor = (direction: number) => setCursor((current) => addBusinessDays(current, direction * (view === 'month' ? 30 : view === 'week' ? 7 : 1), timezone));

  async function saveAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const scheduledAt = parseInput(String(form.get('scheduledAt') || ''), timezone);
    if (!scheduledAt) { setError('Choose a valid date and time.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { customerId: form.get('customerId'), title: form.get('title'), scheduledAt: scheduledAt.toISOString(), durationMinutes: Number(form.get('durationMinutes')), notes: form.get('notes'), status: form.get('status') };
      const response = await fetch(selected?.id ? `/api/calendar/${selected.id}` : '/api/calendar', { method: selected?.id ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const responsePayload = await response.json() as { error?: string }; if (!response.ok) throw new Error(responsePayload.error || 'Unable to save the appointment.');
      setCreating(false); setEditing(false); setSelected(null); await loadCalendar();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save the appointment.'); } finally { setSaving(false); }
  }
  async function cancelAppointment() {
    if (!selected?.id) return; setSaving(true);
    try { const response = await fetch(`/api/calendar/${selected.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || 'Unable to cancel the appointment.'); setSelected(null); setEditing(false); await loadCalendar(); } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel the appointment.'); } finally { setSaving(false); }
  }

  const current = partsFor(cursor, timezone); const heading = view === 'month' ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'long', year: 'numeric' }).format(cursor) : view === 'week' ? `${new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric' }).format(range.from)} – ${new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(addBusinessDays(range.to, -1, timezone))}` : new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(cursor);
  const closeDialog = () => { setSelected(null); setCreating(false); setEditing(false); };
  if (data && isFoodBusiness(data.businessType)) return <Navigate to="/jobs" replace />;
  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="flex flex-col justify-between gap-base border-b border-border pb-lg sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-primary">Business scheduling · {timezone}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{calendar.title}</h1><p className="mt-sm text-muted-foreground">{calendar.description}</p></div><button onClick={() => openCreate()} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-secondary"><Plus size={17} />{calendar.newAppointment}</button></section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}
    <section className="rounded-3xl border border-border bg-card p-base sm:p-xl"><div className="flex flex-col justify-between gap-base border-b border-border pb-base lg:flex-row lg:items-center"><div className="flex flex-wrap items-center gap-2"><button aria-label={calendar.previous} onClick={() => moveCursor(-1)} className="rounded-lg border border-border p-2 text-secondary hover:border-primary"><ChevronLeft size={18} /></button><button aria-label={calendar.next} onClick={() => moveCursor(1)} className="rounded-lg border border-border p-2 text-secondary hover:border-primary"><ChevronRight size={18} /></button><button onClick={() => setCursor(zonedDate(partsFor(new Date(), timezone), timezone))} className="rounded-lg border border-border px-3 py-2 text-sm font-bold text-secondary hover:border-primary">{calendar.today}</button><h2 className="text-lg font-extrabold text-secondary sm:text-xl">{heading}</h2></div><div role="group" aria-label="Calendar view" className="flex rounded-lg bg-muted p-1"><button onClick={() => setView('month')} className={`rounded-md px-3 py-2 text-sm font-bold ${view === 'month' ? 'bg-card text-secondary shadow-sm' : 'text-muted-foreground'}`}>{calendar.month}</button><button onClick={() => setView('week')} className={`rounded-md px-3 py-2 text-sm font-bold ${view === 'week' ? 'bg-card text-secondary shadow-sm' : 'text-muted-foreground'}`}>{calendar.week}</button><button onClick={() => setView('day')} className={`rounded-md px-3 py-2 text-sm font-bold ${view === 'day' ? 'bg-card text-secondary shadow-sm' : 'text-muted-foreground'}`}>{calendar.day}</button></div></div>
    {loading ? <p className="py-xl text-sm text-muted-foreground">Loading appointments...</p> : <div className="mt-base overflow-x-auto"><div className={view === 'day' ? 'min-w-[320px]' : 'min-w-[760px]'}><div className={`grid border-l border-t border-border ${view === 'day' ? 'grid-cols-1' : 'grid-cols-7'}`}>{(view === 'day' ? [cursor] : weekdays).map((label, index) => <div key={typeof label === 'string' ? label : index} className="border-b border-r border-border bg-muted px-3 py-2 text-xs font-bold text-muted-foreground">{typeof label === 'string' ? label : new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(label)}</div>)}</div><div className={`grid border-l border-border ${view === 'day' ? 'grid-cols-1' : 'grid-cols-7'}`}>{displayedDays.map((day) => <div key={businessDateKey(day, timezone)} className={`min-h-32 border-b border-r border-border p-2 ${view === 'month' && partsFor(day, timezone).month !== current.month ? 'bg-muted' : 'bg-card'}`}><div className="mb-2 flex items-center justify-between"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${businessDateKey(day, timezone) === businessDateKey(new Date(), timezone) ? 'bg-primary text-primary-foreground' : 'text-secondary'}`}>{partsFor(day, timezone).day}</span><button aria-label={`Add appointment on ${businessDateKey(day, timezone)}`} onClick={() => openCreate(day)} className="text-primary hover:text-secondary"><Plus size={15} /></button></div><div className="grid gap-1">{appointmentsFor(day).map((appointment) => <button key={appointment.id} onClick={() => { setSelected(appointment); setEditing(false); setCreating(false); }} className={`rounded-md px-2 py-1 text-left text-xs font-bold ${appointment.status === 'cancelled' ? 'bg-muted text-muted-foreground line-through' : appointment.status === 'completed' ? 'bg-card text-secondary border border-border' : 'bg-accent text-primary'}`}><span className="block truncate">{timeLabel(appointment.scheduledAt, timezone)} · {appointment.customerName}</span><span className="block truncate font-medium">{appointment.title}</span></button>)}{jobsFor(day).map((job) => <Link key={job.id} to="/jobs" className="block rounded-md border border-primary bg-card px-2 py-1 text-left text-xs font-bold text-secondary"><span className="block truncate">{job.scheduledAt ? timeLabel(job.scheduledAt, timezone) : 'Time to confirm'} · {job.customerName}</span><span className="block truncate text-primary">Job · {job.service}{job.assignedEmployee ? ` · ${job.assignedEmployee}` : ''}</span></Link>)}</div></div>)}</div></div></div>}</section>
    <section className="rounded-2xl border border-border bg-card p-base"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock3 className="text-primary" size={18} /><h2 className="font-extrabold text-secondary">{calendar.availability}</h2></div><Link to="/dashboard/booking-rules" className="text-sm font-bold text-primary hover:text-secondary">Booking rules</Link></div><p className="mt-2 text-sm text-muted-foreground"><span>New appointments use </span><span className="font-semibold text-secondary">{data?.settings.defaultDurationMinutes || 60} minutes</span><span>. Availability and conflict checks use your business timezone.</span></p></section>
    {(selected || creating) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-4"><section role="dialog" aria-modal="true" aria-labelledby="appointment-dialog-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-card p-base shadow-xl sm:p-xl"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-primary">{selected?.id && !editing ? calendar.details : selected?.id ? calendar.edit : calendar.newAppointment}</p><h2 id="appointment-dialog-title" className="mt-1 text-2xl font-extrabold text-secondary">{selected?.id && !editing ? selected.title : calendar.newAppointment}</h2></div><button onClick={closeDialog} aria-label={calendar.close} className="rounded-lg border border-border p-2 text-secondary"><X size={18} /></button></div>{selected?.id && !editing ? <div className="mt-xl grid gap-4 text-sm"><div className="rounded-xl bg-muted p-4"><p className="font-extrabold text-secondary">{selected.customerName}</p><p className="mt-1 text-muted-foreground">{selected.customerPhoneNumber}{selected.customerEmail ? ` · ${selected.customerEmail}` : ''}</p><Link to={`/dashboard/customers/${selected.customerId}`} className="mt-3 inline-block font-bold text-primary hover:text-secondary">Open customer</Link></div><div><p className="text-xs font-bold text-muted-foreground">{calendar.service}</p><p className="mt-1 font-bold text-secondary">{selected.title}</p></div><div><p className="text-xs font-bold text-muted-foreground">{calendar.date}</p><p className="mt-1 font-bold text-secondary">{dateLabel(selected.scheduledAt, timezone)} · {selected.durationMinutes} minutes</p></div><div><p className="text-xs font-bold text-muted-foreground">{calendar.notes}</p><p className="mt-1 leading-6 text-secondary">{selected.notes || 'No additional appointment details.'}</p></div><div className="flex flex-wrap justify-end gap-3"><button onClick={() => setEditing(true)} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-secondary hover:border-primary">{calendar.edit}</button>{selected.status !== 'cancelled' && <button disabled={saving} onClick={() => void cancelAppointment()} className="rounded-full bg-destructive px-5 py-2.5 text-sm font-bold text-destructive-foreground">{calendar.cancel}</button>}</div></div> : <form onSubmit={saveAppointment} className="mt-xl grid gap-4"><label className="grid gap-2 text-sm font-bold text-secondary">{calendar.customer}<select required name="customerId" defaultValue={selected?.customerId || ''} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal"><option value="" disabled>Select a customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phoneNumber}</option>)}</select></label><label className="grid gap-2 text-sm font-bold text-secondary">{calendar.service}<input required name="title" defaultValue={selected?.title || ''} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal" /></label><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">{calendar.date}<input required name="scheduledAt" type="datetime-local" defaultValue={selected ? inputValue(selected.scheduledAt, timezone) : ''} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal" /></label><label className="grid gap-2 text-sm font-bold text-secondary">{calendar.duration}<input required name="durationMinutes" type="number" min="15" max="480" step="15" defaultValue={selected?.durationMinutes || data?.settings.defaultDurationMinutes || 60} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal" /></label></div><label className="grid gap-2 text-sm font-bold text-secondary">Appointment status<select name="status" defaultValue={selected?.status || 'scheduled'} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal"><option value="scheduled">Scheduled</option><option value="completed">Completed</option></select></label><label className="grid gap-2 text-sm font-bold text-secondary">{calendar.notes}<textarea name="notes" defaultValue={selected?.notes || ''} className="min-h-24 rounded-xl border border-border bg-background px-3 py-2.5 font-normal" /></label><div className="flex justify-end gap-3"><button type="button" onClick={closeDialog} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-secondary">{calendar.close}</button><button disabled={saving} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">{saving ? 'Saving...' : selected?.id ? calendar.save : calendar.create}</button></div></form>}</section></div>}
  </main></WorkspaceLayout>;
}
export default function CalendarPage() { return <><Helmet><title>Calendar | Connection Pilot</title><meta name="description" content="Manage customer appointments in your Connection Pilot business calendar." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><CalendarContent /></ProtectedRoute></>; }
