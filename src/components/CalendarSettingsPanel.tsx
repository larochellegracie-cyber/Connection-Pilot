import { Check, RotateCcw, X } from 'lucide-react';
import { defaultEmployeeColor, defaultPrefs, palette, statusDefaults, statusKeys, statusLabels, type CalendarPrefs, type CalendarView, type ColorBy, type Density, type StatusKey } from '@/lib/calendar-preferences';

type Patch = Partial<CalendarPrefs>;

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (next: T) => void }) {
  return <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-muted p-1">{options.map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-bold transition-colors ${value === id ? 'bg-card text-secondary shadow-sm' : 'text-muted-foreground hover:text-secondary'}`}>{text}</button>)}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm font-semibold text-secondary"><span>{label}</span>
    <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
    <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary ${checked ? 'bg-primary' : 'bg-[#C5D0E6]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[1.125rem]' : 'left-0.5'}`} /></span></label>;
}

function Swatches({ name, selected, onPick }: { name: string; selected: string; onPick: (id: string) => void }) {
  return <div role="radiogroup" aria-label={`${name} colour`} className="flex flex-wrap gap-1.5">{palette.map((color) => <button key={color.id} type="button" role="radio" aria-checked={selected === color.id} aria-label={`${name}: ${color.label}`} title={color.label} onClick={() => onPick(color.id)} className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected === color.id ? 'border-secondary' : 'border-transparent'}`} style={{ background: color.accent }}>{selected === color.id && <Check size={12} className="text-white" strokeWidth={3} aria-hidden="true" />}</button>)}</div>;
}

function Section({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return <details open={open} className="group border-t border-border py-3 first:border-t-0 first:pt-0"><summary className="flex cursor-pointer list-none items-center justify-between text-xs font-extrabold uppercase tracking-wide text-secondary">{title}<span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-90">›</span></summary><div className="mt-3 grid gap-3">{children}</div></details>;
}

/** The calendar's personal settings. Everything here changes how the calendar looks, never what is scheduled. */
export default function CalendarSettingsPanel({ prefs, employeeNames, onChange, onView, onClose }: { prefs: CalendarPrefs; employeeNames: string[]; onChange: (patch: Patch) => void; onView: (view: CalendarView) => void; onClose: () => void }) {
  const show = (key: keyof CalendarPrefs['show'], value: boolean) => onChange({ show: { ...prefs.show, [key]: value } });
  const colorBy: Array<[ColorBy, string]> = [['employee', 'Employee'], ['service', 'Job / service type'], ['status', 'Appointment status']];
  return <div role="dialog" aria-label="Calendar settings" className="absolute right-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] max-h-[75vh] overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-xl">
    <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-extrabold text-secondary">Calendar settings</h2><button type="button" onClick={onClose} aria-label="Close calendar settings" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-secondary"><X size={16} aria-hidden="true" /></button></div>

    <Section title="Appearance" open>
      <div><p className="mb-1.5 text-xs font-bold text-muted-foreground">Event size</p><Segmented<Density> label="Calendar density" value={prefs.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]} onChange={(density) => onChange({ density })} /></div>
      <div role="radiogroup" aria-label="Colour events by"><p className="mb-1.5 text-xs font-bold text-muted-foreground">Colour events by</p>
        {colorBy.map(([id, text]) => <label key={id} className="flex cursor-pointer items-center gap-2 py-1 text-sm font-semibold text-secondary"><input type="radio" name="colour-by" checked={prefs.colorBy === id} onChange={() => onChange({ colorBy: id })} className="h-4 w-4 accent-[#2454D6]" />{text}</label>)}</div>
      {prefs.colorBy === 'employee' && <div className="grid gap-2.5 rounded-xl bg-muted p-3"><p className="text-xs font-bold text-muted-foreground">Employee colours</p>
        {employeeNames.length === 0 ? <p className="text-xs text-muted-foreground">Add employees to choose their colours. Appointments with no employee stay gray.</p> : employeeNames.map((name) => { const chosen = prefs.employeeColors[name.toLowerCase()] ?? defaultEmployeeColor(name, employeeNames).id; return <div key={name} className="grid gap-1"><span className="text-sm font-semibold text-secondary">{name}</span><Swatches name={name} selected={chosen} onPick={(id) => onChange({ employeeColors: { ...prefs.employeeColors, [name.toLowerCase()]: id } })} /></div>; })}</div>}
      {prefs.colorBy === 'status' && <div className="grid gap-2.5 rounded-xl bg-muted p-3"><p className="text-xs font-bold text-muted-foreground">Status colours</p>
        {statusKeys.map((key: StatusKey) => <div key={key} className="grid gap-1"><span className="text-sm font-semibold text-secondary">{statusLabels[key]}</span><Swatches name={statusLabels[key]} selected={prefs.statusColors[key] ?? statusDefaults[key]} onPick={(id) => onChange({ statusColors: { ...prefs.statusColors, [key]: id } })} /></div>)}</div>}
      {prefs.colorBy === 'service' && <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">Each kind of job or service gets its own colour automatically, and the same service always matches.</p>}
    </Section>

    <Section title="Layout">
      <div><p className="mb-1.5 text-xs font-bold text-muted-foreground">Default view</p><Segmented<CalendarView> label="Default view" value={prefs.view} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} onChange={onView} /></div>
      <div><p className="mb-1.5 text-xs font-bold text-muted-foreground">Week starts on</p><Segmented<'0' | '1'> label="First day of week" value={String(prefs.weekStartsOn) as '0' | '1'} options={[['0', 'Sunday'], ['1', 'Monday']]} onChange={(day) => onChange({ weekStartsOn: day === '1' ? 1 : 0 })} /></div>
      <Toggle label="Show weekends" checked={prefs.showWeekends} onChange={(showWeekends) => onChange({ showWeekends })} />
    </Section>

    <Section title="Display">
      <div className="-my-1.5"><Toggle label="Employee names" checked={prefs.show.employee} onChange={(value) => show('employee', value)} /><Toggle label="Customer names" checked={prefs.show.customer} onChange={(value) => show('customer', value)} /><Toggle label="Job / service name" checked={prefs.show.service} onChange={(value) => show('service', value)} /><Toggle label="Appointment status" checked={prefs.show.status} onChange={(value) => show('status', value)} /><Toggle label="Completed appointments" checked={prefs.show.completed} onChange={(value) => show('completed', value)} /><Toggle label="Cancelled appointments" checked={prefs.show.cancelled} onChange={(value) => show('cancelled', value)} /></div>
    </Section>

    <div className="mt-2 flex items-center justify-between border-t border-border pt-3"><p className="text-xs text-muted-foreground">Saved automatically on this device.</p><button type="button" onClick={() => { onChange({ ...defaultPrefs, view: prefs.view }); }} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"><RotateCcw size={12} aria-hidden="true" />Reset</button></div>
  </div>;
}
