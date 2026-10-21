import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, BellRing, BriefcaseBusiness, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarX, CheckCircle2, CircleDollarSign, ClipboardList, FileText, HandCoins, MessageSquare, MessageSquareWarning, ReceiptText, Send, UserPlus, UsersRound } from 'lucide-react';
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

function formatCurrency(value: number) { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value); }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
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

/** What each kind of business activity looks like: blue = core work, green = done or paid, orange = money or cancellations to watch. */
const activityStyle: Record<string, { icon: LucideIcon; tone: string }> = {
  appointment_booked: { icon: CalendarPlus, tone: 'tone-brand' },
  appointment_rescheduled: { icon: CalendarClock, tone: 'tone-brand' },
  appointment_completed: { icon: CalendarCheck, tone: 'tone-positive' },
  appointment_cancelled: { icon: CalendarX, tone: 'tone-attention' },
  customer_added: { icon: UserPlus, tone: 'tone-brand' },
  customer_contacted: { icon: MessageSquare, tone: 'tone-neutral' },
  job_created: { icon: BriefcaseBusiness, tone: 'tone-brand' },
  job_completed: { icon: CheckCircle2, tone: 'tone-positive' },
  quote_created: { icon: FileText, tone: 'tone-brand' },
  quote_sent: { icon: Send, tone: 'tone-brand' },
  quote_accepted: { icon: CheckCircle2, tone: 'tone-positive' },
  invoice_created: { icon: ReceiptText, tone: 'tone-attention' },
  invoice_sent: { icon: ReceiptText, tone: 'tone-attention' },
  invoice_paid: { icon: CheckCircle2, tone: 'tone-positive' },
  payment_received: { icon: HandCoins, tone: 'tone-positive' },
};

const insightGroups: Array<{ priority: PilotInsight['priority']; label: string; tone: string }> = [
  { priority: 'needs_attention', label: 'Needs attention', tone: 'tone-attention' },
  { priority: 'keep_an_eye_on', label: 'Keep an eye on', tone: 'tone-brand' },
  { priority: 'opportunity', label: 'Opportunities', tone: 'tone-pilot' },
];

function PilotCard({ briefing, loading }: { briefing: DashboardResponse['proactiveBriefing'] | undefined; loading: boolean }) {
  const hasInsights = Boolean(briefing?.insights.length);
  return <section aria-labelledby="pilot-title" className="cp-pilot">
    <div className="cp-panel-head">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card ring-1 ring-[hsl(var(--pilot-glow)/0.45)]"><PilotAvatar size="md" state={loading ? 'thinking' : 'speaking'} /></span><div><h2 id="pilot-title" className="cp-title">{dashboard.briefing.title}</h2><p className="cp-subtle">{dashboard.briefing.description}</p></div></div>
    </div>
    <div className="grid gap-3 p-4">
      <Link to="/assistant" className="cp-pilot-ask flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors"><span className="text-sm font-semibold text-muted-foreground">What needs my attention today?</span><Send size={16} className="cp-pilot-accent" /></Link>
      {loading ? <p className="cp-subtle">Reviewing your business records…</p> : hasInsights ? <div aria-labelledby="proactive-briefing-title" role="group" className="grid gap-2">
        <h3 id="proactive-briefing-title" className="cp-eyebrow">Pilot’s Briefing</h3>
        {insightGroups.flatMap((group) => (briefing?.insights.filter((insight) => insight.priority === group.priority) ?? []).map((insight) => <details key={insight.id} className={`${group.tone} cp-edge rounded-lg bg-card px-3 py-2`}>
          <summary className="cursor-pointer list-none"><span className="flex items-center justify-between gap-2"><span className="cp-pill">{group.label}</span><span className="text-xs font-bold text-muted-foreground">{insight.category}</span></span><span className="mt-1.5 block text-sm font-extrabold text-secondary">{insight.title}</span></summary>
          <div className="mt-3 grid gap-2.5 border-t border-border pt-3 text-sm leading-6 text-muted-foreground">
            <div><p className="cp-eyebrow">What happened</p><p>{insight.whatHappened}</p></div>
            <div><p className="cp-eyebrow">Why it matters</p><p>{insight.whyItMatters}</p></div>
            <div><p className="cp-eyebrow">Recommendation</p><p>{insight.recommendation}</p></div>
            <div><p className="cp-eyebrow">Evidence</p><ul className="mt-1 list-disc pl-5">{insight.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
            {insight.action && <Link to={insight.action.href} className="justify-self-start rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">{insight.action.label}</Link>}
          </div>
        </details>))}
      </div> : <p className="cp-subtle">{dashboard.briefing.emptyDescription}</p>}
      <div className="flex flex-wrap gap-2"><Link to="/assistant" className="cp-pilot-chip rounded-full px-3 py-1 text-xs font-bold transition-colors">Review customers</Link><Link to="/assistant" className="cp-pilot-chip rounded-full px-3 py-1 text-xs font-bold transition-colors">Check sales</Link></div>
    </div>
  </section>;
}

function DashboardContent() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { void (async () => { try { const response = await fetch('/api/dashboard', { credentials: 'include' }); const payload = await response.json() as DashboardResponse & { error?: string }; if (!response.ok) throw new Error(payload.error || 'Unable to load your dashboard.'); setData(payload); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load your dashboard.'); } finally { setLoading(false); } })(); }, []);

  const foodBusiness = isFoodBusiness(data?.businessType);
  const unpaid = data?.summary.unpaidBalance ?? 0;
  const revenue = data?.summary.revenue ?? 0;
  const metrics = [
    { label: dashboard.summary.revenue.label, detail: dashboard.summary.revenue.detail, value: data ? formatCurrency(revenue) : '—', tone: 'tone-positive', emphasise: revenue > 0, icon: HandCoins },
    { label: dashboard.summary.unpaidBalance.label, detail: dashboard.summary.unpaidBalance.detail, value: data ? formatCurrency(unpaid) : '—', tone: unpaid > 0 ? 'tone-attention' : 'tone-neutral', emphasise: unpaid > 0, icon: CircleDollarSign },
    { label: foodBusiness ? 'Orders' : 'Appointments & jobs', detail: foodBusiness ? 'Confirmed or in progress' : 'Scheduled or in progress', value: (data?.todaySchedule.length ?? 0) + (data?.summary.activeJobs ?? 0), tone: 'tone-brand', emphasise: false, icon: CalendarDays },
    { label: dashboard.summary.openLeads.label, detail: dashboard.summary.openLeads.detail, value: data?.summary.openLeads ?? 0, tone: 'tone-customer', emphasise: false, icon: UsersRound },
  ];
  const pipeline = [
    { label: dashboard.pipeline.leads.label, detail: dashboard.pipeline.leads.detail, value: data?.summary.openLeads ?? 0, href: '/leads', icon: UsersRound, tone: 'tone-customer' },
    { label: dashboard.pipeline.jobs.label, detail: dashboard.pipeline.jobs.detail, value: data?.summary.activeJobs ?? 0, href: '/jobs', icon: BriefcaseBusiness, tone: 'tone-brand' },
    { label: dashboard.pipeline.estimates.label, detail: dashboard.pipeline.estimates.detail, value: data?.summary.estimates ?? 0, href: '/finance', icon: ClipboardList, tone: 'tone-neutral' },
    { label: dashboard.pipeline.invoices.label, detail: dashboard.pipeline.invoices.detail, value: data?.summary.invoices ?? 0, href: '/finance', icon: FileText, tone: 'tone-attention' },
  ];
  const attentionIcon = (kind: AttentionItem['kind']) => kind === 'unread' ? BellRing : kind === 'cancelled' ? CalendarDays : MessageSquareWarning;
  const attentionTone = (kind: AttentionItem['kind']) => kind === 'unread' ? 'tone-brand' : 'tone-attention';
  const attentionLabel = (kind: AttentionItem['kind']) => kind === 'unread' ? dashboard.attention.unread : kind === 'cancelled' ? dashboard.attention.cancelled : dashboard.attention.followUp;

  return <WorkspaceLayout><main className="grid gap-4">
    <section className="cp-hero flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="cp-eyebrow">{todayLabel()}</p><h1 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-secondary sm:text-3xl">{dashboard.hero.greeting}{data?.businessName ? `, ${data.businessName}` : ''}</h1><p className="mt-1 text-sm text-muted-foreground">{dashboard.hero.subtitle}</p></div>
      <div className="flex flex-wrap gap-2"><Link to={foodBusiness ? '/jobs' : '/calendar'} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary">{foodBusiness ? 'Open orders' : dashboard.hero.openSchedule}<ArrowUpRight size={15} /></Link><Link to="/customers" className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-bold text-secondary transition-colors hover:border-primary">{dashboard.hero.openLeads}<ArrowUpRight size={15} /></Link></div>
    </section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}

    <section aria-labelledby="summary-title" className="cp-panel">
      <h2 id="summary-title" className="sr-only">{dashboard.summary.title}</h2>
      <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">{metrics.map((metric) => { const Icon = metric.icon; return <article key={metric.label} className={`${metric.tone} cp-kpi p-4 pt-5`}><div className="flex items-start justify-between gap-2"><p className="cp-eyebrow">{metric.label}</p><span className="cp-tile h-8 w-8"><Icon size={16} /></span></div><p className={`cp-metric-value mt-2 ${metric.emphasise ? 'cp-value-tone' : ''}`}>{loading ? '—' : metric.value}</p><p className="cp-subtle mt-1">{metric.detail}</p></article>; })}</div>
    </section>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)] xl:items-start">
      <div className="grid gap-4">
        <section aria-labelledby="schedule-title" className="cp-panel cp-panel--blue">
          <div className="cp-panel-head"><div><h2 id="schedule-title" className="cp-title">{foodBusiness ? 'Today’s pickups and deliveries' : dashboard.schedule.title}</h2><p className="cp-subtle">{foodBusiness ? 'Orders scheduled for today.' : dashboard.schedule.description}</p></div><Link to={foodBusiness ? '/jobs' : '/calendar'} className="cp-link">{foodBusiness ? 'Open orders' : dashboard.schedule.open}<ArrowUpRight size={14} /></Link></div>
          {loading ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : data?.todaySchedule.length ? <ol className="divide-y divide-border">{data.todaySchedule.map((item) => <li key={item.id}><Link to={`/dashboard/customers/${item.customerId}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"><span className="text-sm font-extrabold tabular-nums text-secondary">{formatTime(item.scheduledAt)}</span><span className="min-w-0"><span className="block truncate text-sm font-bold text-secondary">{item.customerName}</span><span className="block truncate text-xs text-muted-foreground">{item.title}</span></span><span className={`cp-pill ${statusTone(item.status || '')}`}>{statusText(item.status || dashboard.status.unknown)}</span></Link></li>)}</ol> : <div className="px-4 py-6 text-center"><p className="text-sm font-extrabold text-secondary">{dashboard.schedule.emptyTitle}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{dashboard.schedule.emptyDescription}</p></div>}
        </section>

        <section aria-labelledby="attention-title" className="cp-pilot cp-pilot--soft">
          <div className="cp-panel-head"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-card ring-1 ring-[hsl(var(--pilot-glow)/0.4)]"><PilotAvatar size="sm" state="thinking" /></span><div><h2 id="attention-title" className="cp-title">{dashboard.attention.title}</h2><p className="cp-subtle">{dashboard.attention.description}</p></div></div>{data?.attention.length ? <span className="cp-pill tone-attention">{data.attention.length}</span> : null}</div>
          {loading ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : data?.attention.length ? <ul className="divide-y divide-border">{data.attention.map((item) => { const Icon = attentionIcon(item.kind); return <li key={`${item.kind}-${item.id}`}><Link to={`/dashboard/customers/${item.customerId}`} className={`${attentionTone(item.kind)} cp-edge flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted`}><span className="cp-tile h-8 w-8"><Icon size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-secondary">{item.customerName}</span><span className="block truncate text-xs text-muted-foreground">{item.title}</span></span><span className="cp-link shrink-0">{attentionLabel(item.kind)}<ArrowUpRight size={14} /></span></Link></li>; })}</ul> : <div className="flex flex-col items-center px-4 py-6 text-center"><PilotAvatar size="lg" state="idle" /><p className="mt-2 text-sm font-extrabold text-secondary">{dashboard.attention.emptyTitle}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{dashboard.attention.emptyDescription}</p></div>}
        </section>
      </div>

      <div className="grid gap-4">
        <PilotCard briefing={data?.proactiveBriefing} loading={loading} />

        <section aria-labelledby="pipeline-title" className="cp-panel cp-panel--blue">
          <div className="cp-panel-head"><div><h2 id="pipeline-title" className="cp-title">{dashboard.pipeline.title}</h2><p className="cp-subtle">{dashboard.pipeline.description}</p></div></div>
          <ul className="divide-y divide-border">{pipeline.map((item) => { const Icon = item.icon; return <li key={item.label}><Link to={item.href} className={`${item.tone} flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted`}><span className="cp-tile h-8 w-8"><Icon size={15} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-secondary">{item.label}</span><span className="block text-xs text-muted-foreground">{item.detail}</span></span><span className="text-lg font-extrabold tabular-nums text-secondary">{loading ? '—' : item.value}</span></Link></li>; })}</ul>
          {data && data.summary.estimates === 0 && data.summary.invoices === 0 && <p className="border-t border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground">{dashboard.pipeline.emptyFinance}</p>}
        </section>

        <section aria-labelledby="activity-title" className="cp-panel cp-panel--cool">
          <div className="cp-panel-head"><div><h2 id="activity-title" className="cp-title">{dashboard.activity.title}</h2><p className="cp-subtle">{dashboard.activity.description}</p></div></div>
          {loading ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : data?.recentActivity.length ? <ul className="divide-y divide-border">{data.recentActivity.map((item) => { const style = activityStyle[item.kind] ?? { icon: ClipboardList, tone: 'tone-neutral' }; const Icon = style.icon; return <li key={item.id} className={`${style.tone} flex items-start gap-3 px-4 py-2.5`}><span className="cp-tile mt-0.5 h-8 w-8"><Icon size={15} /></span><div className="min-w-0 flex-1"><p className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="text-sm font-extrabold text-secondary">{item.title}</span>{item.byPilot && <span className="cp-pill tone-pilot">Pilot</span>}</p><p className="truncate text-xs text-muted-foreground"><span className="font-semibold text-secondary">{item.customerName}</span>{item.detail ? ` · ${item.detail}` : ''}</p></div><div className="flex shrink-0 flex-col items-end gap-0.5 text-right"><time dateTime={item.occurredAt} className="text-xs text-muted-foreground">{formatDateTime(item.occurredAt)}</time>{item.action && <Link to={item.action.href} className="cp-link text-xs">{item.action.label}</Link>}</div></li>; })}</ul> : <div className="px-4 py-6 text-center"><p className="text-sm font-extrabold text-secondary">{dashboard.activity.emptyTitle}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{dashboard.activity.emptyDescription}</p></div>}
        </section>
      </div>
    </div>
  </main></WorkspaceLayout>;
}

export default function DashboardPage() { return <><Helmet><title>Command Centre | Connection Pilot</title><meta name="description" content="Review live schedules, records needing attention, and business activity in Connection Pilot." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><DashboardContent /></ProtectedRoute></>; }
