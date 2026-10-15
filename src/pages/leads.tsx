import { Helmet } from '@dr.pogodin/react-helmet';
import { type FormEvent, useEffect, useState } from 'react';
import { ArrowUpRight, CircleDollarSign, ClipboardList, Plus, Search, UserRoundCheck, X } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { leads } from 'virtual:content';

type Lead = { id: string; customerId: string | null; name: string; phoneNumber: string | null; email: string | null; address: string | null; serviceRequested: string; source: string | null; estimatedValue: string | null; status: string; assignedEmployee: string | null; lastContactedAt: string | null; wonAt: string | null; lostAt: string | null; notes: string | null; createdAt: string };
type LeadActivity = { id: string; title: string; detail: string | null; occurredAt: string };
type LeadListResponse = { leads: Lead[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; summary: { total: number; new: number; followUp: number; won: number } };
type LeadDetailResponse = { lead: Lead; activities: LeadActivity[] };

const inputClass = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring';
const timezone = 'America/Toronto';

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
}

function formatMoney(value: string | null) {
  return value ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value)) : '—';
}

function statusLabel(status: string) {
  return leads.statuses.map((item) => item.id === status ? item.label : '').filter(Boolean)[0] || status;
}

function LeadsContent() {
  const [data, setData] = useState<LeadListResponse | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<LeadDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadLeads(nextQuery = query, nextStatus = status) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextQuery) params.set('q', nextQuery);
      if (nextStatus) params.set('status', nextStatus);
      const response = await fetch(`/api/leads?${params.toString()}`, { credentials: 'include' });
      const payload = await response.json() as LeadListResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load leads.');
      setData(payload);
      setError('');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load leads.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadLeads('', ''); }, []);

  async function openLead(leadId: string) {
    setNotice('');
    try {
      const response = await fetch(`/api/leads/${leadId}`, { credentials: 'include' });
      const payload = await response.json() as LeadDetailResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load the lead.');
      setDetail(payload);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load the lead.'); }
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/leads', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form.entries())) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to create the lead.');
      setShowCreate(false); setNotice('Lead created.');
      await loadLeads();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to create the lead.'); }
    finally { setSaving(false); }
  }

  async function updateLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/leads/${detail.lead.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
      const payload = await response.json() as { lead?: Lead; error?: string };
      if (!response.ok || !payload.lead) throw new Error(payload.error || 'Unable to update the lead.');
      await openLead(detail.lead.id); await loadLeads(); setNotice('Lead changes saved.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to update the lead.'); }
    finally { setSaving(false); }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const note = String(form.get('note') || '');
    if (!note.trim()) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/leads/${detail.lead.id}/activity`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to add a note.');
      event.currentTarget.reset(); await openLead(detail.lead.id); await loadLeads(); setNotice('Lead note added.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to add a note.'); }
    finally { setSaving(false); }
  }

  async function convertLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/leads/${detail.lead.id}/convert`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ createJob: form.get('createJob') === 'on' }) });
      const payload = await response.json() as { customerId?: string; jobId?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to convert the lead.');
      setDetail(null); await loadLeads(); setNotice(payload.jobId ? 'Lead converted to a customer and booked job.' : 'Lead converted to a customer.');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to convert the lead.'); }
    finally { setSaving(false); }
  }

  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="flex flex-col justify-between gap-base border-b border-border pb-lg sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-primary">{leads.hero.eyebrow}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{leads.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{leads.hero.description}</p></div><button onClick={() => setShowCreate(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-secondary"><Plus size={17} />{leads.hero.addButton}</button></section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}{notice && <p role="status" className="rounded-xl border border-primary bg-accent p-4 text-sm font-bold text-secondary">{notice}</p>}
    <section aria-label="Lead summary" className="grid grid-cols-2 divide-y divide-border border-y border-border lg:grid-cols-4 lg:divide-x lg:divide-y-0">{([{ title: leads.summary.all, value: data?.summary.total || 0, icon: ClipboardList }, { title: leads.summary.new, value: data?.summary.new || 0, icon: Plus }, { title: leads.summary.followUp, value: data?.summary.followUp || 0, icon: UserRoundCheck }, { title: leads.summary.won, value: data?.summary.won || 0, icon: CircleDollarSign }]).map((item) => <article key={item.title} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-muted-foreground">{item.title}</p><p className="mt-1 text-2xl font-extrabold tracking-[-0.04em] text-secondary">{item.value}</p></div><item.icon className="text-muted-foreground" size={17} /></div></article>)}</section>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row"><div role="group" aria-label="Lead filters" className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><label className="relative"><span className="sr-only">{leads.filters.search}</span><Search className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadLeads(); }} placeholder={leads.filters.search} className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-secondary outline-none focus:border-primary focus:ring-2 focus:ring-ring"><option value="">{leads.filters.allStatuses}</option>{leads.statuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button onClick={() => void loadLeads()} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-secondary hover:border-primary hover:bg-accent">{leads.filters.apply}</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-collapse text-left"><thead className="bg-muted"><tr className="border-b border-border"><th className="px-4 py-3 text-xs font-bold text-muted-foreground">{leads.table.lead}</th><th className="px-4 py-3 text-xs font-bold text-muted-foreground">{leads.table.service}</th><th className="px-4 py-3 text-xs font-bold text-muted-foreground">{leads.table.status}</th><th className="px-4 py-3 text-xs font-bold text-muted-foreground">{leads.table.value}</th><th className="px-4 py-3 text-xs font-bold text-muted-foreground">{leads.table.assigned}</th><th className="px-4 py-3 text-xs font-bold text-muted-foreground">{leads.table.lastContact}</th><th className="px-4 py-3 text-right text-xs font-bold text-muted-foreground">{leads.table.action}</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="p-10 text-center text-sm text-muted-foreground">Loading leads...</td></tr> : data?.leads.length ? data.leads.map((item) => <tr key={item.id} className="border-b border-border last:border-b-0 hover:bg-accent"><td className="p-4"><p className="font-extrabold text-secondary">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.phoneNumber || item.email || 'No contact details'}</p></td><td className="p-4 text-sm text-secondary">{item.serviceRequested}</td><td className="p-4"><span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-bold text-primary">{statusLabel(item.status)}</span></td><td className="p-4 text-sm font-bold text-secondary">{formatMoney(item.estimatedValue)}</td><td className="p-4 text-sm text-secondary">{item.assignedEmployee || 'Unassigned'}</td><td className="p-4 text-sm text-muted-foreground">{formatDate(item.lastContactedAt)}</td><td className="p-4 text-right"><button onClick={() => void openLead(item.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-primary hover:border-primary hover:bg-background">{leads.table.open}<ArrowUpRight size={14} /></button></td></tr>) : <tr><td colSpan={7} className="p-10 text-center"><ClipboardList className="mx-auto text-primary" size={26} /><p className="mt-3 font-bold text-secondary">{leads.empty.title}</p><p className="mt-1 text-sm text-muted-foreground">{leads.empty.description}</p></td></tr>}</tbody></table></div></section>
    {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-5"><form onSubmit={createLead} className="max-h-full w-full max-w-xl overflow-y-auto rounded-3xl bg-card p-base shadow-xl sm:p-xl"><div className="flex justify-between gap-4"><div><h2 className="text-2xl font-extrabold text-secondary">{leads.form.title}</h2><p className="mt-1 text-sm text-muted-foreground">{leads.form.description}</p></div><button type="button" onClick={() => setShowCreate(false)} aria-label={leads.detail.close} className="text-primary"><X size={20} /></button></div><LeadFields /><div className="mt-xl flex justify-end gap-3"><button type="button" onClick={() => setShowCreate(false)} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-secondary">{leads.form.cancel}</button><button disabled={saving} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">{saving ? leads.form.saving : leads.form.save}</button></div></form></div>}
    {detail && <div className="fixed inset-0 z-50 overflow-y-auto bg-secondary p-4 sm:p-8"><div className="mx-auto grid max-w-5xl gap-xl rounded-3xl bg-card p-base shadow-xl lg:grid-cols-[minmax(0,1fr)_300px] sm:p-xl"><section><div className="flex justify-between gap-4"><div><h2 className="text-2xl font-extrabold text-secondary">{leads.detail.title}</h2><p className="mt-1 text-sm text-muted-foreground">{leads.detail.description}</p></div><button onClick={() => setDetail(null)} aria-label={leads.detail.close} className="text-primary"><X size={20} /></button></div><form onSubmit={updateLead} className="mt-xl"><LeadFields lead={detail.lead} includeStatus /><button disabled={saving} className="mt-xl rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">{saving ? leads.detail.savingChanges : leads.detail.saveChanges}</button></form><form onSubmit={convertLead} className="mt-xl rounded-2xl border border-primary bg-accent p-base"><h3 className="font-extrabold text-secondary">{leads.detail.convert}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{leads.detail.convertDescription}</p><label className="mt-4 flex items-start gap-3 text-sm font-semibold text-secondary"><input type="checkbox" name="createJob" defaultChecked className="mt-1 h-4 w-4 accent-primary" />{leads.detail.createJob}</label><button disabled={saving} className="mt-4 rounded-full bg-secondary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60">{leads.detail.confirmConvert}</button></form></section><aside className="grid content-start gap-base"><section className="rounded-2xl bg-muted p-base"><h3 className="font-extrabold text-secondary">{leads.detail.activity}</h3><div className="mt-4 grid gap-4">{detail.activities.length ? detail.activities.map((activity) => <div key={activity.id} className="border-l-2 border-primary pl-3"><p className="text-sm font-bold text-secondary">{activity.title}</p>{activity.detail && <p className="mt-1 text-sm text-muted-foreground">{activity.detail}</p>}<p className="mt-1 text-xs text-muted-foreground">{formatDate(activity.occurredAt)}</p></div>) : <p className="text-sm text-muted-foreground">{leads.detail.activityEmpty}</p>}</div></section><form onSubmit={addNote} className="rounded-2xl border border-border p-base"><label className="grid gap-2 text-sm font-bold text-secondary">{leads.detail.note}<textarea required name="note" rows={4} className={inputClass} /></label><button disabled={saving} className="mt-3 rounded-full border border-border px-4 py-2 text-sm font-bold text-secondary disabled:opacity-60">{leads.detail.note}</button></form></aside></div></div>}
  </main></WorkspaceLayout>;
}

function LeadFields({ lead, includeStatus = false }: { lead?: Lead; includeStatus?: boolean }) {
  return <div className="mt-xl grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.name}<input required name="name" defaultValue={lead?.name || ''} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.service}<input required name="serviceRequested" defaultValue={lead?.serviceRequested || ''} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.phone}<input name="phoneNumber" type="tel" defaultValue={lead?.phoneNumber || ''} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.email}<input name="email" type="email" defaultValue={lead?.email || ''} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.source}<input name="source" defaultValue={lead?.source || ''} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.value}<input name="estimatedValue" inputMode="decimal" defaultValue={lead?.estimatedValue || ''} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary">{leads.form.assigned}<input name="assignedEmployee" defaultValue={lead?.assignedEmployee || ''} className={inputClass} /></label>{includeStatus && <label className="grid gap-2 text-sm font-bold text-secondary">{leads.table.status}<select name="status" defaultValue={lead?.status || 'new'} className={inputClass}>{leads.statuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}<label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">{leads.form.address}<textarea name="address" defaultValue={lead?.address || ''} rows={2} className={inputClass} /></label><label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">{leads.form.notes}<textarea name="notes" defaultValue={lead?.notes || ''} rows={4} className={inputClass} /></label></div>;
}

export default function LeadsPage() { const siteUrl = 'https://connectionpilot.net'; const title = leads.seo.title; const description = leads.seo.description; return <><Helmet><title>{title}</title><meta name="description" content={description} /><link rel="canonical" href={`${siteUrl}/leads`} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><LeadsContent /></ProtectedRoute></>; }
