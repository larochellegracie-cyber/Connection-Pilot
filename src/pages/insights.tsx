import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, HandCoins, Lightbulb, Minus, TrendingUp, UserPlus, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotAvatar from '@/components/PilotAvatar';

type Comparison = { key: string; label: string; format: 'money' | 'count' | 'percent'; current: number; previous: number; change: number | null; direction: 'up' | 'down' | 'flat' | 'new'; good: boolean | null };
type Pattern = { id: string; tone: 'positive' | 'attention' | 'opportunity' | 'neutral'; title: string; detail: string; href?: string; hrefLabel?: string };
type Analytics = {
  comparison: Comparison[];
  weekly: { weekStart: string; label: string; revenue: number; newCustomers: number; appointments: number }[];
  busiestDays: { day: string; appointments: number }[];
  topServices: { service: string; jobs: number }[];
  receivables: { total: number; overdue: number; buckets: { key: string; label: string; amount: number; count: number }[] };
  customerHealth: { active: number; cooling: number; quiet: number; total: number };
  patterns: Pattern[];
  hasData: boolean;
};
type Recommendation = { id: string; priority: 'needs_attention' | 'keep_an_eye_on' | 'opportunity'; category: string; title: string; whatHappened: string; whyItMatters: string; recommendation: string; evidence: string[]; action?: { label: string; href: string } };
type InsightsResponse = { analytics: Analytics; recommendations: Recommendation[]; updatedAt: string };

const money = (value: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(value);
const formatValue = (value: number, format: Comparison['format']) => (format === 'money' ? money(value) : format === 'percent' ? `${value}%` : String(value));

const metricStyle: Record<string, { icon: LucideIcon; tone: string }> = {
  revenue: { icon: HandCoins, tone: 'tone-positive' },
  newCustomers: { icon: UserPlus, tone: 'tone-brand' },
  appointments: { icon: CalendarDays, tone: 'tone-brand' },
  cancellationRate: { icon: TrendingUp, tone: 'tone-attention' },
};
const patternTone = { positive: 'tone-positive', attention: 'tone-attention', opportunity: 'tone-pilot', neutral: 'tone-neutral' } as const;
const priorityStyle = {
  needs_attention: { label: 'Needs attention', tone: 'tone-attention' },
  keep_an_eye_on: { label: 'Keep an eye on', tone: 'tone-brand' },
  opportunity: { label: 'Opportunity', tone: 'tone-pilot' },
} as const;

/** "up 12%" in green when good, amber when not, grey when flat. Colour follows whether the change is good, not just its direction. */
function ChangePill({ item }: { item: Comparison }) {
  const tone = item.good === true ? 'tone-positive' : item.good === false ? 'tone-attention' : 'tone-neutral';
  const Icon = item.direction === 'up' ? ArrowUpRight : item.direction === 'down' ? ArrowDownRight : item.direction === 'new' ? ArrowUpRight : Minus;
  const text = item.direction === 'flat' ? 'No change' : item.direction === 'new' ? (item.format === 'percent' ? 'Up from 0%' : 'New this period') : `${item.direction === 'up' ? '+' : '−'}${Math.abs(item.change ?? 0)}%`;
  return <span className={`${tone} cp-pill`}><Icon size={12} aria-hidden="true" />{text}</span>;
}

function Bars({ title, values, labels, tone, format }: { title: string; values: number[]; labels: string[]; tone: string; format: 'money' | 'count' }) {
  const max = Math.max(...values, 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return <figure className={`${tone} grid gap-2`} aria-label={`${title}, last 8 weeks`}>
    <figcaption className="flex items-baseline justify-between gap-2"><span className="cp-eyebrow">{title}</span><span className="text-sm font-extrabold tabular-nums text-secondary">{format === 'money' ? money(total) : total}<span className="ml-1 text-xs font-semibold text-muted-foreground">in 8 weeks</span></span></figcaption>
    <div className="flex h-20 items-end gap-1.5" role="img" aria-label={`${title} per week: ${values.map((value, index) => `${labels[index]} ${format === 'money' ? money(value) : value}`).join(', ')}`}>
      {values.map((value, index) => <span key={labels[index]} data-value={value} title={`${labels[index]}: ${format === 'money' ? money(value) : value}`} className={`flex-1 rounded-t ${value > 0 ? 'bg-[hsl(var(--sem))]' : 'bg-border'}`} style={{ height: `${max > 0 ? Math.max(value > 0 ? 6 : 3, (value / max) * 100) : 3}%`, opacity: index === values.length - 1 ? 0.55 : 1 }} />)}
    </div>
    <div className="flex justify-between text-[0.6875rem] text-muted-foreground"><span>{labels[0]}</span><span>This week (so far)</span></div>
  </figure>;
}

function Row({ label, value, max, tone, suffix }: { label: string; value: number; max: number; tone: string; suffix?: string }) {
  return <li className={`${tone} grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm`}><span className="truncate font-semibold text-secondary">{label}</span><span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-[hsl(var(--sem))]" style={{ width: `${max > 0 ? Math.max(value > 0 ? 4 : 0, (value / max) * 100) : 0}%` }} /></span><span className="tabular-nums text-xs font-bold text-muted-foreground">{value}{suffix}</span></li>;
}

function InsightsContent() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState('');
  const [upgrade, setUpgrade] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void (async () => {
    try {
      const response = await fetch('/api/insights', { credentials: 'include' });
      const payload = await response.json() as InsightsResponse & { error?: string; upgradeRequired?: boolean };
      if (response.status === 403 && payload.upgradeRequired) { setUpgrade(true); return; }
      if (!response.ok) throw new Error(payload.error || 'Unable to load your insights.');
      setData(payload);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load your insights.'); } finally { setLoading(false); }
  })(); }, []);

  const analytics = data?.analytics;
  const recommendations = data?.recommendations ?? [];
  const health = analytics?.customerHealth;
  const dayMax = Math.max(0, ...(analytics?.busiestDays.map((item) => item.appointments) ?? [0]));
  const serviceMax = Math.max(0, ...(analytics?.topServices.map((item) => item.jobs) ?? [0]));

  return <WorkspaceLayout><main className="grid gap-4">
    <section className="cp-hero flex flex-col gap-1 px-5 py-4">
      <p className="cp-eyebrow">Insights</p>
      <h1 className="text-2xl font-extrabold tracking-[-0.04em] text-secondary sm:text-3xl">How your business is trending</h1>
      <p className="text-sm text-muted-foreground">Patterns, trends and opportunities from your own records. Compared with the 30 days before unless stated.</p>
    </section>

    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}
    {upgrade && <section className="cp-panel p-5 text-center"><p className="text-sm font-extrabold text-secondary">Insights are part of the Growth and Pro plans.</p><p className="mt-1 text-xs text-muted-foreground">Upgrade to see trends, patterns and Pilot’s recommendations.</p><Link to="/subscription" className="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">See plans</Link></section>}
    {loading && <p className="text-sm text-muted-foreground">Analysing your records…</p>}

    {analytics && !analytics.hasData && <section className="cp-panel px-5 py-8 text-center"><Lightbulb className="mx-auto text-muted-foreground" size={26} aria-hidden="true" /><p className="mt-2 text-sm font-extrabold text-secondary">Not enough activity yet</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Insights appear as you add customers, book appointments and record payments. Nothing here is estimated, so this page stays empty until there is something real to show.</p></section>}

    {analytics?.hasData && <>
      <section aria-labelledby="trend-title" className="cp-panel">
        <h2 id="trend-title" className="sr-only">Last 30 days compared with the 30 before</h2>
        <div className="grid grid-cols-2 gap-px bg-border xl:grid-cols-4">{analytics.comparison.map((item) => { const style = metricStyle[item.key] ?? { icon: TrendingUp, tone: 'tone-neutral' }; const Icon = style.icon; return <article key={item.key} className={`${style.tone} cp-kpi p-4 pt-5`}><div className="flex items-start justify-between gap-2"><p className="cp-eyebrow">{item.label}</p><span className="cp-tile h-8 w-8"><Icon size={16} /></span></div><p className="cp-metric-value mt-2">{formatValue(item.current, item.format)}</p><div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"><ChangePill item={item} /><span className="cp-subtle">was {formatValue(item.previous, item.format)}</span></div></article>; })}</div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] xl:items-start">
        <div className="grid gap-4">
          <section aria-labelledby="weekly-title" className="cp-panel cp-panel--blue">
            <div className="cp-panel-head"><div><h2 id="weekly-title" className="cp-title">Weekly trends</h2><p className="cp-subtle">The last eight weeks. The current week is lighter because it isn’t over.</p></div></div>
            <div className="grid gap-5 p-4 md:grid-cols-3">
              <Bars title="Revenue" tone="tone-positive" format="money" values={analytics.weekly.map((week) => week.revenue)} labels={analytics.weekly.map((week) => week.label)} />
              <Bars title="New customers" tone="tone-brand" format="count" values={analytics.weekly.map((week) => week.newCustomers)} labels={analytics.weekly.map((week) => week.label)} />
              <Bars title="Appointments" tone="tone-info" format="count" values={analytics.weekly.map((week) => week.appointments)} labels={analytics.weekly.map((week) => week.label)} />
            </div>
          </section>

          <section aria-labelledby="patterns-title" className="cp-panel">
            <div className="cp-panel-head"><div><h2 id="patterns-title" className="cp-title">Patterns and opportunities</h2><p className="cp-subtle">What the numbers say, in plain words.</p></div></div>
            {analytics.patterns.length ? <ul className="divide-y divide-border">{analytics.patterns.map((pattern) => <li key={pattern.id} className={`${patternTone[pattern.tone]} cp-edge flex items-start gap-3 px-4 py-3`}><div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-secondary">{pattern.title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{pattern.detail}</p></div>{pattern.href && <Link to={pattern.href} className="cp-link shrink-0">{pattern.hrefLabel ?? 'Open'}<ArrowRight size={14} /></Link>}</li>)}</ul> : <p className="px-4 py-6 text-center text-xs text-muted-foreground">No clear patterns yet. As more appointments, payments and customers are recorded, they’ll show up here.</p>}
          </section>
        </div>

        <div className="grid gap-4">
          <section aria-labelledby="owed-title" className="cp-panel cp-panel--cool">
            <div className="cp-panel-head"><div><h2 id="owed-title" className="cp-title">Money owed</h2><p className="cp-subtle">Open invoices, by how late they are.</p></div><span className="text-lg font-extrabold tabular-nums text-secondary">{money(analytics.receivables.total)}</span></div>
            {analytics.receivables.total > 0 ? <ul className="grid gap-2.5 p-4">{analytics.receivables.buckets.filter((bucket) => bucket.count > 0).map((bucket) => <Row key={bucket.key} label={bucket.label} value={bucket.amount} max={analytics.receivables.total} tone={bucket.key === 'current' || bucket.key === 'noDueDate' ? 'tone-neutral' : bucket.key === 'late30' ? 'tone-attention' : 'tone-urgent'} />)}</ul> : <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing is owed right now.</p>}
          </section>

          <section aria-labelledby="busy-title" className="cp-panel">
            <div className="cp-panel-head"><div><h2 id="busy-title" className="cp-title">Busiest days</h2><p className="cp-subtle">Appointments by weekday, last 90 days.</p></div></div>
            <ul className="grid gap-2 p-4">{analytics.busiestDays.map((item) => <Row key={item.day} label={item.day} value={item.appointments} max={dayMax} tone="tone-brand" />)}</ul>
          </section>

          <section aria-labelledby="customers-title" className="cp-panel">
            <div className="cp-panel-head"><div><h2 id="customers-title" className="cp-title">Customer activity</h2><p className="cp-subtle">How recently customers were in touch.</p></div><UsersRound size={18} className="text-muted-foreground" aria-hidden="true" /></div>
            {health && health.total > 0 ? <div className="p-4"><div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${health.active} active, ${health.cooling} cooling, ${health.quiet} quiet`}>{[{ n: health.active, c: 'tone-positive' }, { n: health.cooling, c: 'tone-attention' }, { n: health.quiet, c: 'tone-neutral' }].map((part) => <span key={part.c} className={`${part.c} h-full bg-[hsl(var(--sem))]`} style={{ width: `${(part.n / health.total) * 100}%` }} />)}</div><ul className="mt-3 grid gap-1.5 text-sm"><li className="tone-positive flex items-center justify-between"><span className="inline-flex items-center gap-2 text-secondary"><span className="cp-dot" />Active this week</span><b className="tabular-nums">{health.active}</b></li><li className="tone-attention flex items-center justify-between"><span className="inline-flex items-center gap-2 text-secondary"><span className="cp-dot" />Cooling (8–30 days)</span><b className="tabular-nums">{health.cooling}</b></li><li className="tone-neutral flex items-center justify-between"><span className="inline-flex items-center gap-2 text-secondary"><span className="cp-dot" />Quiet (over 30 days)</span><b className="tabular-nums">{health.quiet}</b></li></ul></div> : <p className="px-4 py-6 text-center text-xs text-muted-foreground">No customers yet.</p>}
          </section>

          {analytics.topServices.length > 0 && <section aria-labelledby="services-title" className="cp-panel">
            <div className="cp-panel-head"><div><h2 id="services-title" className="cp-title">Most booked services</h2><p className="cp-subtle">Jobs created in the last 90 days.</p></div></div>
            <ul className="grid gap-2 p-4">{analytics.topServices.map((item) => <Row key={item.service} label={item.service} value={item.jobs} max={serviceMax} tone="tone-brand" />)}</ul>
          </section>}
        </div>
      </div>
    </>}

    {data && <section aria-labelledby="recs-title" className="cp-pilot">
      <div className="cp-panel-head"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-card ring-1 ring-[hsl(var(--pilot-glow)/0.45)]"><PilotAvatar size="md" state="speaking" /></span><div><h2 id="recs-title" className="cp-title">Pilot’s recommendations</h2><p className="cp-subtle">What Pilot would do next, based on what it can see in your records.</p></div></div></div>
      {recommendations.length ? <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{recommendations.map((item) => { const style = priorityStyle[item.priority]; return <article key={item.id} className={`${style.tone} cp-edge flex flex-col gap-2 rounded-lg bg-card p-3`}>
        <div className="flex items-center justify-between gap-2"><span className="cp-pill">{style.label}</span><span className="text-xs font-bold text-muted-foreground">{item.category}</span></div>
        <h3 className="text-sm font-extrabold text-secondary">{item.title}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{item.whyItMatters}</p>
        {item.evidence[0] && <p className="rounded-md bg-muted px-2 py-1 text-xs font-semibold text-secondary">{item.evidence[0]}</p>}
        <p className="text-xs leading-5 text-secondary"><span className="font-extrabold">Recommended: </span>{item.recommendation}</p>
        {item.action && <Link to={item.action.href} className="mt-auto inline-flex w-fit items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-primary-foreground">{item.action.label}<ArrowRight size={14} /></Link>}
      </article>; })}</div> : <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing needs Pilot’s attention right now. As your records grow, recommendations will appear here.</p>}
    </section>}
  </main></WorkspaceLayout>;
}

export default function InsightsPage() { return <><Helmet><title>Insights | Connection Pilot</title><meta name="description" content="Trends, patterns and opportunities from your own business records." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><InsightsContent /></ProtectedRoute></>; }
