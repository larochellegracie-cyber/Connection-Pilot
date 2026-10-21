import { Helmet } from '@dr.pogodin/react-helmet';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, ChevronsUpDown, Filter, Mail, MessageCircle, PhoneCall, Plus, Search, UserPlus, Users } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import { isFoodBusiness } from '@/lib/business-workflow';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { customers as customerHub } from 'virtual:content';

type NextAppointment = { id: string; title: string; scheduledAt: string; status: string } | null;
type Customer = { id: string; name: string; phoneNumber: string; email: string | null; company: string | null; status: string; createdAt: string; lastContactedAt: string; callCount: number; messageCount: number; tags: string[]; nextAppointment: NextAppointment };
type CustomerResponse = { businessType: string; customers: Customer[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; newCustomers: number; returningCustomers: number; upcomingAppointments: number } };
type SortKey = 'name' | 'status' | 'lastActivity' | 'nextAppointment';

function statusLabel(status: string) { return status.charAt(0).toUpperCase() + status.slice(1); }
function initials(name: string) { return name.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CP'; }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); }
const DAY_MS = 86_400_000;
/** How recently this customer was in touch: colour shows warmth without any new data. */
function activityHealth(lastContactedAt: string | null | undefined) {
  if (!lastContactedAt) return { label: 'No activity', tone: 'tone-neutral', ago: '' };
  const days = Math.max(0, Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / DAY_MS));
  const ago = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
  if (days <= 7) return { label: 'Active', tone: 'tone-positive', ago };
  if (days <= 30) return { label: 'Cooling', tone: 'tone-attention', ago };
  return { label: 'Quiet', tone: 'tone-neutral', ago };
}
function statusTone(status: string) {
  const value = status.toLowerCase();
  if (value === 'new') return 'tone-info';
  if (value === 'active') return 'tone-positive';
  if (value === 'returning') return 'tone-customer';
  return 'tone-neutral';
}
function formatDateTime(value: string) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function CustomersContent() {
  const [data, setData] = useState<CustomerResponse | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<SortKey>('lastActivity');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadCustomers(options: { nextQuery?: string; nextStatus?: string; nextSort?: SortKey; nextDirection?: 'asc' | 'desc'; nextPage?: number } = {}) {
    setLoading(true);
    const nextQuery = options.nextQuery ?? query;
    const nextStatus = options.nextStatus ?? status;
    const nextSort = options.nextSort ?? sort;
    const nextDirection = options.nextDirection ?? direction;
    const nextPage = options.nextPage ?? page;
    try {
      const params = new URLSearchParams({ page: String(nextPage), sort: nextSort, direction: nextDirection });
      if (nextQuery) params.set('q', nextQuery);
      if (nextStatus) params.set('status', nextStatus);
      const response = await fetch(`/api/customers?${params.toString()}`, { credentials: 'include' });
      const payload = await response.json() as CustomerResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load customers.');
      setData(payload);
      setPage(payload.pagination.page);
      setError('');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load customers.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadCustomers({ nextQuery: '', nextStatus: '', nextSort: 'lastActivity', nextDirection: 'desc', nextPage: 1 }); }, []);
  const customerList = useMemo(() => data?.customers || [], [data]);
  const foodBusiness = isFoodBusiness(data?.businessType);

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch('/api/customers', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), phoneNumber: form.get('phoneNumber'), email: form.get('email'), address: form.get('address'), tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to save customer.');
      setShowForm(false);
      await loadCustomers({ nextPage: 1 });
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save customer.'); }
    finally { setSaving(false); }
  }

  function applyFilters() { void loadCustomers({ nextPage: 1 }); }
  function changeSort(key: SortKey) {
    const nextDirection = sort === key && direction === 'desc' ? 'asc' : 'desc';
    setSort(key);
    setDirection(nextDirection);
    void loadCustomers({ nextSort: key, nextDirection, nextPage: 1 });
  }

  function sortButton(label: string, key: SortKey) {
    const isActive = sort === key;
    return <button type="button" onClick={() => changeSort(key)} className={`inline-flex items-center gap-1 text-left text-xs font-bold ${isActive ? 'text-primary' : 'text-muted-foreground hover:text-secondary'}`}><span>{label}</span><ChevronsUpDown size={14} aria-hidden="true" /></button>;
  }

  const pagination = data?.pagination;
  const rangeStart = pagination && pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const rangeEnd = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.total) : 0;

  return <WorkspaceLayout><main className="grid gap-4">
    <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><p className="cp-eyebrow">{customerHub.hero.eyebrow}</p><h1 className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-secondary sm:text-3xl">{customerHub.hero.title}</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{customerHub.hero.description}</p></div>
      <button onClick={() => setShowForm(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary"><Plus size={16} />{customerHub.hero.addButton}</button>
    </section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}
    <section aria-label="Customer summary" className="cp-panel">
      <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-4">
        {[
          { label: 'Total customers', value: data?.summary.total || 0, tone: 'tone-customer', icon: Users },
          { label: 'New customers', value: data?.summary.newCustomers || 0, tone: 'tone-info', icon: UserPlus },
          { label: 'Returning customers', value: data?.summary.returningCustomers || 0, tone: 'tone-positive', icon: MessageCircle },
          { label: foodBusiness ? 'Upcoming pickups' : 'Upcoming appointments', value: data?.summary.upcomingAppointments || 0, tone: 'tone-info', icon: CalendarDays },
        ].map((metric) => { const Icon = metric.icon; return <article key={metric.label} className={`${metric.tone} flex items-center justify-between gap-3 bg-card px-4 py-3`}><div><p className="cp-eyebrow">{metric.label}</p><p className="cp-metric-value mt-1">{metric.value}</p></div><span className="cp-tile h-9 w-9"><Icon size={17} /></span></article>; })}
      </div>
    </section>
    <section className="cp-panel">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between"><div role="group" aria-label="Customer filters" className="grid w-full gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto] lg:max-w-3xl">
        <label className="relative"><span className="sr-only">Search customers</span><Search className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }} placeholder="Search customers by name, phone, email, or company" className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring" /></label>
        <label className="relative"><span className="sr-only">Filter by status</span><Filter className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"><option value="">All active</option><option value="new">New</option><option value="active">Active</option><option value="returning">Returning</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label>
        <button onClick={applyFilters} className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-secondary transition-colors hover:border-primary hover:bg-accent">Apply</button>
      </div><p className="shrink-0 text-xs font-semibold text-muted-foreground">{pagination ? `${rangeStart}–${rangeEnd} of ${pagination.total} customers` : 'Loading customers'}</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-collapse text-left"><thead className="bg-muted"><tr className="border-b border-border"><th scope="col" className="px-4 py-2.5">{sortButton('Customer', 'name')}</th><th scope="col" className="px-4 py-2.5 text-xs font-bold text-muted-foreground">Contact</th><th scope="col" className="px-4 py-2.5">{sortButton('Status', 'status')}</th><th scope="col" className="px-4 py-2.5">{sortButton('Activity', 'lastActivity')}</th><th scope="col" className="px-4 py-2.5">{sortButton(foodBusiness ? 'Next pickup' : 'Next appointment', 'nextAppointment')}</th><th scope="col" className="px-4 py-2.5 text-right text-xs font-bold text-muted-foreground">Action</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading customers...</td></tr> : customerList.length ? customerList.map((customer) => { const health = activityHealth(customer.lastContactedAt); return <tr key={customer.id} className="border-b border-border last:border-b-0 transition-colors hover:bg-accent"><td className="px-4 py-2.5"><div className="tone-customer flex items-center gap-3"><div className="cp-tile h-9 w-9 text-xs">{initials(customer.name)}</div><div className="min-w-0"><p className="font-extrabold text-secondary"><Link to={`/dashboard/customers/${customer.id}`} className="hover:text-primary hover:underline focus-visible:text-primary focus-visible:underline">{customer.name}</Link></p>{customer.company && <p className="mt-0.5 truncate text-xs text-muted-foreground">{customer.company}</p>}</div></div></td><td className="px-4 py-2.5"><div className="grid gap-0.5 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><PhoneCall className="shrink-0" size={13} />{customer.phoneNumber}</span>{customer.email && <span className="inline-flex max-w-52 items-center gap-1.5"><Mail className="shrink-0" size={13} /><span className="truncate">{customer.email}</span></span>}</div></td><td className="px-4 py-2.5"><span className={`cp-pill ${statusTone(customer.status)}`}>{statusLabel(customer.status)}</span></td><td className="px-4 py-2.5"><div className={health.tone}><span className="inline-flex items-center gap-1.5 text-xs font-bold text-secondary"><span className="cp-dot" />{health.label}{health.ago && <span className="font-semibold text-muted-foreground">· {health.ago}</span>}</span><p className="mt-0.5 text-xs text-muted-foreground">{customer.callCount} {customer.callCount === 1 ? 'call' : 'calls'} · {customer.messageCount} {customer.messageCount === 1 ? 'message' : 'messages'}</p>{customer.lastContactedAt && <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(customer.lastContactedAt)}</p>}</div></td><td className="px-4 py-2.5">{customer.nextAppointment ? <div className="inline-flex items-start gap-1.5 text-xs"><CalendarDays className="mt-0.5 shrink-0 text-muted-foreground" size={13} /><div><p className="font-bold text-secondary">{formatShortDate(customer.nextAppointment.scheduledAt)}</p><p className="mt-0.5 max-w-32 truncate text-muted-foreground">{customer.nextAppointment.title}</p></div></div> : <span className="text-xs text-muted-foreground">—</span>}</td><td className="px-4 py-2.5 text-right"><Link to={`/dashboard/customers/${customer.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-primary transition-colors hover:border-primary hover:bg-background">Open profile<ArrowUpRight size={13} /></Link></td></tr>; }) : <tr><td colSpan={6} className="px-4 py-8 text-center"><Users className="mx-auto text-muted-foreground" size={24} /><p className="mt-2 font-bold text-secondary">No customers found</p><p className="mt-1 text-sm text-muted-foreground">Adjust your search or filters, or add a customer.</p></td></tr>}</tbody></table></div>
      {pagination && pagination.totalPages > 1 && <div className="flex items-center justify-between border-t border-border px-4 py-3"><p className="text-xs font-semibold text-muted-foreground">Page {pagination.page} of {pagination.totalPages}</p><div className="flex items-center gap-2"><button disabled={pagination.page === 1} onClick={() => void loadCustomers({ nextPage: pagination.page - 1 })} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-secondary transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"><ChevronLeft size={15} />Previous</button><button disabled={pagination.page === pagination.totalPages} onClick={() => void loadCustomers({ nextPage: pagination.page + 1 })} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-secondary transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50">Next<ChevronRight size={15} /></button></div></div>}
    </section>
    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-5"><form onSubmit={submitCustomer} className="max-h-full w-full max-w-xl overflow-y-auto rounded-3xl bg-card p-base shadow-xl sm:p-xl"><div className="flex justify-between gap-4"><div><h2 className="text-2xl font-extrabold text-secondary">Add customer</h2><p className="mt-1 text-sm text-muted-foreground">Matching phone and email details keeps customer profiles unified.</p></div><button type="button" onClick={() => setShowForm(false)} className="text-sm font-bold text-primary">Close</button></div><div className="mt-xl grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">Full name<input required name="name" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Phone number<input required name="phoneNumber" type="tel" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Email<input name="email" type="email" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">Address<input name="address" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">Tags <span className="font-normal text-muted-foreground">(comma separated)</span><input name="tags" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label></div><div className="mt-xl flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-secondary">Cancel</button><button disabled={saving} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">{saving ? 'Saving...' : 'Save customer'}</button></div></form></div>}
  </main></WorkspaceLayout>;
}

const siteUrl = 'https://connectionpilot.net';
const customersTitle = 'Customer Management | Connection Pilot';
const customersDescription = 'Manage customer profiles, communication history, notes, and appointments in your Connection Pilot workspace.';
const ogImage = `${siteUrl}/airo-assets/images/pages/home/customer-service-team`;
const customersJsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${siteUrl}/customers#webpage`, name: customersTitle, url: `${siteUrl}/customers`, isPartOf: { '@id': `${siteUrl}/#website` }, about: { '@id': `${siteUrl}/#organization` } };

export default function CustomersPage() { return <><Helmet><title>{customersTitle}</title><meta name="description" content={customersDescription} /><link rel="canonical" href={`${siteUrl}/customers`} /><meta property="og:title" content={customersTitle} /><meta property="og:description" content={customersDescription} /><meta property="og:image" content={ogImage} /><meta property="og:url" content={`${siteUrl}/customers`} /><meta property="og:type" content="website" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:image" content={ogImage} /><meta name="robots" content="noindex, nofollow" /><script type="application/ld+json">{JSON.stringify(customersJsonLd).replace(/</g, '\\u003c')}</script></Helmet><ProtectedRoute><CustomersContent /></ProtectedRoute></>; }
