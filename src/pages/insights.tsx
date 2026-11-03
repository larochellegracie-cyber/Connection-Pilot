import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Helmet } from '@dr.pogodin/react-helmet';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarDays, FileText, HandCoins, Minus, ReceiptText, Sparkles, TrendingUp, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotAvatar from '@/components/PilotAvatar';
import { BarList, Columns, Donut, RevenueChart, Ring, chartColors, moneyFormat } from '@/components/charts';
import type { Change, Overview } from '@/server/insights/overview';

type Recommendation = { id: string; priority: 'needs_attention' | 'keep_an_eye_on' | 'opportunity'; category: string; title: string; whatHappened: string; whyItMatters: string; recommendation: string; evidence: string[]; action?: { label: string; href: string } };
type Response = Overview & { timezone: string; recommendations: Recommendation[]; updatedAt: string };

const ranges = [['this_week', 'This week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['last_3_months', 'Last 3 months'], ['last_12_months', 'Last 12 months'], ['custom', 'Custom range']] as const;
const notEnough = 'Not enough data yet';
const needMore = 'More data is needed to show this insight.';
const priorityLabel = { needs_attention: 'Needs attention', keep_an_eye_on: 'Keep an eye on', opportunity: 'Opportunity' } as const;

function Empty({ title = notEnough, detail = needMore }: { title?: string; detail?: string }) {
  return <div className="rounded-xl border border-dashed border-border bg-muted px-4 py-6 text-center"><p className="font-bold text-secondary">{title}</p><p className="mt-0.5 text-sm text-muted-foreground">{detail}</p></div>;
}

function Card({ title, description, children, id, action, className = '' }: { title: string; description?: string; children: ReactNode; id: string; action?: ReactNode; className?: string }) {
  return <section aria-labelledby={id} className={`cp-card p-5 ${className}`}>
    <div className="mb-4 flex items-start justify-between gap-3"><div><h2 id={id} className="text-base font-extrabold tracking-[-0.015em] text-secondary">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>{action}</div>
    {children}
  </section>;
}

function ChangePill({ change }: { change: Change }) {
  if (change.direction === 'flat' && change.current === 0) return null;
  const Icon = change.direction === 'up' || change.direction === 'new' ? ArrowUpRight : change.direction === 'down' ? ArrowDownRight : Minus;
  const text = change.direction === 'new' ? 'New this period' : change.direction === 'flat' ? 'No change' : `${Math.abs(change.change ?? 0)}%`;
  const strong = change.direction === 'up' || change.direction === 'new';
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold ${strong ? 'bg-accent text-primary' : 'bg-muted text-secondary'}`}><Icon size={12} aria-hidden="true" />{text}<span className="sr-only"> compared with the previous period</span></span>;
}

function Kpi({ label, value, icon: Icon, to, change, note, emphasis }: { label: string; value: string; icon: LucideIcon; to: string; change?: Change; note?: string; emphasis?: boolean }) {
  return <Link to={to} className={`cp-card group block p-4 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${emphasis ? 'border-[#0B1F44]' : ''}`}>
    <div className="flex items-start justify-between gap-2"><p className="cp-eyebrow">{label}</p><span className="cp-tile tone-brand h-8 w-8"><Icon size={16} aria-hidden="true" /></span></div>
    <p className="mt-2 text-2xl font-extrabold tracking-[-0.03em] tabular-nums text-secondary">{value}</p>
    <div className="mt-1 flex min-h-[1.25rem] flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{change && <ChangePill change={change} />}{change && change.direction !== 'flat' && <span>vs previous period</span>}{note && <span>{note}</span>}</div>
  </Link>;
}

function InsightsContent() {
  const [params, setParams] = useSearchParams();
  const rangeKey = params.get('range') ?? 'this_month';
  const from = params.get('from') ?? ''; const to = params.get('to') ?? '';
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    const requestId = ++latest.current;
    setLoading(true);
    const query = new URLSearchParams({ range: rangeKey, ...(rangeKey === 'custom' && from && to ? { from, to } : {}) });
    if (rangeKey === 'custom' && !(from && to)) { setLoading(false); return; }
    void (async () => {
      try {
        const response = await fetch(`/api/insights/overview?${query}`, { credentials: 'include' });
        const payload = await response.json() as Response & { error?: string; upgradeRequired?: boolean };
        if (requestId !== latest.current) return;
        if (!response.ok) { setError(payload.upgradeRequired ? `${payload.error} ` : payload.error || 'Unable to load your insights right now.'); setLoading(false); return; }
        setData(payload); setError('');
      } catch { if (requestId === latest.current) setError('Unable to load your insights right now.'); }
      finally { if (requestId === latest.current) setLoading(false); }
    })();
  }, [rangeKey, from, to]);

  function chooseRange(next: string) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('range', next);
    if (next !== 'custom') { nextParams.delete('from'); nextParams.delete('to'); }
    setParams(nextParams, { replace: true });
  }
  function chooseDate(field: 'from' | 'to', value: string) { const nextParams = new URLSearchParams(params); nextParams.set('range', 'custom'); if (value) nextParams.set(field, value); else nextParams.delete(field); setParams(nextParams, { replace: true }); }

  const periodText = data ? `${data.range.from} to ${data.range.to}` : '';
  const rangeSelect = <div className="flex flex-wrap items-end gap-2">
    <label className="text-xs font-bold text-[#A9C2F5]">Date range<select aria-label="Date range" value={rangeKey} onChange={(event) => chooseRange(event.target.value)} className="mt-1 block rounded-lg border border-white/25 bg-[#12306b] px-3 py-2 text-sm font-semibold text-white">{ranges.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {rangeKey === 'custom' && <><label className="text-xs font-bold text-[#A9C2F5]">From<input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(event) => chooseDate('from', event.target.value)} className="mt-1 block rounded-lg border border-white/25 bg-[#12306b] px-3 py-2 text-sm font-semibold text-white [color-scheme:dark]" /></label><label className="text-xs font-bold text-[#A9C2F5]">To<input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(event) => chooseDate('to', event.target.value)} className="mt-1 block rounded-lg border border-white/25 bg-[#12306b] px-3 py-2 text-sm font-semibold text-white [color-scheme:dark]" /></label></>}
  </div>;

  const header = <section className="cp-hero flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-end sm:justify-between">
    <div><p className="cp-eyebrow">Business performance</p><h1 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-white sm:text-[1.75rem]">Insights</h1><p className="mt-1 text-sm text-[#C9D8F5]">How is my business performing?{data && <> <span className="text-[#A9C2F5]">· {data.range.label}, {periodText}</span></>}</p></div>
    {rangeSelect}
  </section>;

  if (!data) return <WorkspaceLayout><main className="grid gap-4">{header}
    {error ? <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}{/upgraded|subscription/i.test(error) && <> <Link to="/subscription" className="underline">Choose a plan</Link></>}</p> : rangeKey === 'custom' && !(from && to) ? <Empty title="Choose a start and end date" detail="Pick both dates to see your numbers for that period." /> : <p className="py-6 text-sm font-bold text-muted-foreground">Loading your insights…</p>}
  </main></WorkspaceLayout>;

  const d = data; const kp = d.kpis;
  const noMoney = d.revenueSeries.every((point) => point.received === 0 && point.invoiced === 0);
  const mixTotal = d.invoiceMix.reduce((sum, item) => sum + item.count, 0);
  const jobTotal = d.jobStatus.reduce((sum, item) => sum + item.count, 0);
  const jobColors: Record<string, string> = { booked: chartColors.sky, in_progress: chartColors.blue, completed: chartColors.navy, invoiced: chartColors.pale, paid: chartColors.slate, cancelled: '#B8C4DC' };
  const pipelineTotal = d.leadPipeline.reduce((sum, stage) => sum + stage.count, 0);
  const growthTotal = d.customerGrowth.series.reduce((sum, point) => sum + point.added, 0);

  return <WorkspaceLayout><main aria-busy={loading} className={`grid gap-4 transition-opacity ${loading ? 'opacity-70' : ''}`}>
    {header}
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-3 text-sm font-bold text-destructive">{error}</p>}

    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Payments received" value={moneyFormat(kp.received.current)} icon={HandCoins} to="/finance" change={kp.received} />
      <Kpi label="Outstanding" value={moneyFormat(kp.outstanding.amount)} icon={ReceiptText} to="/finance" note={kp.outstanding.count ? `${kp.outstanding.count} unpaid invoice${kp.outstanding.count === 1 ? '' : 's'}` : 'Nothing owing'} />
      <Kpi label="Overdue" value={moneyFormat(kp.overdue.amount)} icon={AlertTriangle} to="/finance" note={kp.overdue.count ? `${kp.overdue.count} invoice${kp.overdue.count === 1 ? '' : 's'} past due` : 'Nothing overdue'} emphasis={kp.overdue.count > 0} />
      <Kpi label="Jobs" value={String(kp.jobs.current)} icon={BriefcaseBusiness} to="/jobs" change={kp.jobs} />
      <Kpi label="Customers" value={String(kp.customers.total)} icon={UsersRound} to="/customers" change={kp.customers.new} />
      <Kpi label="Open leads" value={String(kp.leads.open)} icon={TrendingUp} to="/leads" note={`${kp.leads.new.current} new this period`} />
      <Kpi label="Quotes" value={String(kp.quotes.current)} icon={FileText} to="/finance" change={kp.quotes} note={kp.quotes.totalValue ? moneyFormat(kp.quotes.totalValue) : undefined} />
      <Kpi label="Appointments" value={String(kp.appointments.current)} icon={CalendarDays} to="/calendar" change={kp.appointments} />
    </section>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <Card id="revenue-title" title="Payments and invoicing" description={`Payments received and amounts invoiced, by ${d.range.granularity}. Payments are money actually received.`}>
        {noMoney ? <Empty detail="Payments and invoices will chart here once you have recorded some in this period." /> : <>
          <div className="mb-3 flex flex-wrap gap-6"><div><p className="cp-eyebrow">Received</p><p className="text-xl font-extrabold tabular-nums text-secondary">{moneyFormat(kp.received.current)}</p></div><div><p className="cp-eyebrow">Invoiced</p><p className="text-xl font-extrabold tabular-nums text-secondary">{moneyFormat(kp.invoiced.current)}</p></div></div>
          <RevenueChart points={d.revenueSeries} ariaLabel={`Payments received and invoiced per ${d.range.granularity}`} />
        </>}
      </Card>
      <Card id="jobs-title" title="Job status" description="Jobs scheduled in this period, by status.">
        {jobTotal === 0 ? <Empty detail="Jobs scheduled in this period will show here." /> : <Donut ariaLabel="Jobs by status" centerValue={String(jobTotal)} centerLabel={jobTotal === 1 ? 'job' : 'jobs'} segments={d.jobStatus.map((item) => ({ label: item.label, value: item.count, color: jobColors[item.status] ?? chartColors.slate }))} />}
      </Card>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card id="leads-title" title="Lead pipeline" description="Leads that arrived in this period, by where they are now." action={<Link to="/leads" className="cp-link shrink-0">View leads<ArrowUpRight size={14} aria-hidden="true" /></Link>}>
        {pipelineTotal === 0 ? <Empty detail="Leads added in this period will show here." /> : <BarList ariaLabel="Lead pipeline" rows={d.leadPipeline.map((stage) => ({ label: stage.label, value: stage.count, display: String(stage.count), note: stage.value > 0 ? moneyFormat(stage.value) : undefined, color: stage.status === 'lost' ? chartColors.slate : stage.status === 'won' ? chartColors.navy : chartColors.blue }))} />}
      </Card>
      <Card id="invoices-title" title="Invoice performance" description="Invoices created in this period, and money still owing today." action={<Link to="/finance" className="cp-link shrink-0">View invoices<ArrowUpRight size={14} aria-hidden="true" /></Link>}>
        {mixTotal === 0 && kp.outstanding.count === 0 ? <Empty detail="Invoices created in this period will show here." /> : <div className="grid gap-4">
          {mixTotal > 0 ? <Donut ariaLabel="Invoices by status" centerValue={String(mixTotal)} centerLabel={mixTotal === 1 ? 'invoice' : 'invoices'} segments={d.invoiceMix.map((item) => ({ label: item.label, value: item.count, color: item.key === 'paid' ? chartColors.blue : item.key === 'overdue' ? chartColors.navy : chartColors.sky, note: moneyFormat(item.amount) }))} /> : <Empty title="No invoices created in this period" detail="Only invoices still owing from earlier are shown below." />}
          <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${kp.overdue.count ? 'bg-[#0B1F44] text-white' : 'bg-muted text-secondary'}`}><span className="text-sm font-bold">Total outstanding today</span><span className="text-lg font-extrabold tabular-nums">{moneyFormat(kp.outstanding.amount)}{kp.overdue.count > 0 && <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-xs font-bold">{moneyFormat(kp.overdue.amount)} overdue</span>}</span></div>
        </div>}
      </Card>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card id="customers-title" title="Customer growth" description={`New customers by ${d.range.granularity}.`} action={<Link to="/customers" className="cp-link shrink-0">View customers<ArrowUpRight size={14} aria-hidden="true" /></Link>}>
        <div className="mb-3 grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-muted p-2"><p className="cp-eyebrow">Total</p><p className="text-lg font-extrabold tabular-nums text-secondary">{d.customerGrowth.total}</p></div><div className="rounded-xl bg-muted p-2"><p className="cp-eyebrow">New</p><p className="text-lg font-extrabold tabular-nums text-secondary">{d.customerGrowth.new}</p></div><div className="rounded-xl bg-muted p-2"><p className="cp-eyebrow">Returning</p><p className="text-lg font-extrabold tabular-nums text-secondary">{d.customerGrowth.returning}</p></div></div>
        {growthTotal === 0 ? <Empty detail="No customers were added in this period." /> : <Columns ariaLabel="New customers" unit={growthTotal === 1 ? 'customer' : 'customers'} points={d.customerGrowth.series.map((point) => ({ label: point.label, value: point.added }))} />}
      </Card>
      <Card id="quotes-title" title="Quote performance" description="Quotes created in this period." action={<Link to="/finance" className="cp-link shrink-0">View quotes<ArrowUpRight size={14} aria-hidden="true" /></Link>}>
        {d.quotes.total === 0 ? <Empty detail="Quotes created in this period will show here." /> : <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-5">
            {d.quotes.acceptanceRate !== null ? <Ring percent={d.quotes.acceptanceRate} label="accepted" ariaLabel={`Quote acceptance rate ${d.quotes.acceptanceRate}%`} /> : <div className="w-28 shrink-0 text-xs text-muted-foreground">Acceptance rate needs at least one quote that has been sent.</div>}
            <div className="grid gap-1 text-sm"><p><strong className="text-xl tabular-nums text-secondary">{d.quotes.total}</strong> <span className="text-muted-foreground">quotes, {moneyFormat(d.quotes.totalValue)} in total</span></p>{d.quotes.acceptanceRate !== null && <p className="text-xs text-muted-foreground">{d.quotes.accepted} of {d.quotes.sentOut} quotes that were sent were accepted.</p>}</div>
          </div>
          <BarList ariaLabel="Quotes by status" rows={d.quotes.byStatus.map((item) => ({ label: item.label, value: item.count, display: String(item.count), note: moneyFormat(item.value), color: item.status === 'accepted' ? chartColors.navy : item.status === 'declined' || item.status === 'expired' ? chartColors.slate : chartColors.blue }))} />
        </div>}
      </Card>
    </div>

    <Card id="workload-title" title="Appointments and workload" description="What the team is booked to do.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div><h3 className="cp-eyebrow mb-2">Bookings</h3><dl className="grid grid-cols-2 gap-2 text-sm">{[['Appointments completed', d.workload.appointments.completed], ['Appointments coming up', d.workload.appointments.comingUp], ['Jobs completed', d.workload.jobs.completed], ['Jobs coming up', d.workload.jobs.comingUp]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-muted p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-extrabold tabular-nums text-secondary">{value}</dd></div>)}</dl></div>
        <div><h3 className="cp-eyebrow mb-2">Busiest days</h3>{d.workload.busiestDays.every((day) => day.appointments === 0) ? <Empty detail="Appointments in this period will show which weekdays are busiest." /> : <Columns ariaLabel="Appointments by weekday" unit="appointments" points={d.workload.busiestDays.map((day) => ({ label: day.day, value: day.appointments }))} />}</div>
        <div><h3 className="cp-eyebrow mb-2">Scheduled hours by employee</h3>{d.workload.staff.byEmployee.length === 0 ? <Empty detail="Shifts on the schedule in this period will show here." /> : <><p className="mb-2 text-sm text-secondary"><strong className="text-xl tabular-nums">{d.workload.staff.scheduledHours}</strong> hours across {d.workload.staff.shifts} shift{d.workload.staff.shifts === 1 ? '' : 's'}</p><BarList ariaLabel="Scheduled hours by employee" rows={d.workload.staff.byEmployee.slice(0, 6).map((row) => ({ label: row.name, value: row.hours, display: `${row.hours} h` }))} /><p className="mt-2 text-xs text-muted-foreground">These are scheduled hours. Connection Pilot does not track hours actually worked.</p></>}</div>
      </div>
    </Card>

    <section aria-labelledby="pilot-insights-title" className="cp-navy cp-card-section">
      <div className="cp-head"><div className="cp-head-title"><span className="cp-tile tone-brand h-8 w-8"><Sparkles size={16} aria-hidden="true" /></span><div><h2 id="pilot-insights-title" className="cp-h2">Pilot’s Business Insights</h2><p className="cp-subtle">What stands out in your numbers for this period.</p></div></div><PilotAvatar size="sm" state="idle" /></div>
      {d.highlights.length === 0 && d.recommendations.length === 0 ? <div className="cp-empty"><p className="cp-empty-title">{notEnough}</p><p className="cp-empty-sub">As your records build up, Pilot will point out what matters here.</p></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {d.highlights.map((item) => <article key={item.id} className="cp-brief flex flex-col justify-between gap-2"><div><p className="text-sm font-extrabold text-white">{item.title}</p><p className="cp-brief-body mt-1 text-xs">{item.detail}</p></div><Link to={item.href} className="cp-link text-xs">{item.hrefLabel}<ArrowUpRight size={12} aria-hidden="true" /></Link></article>)}
        {d.recommendations.slice(0, 6).map((item) => <article key={item.id} className="cp-brief flex flex-col justify-between gap-2"><div><span className="cp-pill">{priorityLabel[item.priority]}</span><p className="mt-1.5 text-sm font-extrabold text-white">{item.title}</p><p className="cp-brief-body mt-1 text-xs">{item.recommendation}</p></div>{item.action && <Link to={item.action.href} className="cp-link text-xs">{item.action.label}<ArrowUpRight size={12} aria-hidden="true" /></Link>}</article>)}
      </div>}
    </section>
  </main></WorkspaceLayout>;
}

export default function InsightsPage() {
  return <><Helmet><title>Insights</title><meta name="description" content="How your business is performing." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><InsightsContent /></ProtectedRoute></>;
}
