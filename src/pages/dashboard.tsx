import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, BellRing, BriefcaseBusiness, CalendarDays, MessageSquareWarning, Sparkles, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import { isFoodBusiness } from '@/lib/business-workflow';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotAvatar from '@/components/PilotAvatar';
import { dashboard } from 'virtual:content';

type ScheduledItem = { id: string; customerId: string; customerName: string; title: string; status: string; scheduledAt: string };
type AttentionItem = { id: string; customerId: string; customerName: string; title: string; kind: 'follow_up' | 'unread' | 'cancelled'; occurredAt: string };
type ActivityItem = { id: string; kind: string; customerId: string | null; customerName: string; title: string; detail: string | null; occurredAt: string; byPilot?: boolean; action?: { label: string; href: string } | null };
type PilotInsight = { id: string; priority: 'needs_attention' | 'keep_an_eye_on' | 'opportunity'; category: string; title: string; whatHappened: string; whyItMatters: string; recommendation: string; evidence: string[]; action?: { label: string; href: string } };
type DashboardResponse = { businessName: string; businessType: string; todaySchedule: ScheduledItem[]; summary: { openLeads: number; activeJobs: number; estimates: number; invoices: number; unpaidBalance: number; revenue: number }; attention: AttentionItem[]; recentActivity: ActivityItem[]; briefing: { todayAppointments: number; attentionItems: number; openLeads: number; activeJobs: number }; proactiveBriefing: { updatedAt: string; insights: PilotInsight[] } };

type Shift = { id: string; employeeId: string; employeeName: string; startsAt: string; endsAt: string; location: string | null };
type TodayJob = { id: string; customerId: string; customerName: string; service: string; assignedEmployee: string | null; scheduledAt: string | null; status: string };
const TIME_ZONE = 'America/Toronto';
function dayKey(value: string | Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }

function formatCurrency(value: number) { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value); }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function todayLabel() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()); }

/** Colour carries meaning: blue booked, sky in progress, green done, orange cancelled, grey unknown. Purple is kept for Pilot. */
function statusTone(status: string) {
  const value = status.toLowerCase().replace(/[\s-]+/g, '_');
  if (['completed', 'complete', 'done', 'paid'].includes(value)) return 'tone-positive';
  if (['cancelled', 'canceled', 'no_show'].includes(value)) return 'tone-attention';
  if (['in_progress', 'active'].includes(value)) return 'tone-info';
  if (['confirmed', 'scheduled', 'booked'].includes(value)) return 'tone-brand';
  return 'tone-neutral';
}
function statusText(status: string) { const text = status.replace(/[_-]+/g, ' ').trim(); return text.charAt(0).toUpperCase() + text.slice(1); }

const insightGroups: Array<{ priority: PilotInsight['priority']; label: string; tone: string }> = [
  { priority: 'needs_attention', label: 'Needs attention', tone: 'tone-attention' },
  { priority: 'keep_an_eye_on', label: 'Keep an eye on', tone: 'tone-brand' },
  { priority: 'opportunity', label: 'Opportunities', tone: 'tone-pilot' },
];

function DashboardContent() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { void (async () => { try { const response = await fetch('/api/dashboard', { credentials: 'include' }); const payload = await response.json() as DashboardResponse & { error?: string }; if (!response.ok) throw new Error(payload.error || 'Unable to load your dashboard.'); setData(payload); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load your dashboard.'); } finally { setLoading(false); } })(); }, []);
  // Today's staff and jobs come from the existing schedule and job lists; a failure here never blocks the rest of Home.
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [jobs, setJobs] = useState<TodayJob[]>([]);
  useEffect(() => { void (async () => {
    const today = dayKey(new Date());
    try {
      const response = await fetch(`/api/schedules?weekStart=${encodeURIComponent(new Date().toISOString())}`, { credentials: 'include' });
      if (response.ok) { const payload = await response.json() as { schedule?: { status?: string } | null; shifts?: Shift[] }; setShifts((payload.shifts ?? []).filter((shift) => dayKey(shift.startsAt) === today)); setScheduleStatus(payload.schedule?.status ?? ''); }
    } catch { /* leave the staff list empty */ }
    try {
      const response = await fetch('/api/jobs', { credentials: 'include' });
      if (response.ok) { const payload = await response.json() as { jobs?: TodayJob[] }; setJobs((payload.jobs ?? []).filter((job) => job.scheduledAt && dayKey(job.scheduledAt) === today && !['cancelled', 'canceled'].includes(job.status)).sort((first, second) => String(first.scheduledAt).localeCompare(String(second.scheduledAt)))); }
    } catch { /* leave the job list empty */ }
  })(); }, []);

  const foodBusiness = isFoodBusiness(data?.businessType);
  const unpaid = data?.summary.unpaidBalance ?? 0;
  const staffToday = new Set(shifts.map((shift) => shift.employeeId)).size;
  const workToday = (data?.todaySchedule.length ?? 0) + (foodBusiness ? 0 : jobs.length);
  const metrics = [
    { label: foodBusiness ? 'Orders today' : 'Appointments & jobs', detail: 'Scheduled for today', value: workToday, tone: 'tone-brand' },
    { label: 'Staff working', detail: staffToday === 1 ? 'Person on shift today' : 'People on shift today', value: staffToday, tone: 'tone-info' },
    { label: dashboard.summary.unpaidBalance.label, detail: dashboard.summary.unpaidBalance.detail, value: data ? formatCurrency(unpaid) : '—', tone: 'tone-brand' },
    { label: dashboard.summary.openLeads.label, detail: dashboard.summary.openLeads.detail, value: data?.summary.openLeads ?? 0, tone: 'tone-customer' },
  ];
  const attentionIcon = (kind: AttentionItem['kind']) => kind === 'unread' ? BellRing : kind === 'cancelled' ? CalendarDays : MessageSquareWarning;
  const attentionTone = (kind: AttentionItem['kind']) => kind === 'unread' ? 'tone-brand' : 'tone-attention';
  const attentionLabel = (kind: AttentionItem['kind']) => kind === 'unread' ? dashboard.attention.unread : kind === 'cancelled' ? dashboard.attention.cancelled : dashboard.attention.followUp;

  const initial = (name: string) => (name.trim().charAt(0) || '•').toUpperCase();
  const insights = data?.proactiveBriefing.insights ?? [];
  const hasFlightPlan = Boolean(data?.attention.length) || insights.length > 0;
  const sectionHead = (id: string, Icon: LucideIcon, title: string, description: string, action?: React.ReactNode) => <div className="cp-head"><div className="cp-head-title"><span className="cp-tile tone-brand h-8 w-8"><Icon size={16} /></span><div><h2 id={id} className="cp-h2">{title}</h2><p className="cp-subtle">{description}</p></div></div>{action}</div>;
  const empty = (title: string, description: string, mascot?: boolean) => <div className="cp-empty">{mascot && <div className="mb-1 flex justify-center"><PilotAvatar size="md" state="idle" /></div>}<p className="cp-empty-title">{title}</p><p className="cp-empty-sub">{description}</p></div>;
  const timeRange = (shift: Shift) => `${formatTime(shift.startsAt)} – ${formatTime(shift.endsAt)}`;
  const statusCell = (status: string) => <span className={`${statusTone(status)} flex shrink-0 items-center gap-2`}><span className="text-xs font-bold text-muted-foreground">{statusText(status || dashboard.status.unknown)}</span><span aria-hidden="true" className="cp-dot-lg" /></span>;

  return <WorkspaceLayout><main className="grid gap-4">
    <section aria-labelledby="today-title" className="cp-hero px-6 py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="cp-eyebrow">{todayLabel()}</p><h1 id="today-title" className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-white sm:text-[1.75rem]">{greeting()}{data?.businessName ? `, ${data.businessName}` : ''}</h1><p className="mt-1 text-sm text-[#C9D8F5]">{dashboard.hero.subtitle}</p></div>
        <div className="flex flex-wrap gap-2"><Link to={foodBusiness ? '/jobs' : '/calendar'} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:brightness-110">{foodBusiness ? 'Open orders' : dashboard.hero.openSchedule}<ArrowUpRight size={15} /></Link><Link to="/customers" className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/10">{dashboard.hero.openLeads}<ArrowUpRight size={15} /></Link></div>
      </div>
      <h2 id="summary-title" className="sr-only">{dashboard.summary.title}</h2>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{metrics.map((metric) => <article key={metric.label} className={`${metric.tone} cp-stat`}><p className="cp-eyebrow">{metric.label}</p><p className="cp-stat-value mt-1">{loading ? '—' : metric.value}</p><p className="cp-stat-note mt-0.5">{metric.detail}</p></article>)}</div>
    </section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)] xl:items-start">
      <div className="cp-card">
        <section aria-labelledby="staff-title" className="cp-card-section">
          {sectionHead('staff-title', UsersRound, 'Today’s staff', 'Who is working today.', <span className="flex shrink-0 items-center gap-2">{scheduleStatus === 'draft' && shifts.length > 0 && <span className="cp-pill tone-attention">Draft schedule</span>}<Link to="/scheduling" className="cp-link">Open scheduling<ArrowUpRight size={14} /></Link></span>)}
          {shifts.length ? <ul className="cp-list">{shifts.map((shift) => <li key={shift.id} className="cp-item"><span className="cp-avatar">{initial(shift.employeeName)}</span><span className="min-w-0 flex-1"><span className="cp-item-name block truncate">{shift.employeeName}</span>{shift.location && <span className="cp-item-sub block truncate">{shift.location}</span>}</span><span className="shrink-0 text-sm font-bold tabular-nums text-secondary">{timeRange(shift)}</span></li>)}</ul> : empty('No one is scheduled today', 'Shifts for today will show here once they are on the schedule.')}
        </section>

        {!foodBusiness && <section aria-labelledby="jobs-title" className="cp-card-section">
          {sectionHead('jobs-title', BriefcaseBusiness, 'Today’s jobs', 'What your team is doing today.', <Link to="/jobs" className="cp-link shrink-0">Open jobs<ArrowUpRight size={14} /></Link>)}
          {jobs.length ? <ul className="cp-list">{jobs.map((job) => <li key={job.id}><Link to={`/dashboard/customers/${job.customerId}`} className="cp-item"><span className="w-[4.75rem] shrink-0 text-sm font-extrabold tabular-nums text-primary">{formatTime(job.scheduledAt as string)}</span><span className="min-w-0 flex-1"><span className="cp-item-name block truncate">{job.service}</span><span className="cp-item-sub block truncate">{job.customerName}{job.assignedEmployee ? ` · ${job.assignedEmployee}` : ''}</span></span>{statusCell(job.status)}</Link></li>)}</ul> : empty('No jobs today', 'Jobs scheduled for today will show here.')}
        </section>}
      </div>

      <div className="grid gap-4">
        <section aria-labelledby="schedule-title" className="cp-card cp-card-section">
          {sectionHead('schedule-title', CalendarDays, foodBusiness ? 'Today’s orders' : 'Today’s appointments', foodBusiness ? 'Orders scheduled for today.' : dashboard.schedule.description, <Link to={foodBusiness ? '/jobs' : '/calendar'} className="cp-link shrink-0">{foodBusiness ? 'Open orders' : dashboard.schedule.open}<ArrowUpRight size={14} /></Link>)}
          {loading ? <p className="cp-subtle">Loading...</p> : data?.todaySchedule.length ? <ul className="cp-list">{data.todaySchedule.map((item) => <li key={item.id}><Link to={`/dashboard/customers/${item.customerId}`} className="cp-item"><span className="w-[4.75rem] shrink-0 text-sm font-extrabold tabular-nums text-primary">{formatTime(item.scheduledAt)}</span><span className="min-w-0 flex-1"><span className="cp-item-name block truncate">{item.customerName}</span><span className="cp-item-sub block truncate">{item.title}</span></span>{statusCell(item.status)}</Link></li>)}</ul> : empty(dashboard.schedule.emptyTitle, dashboard.schedule.emptyDescription)}
        </section>

        <section aria-labelledby="attention-title" className="cp-navy cp-card-section">
          {sectionHead('attention-title', Sparkles, 'Pilot’s Briefing', 'Things that need your attention today.', data?.attention.length ? <span className="cp-pill tone-attention shrink-0">{data.attention.length}</span> : undefined)}
          {loading ? <p className="cp-subtle">Loading...</p> : hasFlightPlan ? <div className="grid gap-4">
            {data?.attention.length ? <ul className="cp-list">{data.attention.map((item) => { const Icon = attentionIcon(item.kind); return <li key={`${item.kind}-${item.id}`}><Link to={`/dashboard/customers/${item.customerId}`} className={`${attentionTone(item.kind)} cp-item`}><span className="cp-avatar"><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="cp-item-name block truncate">{item.customerName}</span><span className="cp-item-sub block truncate">{item.title}</span></span><span className="flex shrink-0 items-center gap-2"><span className="text-xs font-bold text-[#A9C2F5]">{attentionLabel(item.kind)}</span><span aria-hidden="true" className="cp-dot-lg" /></span></Link></li>; })}</ul> : null}
            {insights.length ? <div role="group" aria-labelledby="proactive-briefing-title" className="grid gap-2"><h3 id="proactive-briefing-title" className="cp-eyebrow">What Pilot noticed</h3>{insightGroups.flatMap((group) => insights.filter((insight) => insight.priority === group.priority).map((insight) => <details key={insight.id} className={`${group.tone} cp-brief`}>
              <summary className="cursor-pointer list-none"><span className="flex items-center justify-between gap-2"><span className="cp-pill">{group.label}</span><span className="text-xs font-bold text-[#A9C2F5]">{insight.category}</span></span><span className="mt-1.5 block text-sm font-extrabold text-white">{insight.title}</span></summary>
              <div className="cp-brief-body mt-3 grid gap-2.5 border-t border-white/15 pt-3 text-sm leading-6">
                <div><p className="cp-eyebrow">What happened</p><p>{insight.whatHappened}</p></div>
                <div><p className="cp-eyebrow">Why it matters</p><p>{insight.whyItMatters}</p></div>
                <div><p className="cp-eyebrow">Recommendation</p><p>{insight.recommendation}</p></div>
                <div><p className="cp-eyebrow">Evidence</p><ul className="mt-1 list-disc pl-5">{insight.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></div>
                {insight.action && <Link to={insight.action.href} className="justify-self-start rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">{insight.action.label}</Link>}
              </div>
            </details>))}</div> : null}
          </div> : empty(dashboard.attention.emptyTitle, dashboard.attention.emptyDescription, true)}
        </section>
      </div>
    </div>
  </main></WorkspaceLayout>;
}

export default function DashboardPage() { return <><Helmet><title>Command Centre | Connection Pilot</title><meta name="description" content="Review live schedules, records needing attention, and business activity in Connection Pilot." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><DashboardContent /></ProtectedRoute></>; }
