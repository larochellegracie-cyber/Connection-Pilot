import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Archive, CalendarDays, CheckCircle2, Clock3, FileText, Mail, MapPin, MessageCircle, PackagePlus, Phone, PhoneCall, Save } from 'lucide-react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import { isFoodBusiness } from '@/lib/business-workflow';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import PilotAvatar from '@/components/PilotAvatar';
import { customer_profile } from 'virtual:content';

type TimelineItem = { id: string; activityType: string; title: string; detail: string | null; occurredAt: string };
type Appointment = { id: string; title: string; status: string; scheduledAt: string; notes: string | null; createdAt: string };
type Interaction = { id: string; interactionType: string; direction: string; conversation: string | null; summary: string | null; occurredAt: string };
type Job = { id: string; service: string; status: string; scheduledAt: string | null; notes: string | null };
type BillingRecord = { id: string; status: string; total?: string; amount?: string; createdAt: string; receivedAt?: string | null };
type Profile = { businessType: string; customer: { id: string; name: string; phoneNumber: string; email: string | null; address: string | null; status: string; createdAt: string; callCount: number; messageCount: number }; conversations: { id: string; channel: string; direction: string; content: string; occurredAt: string }[]; interactions: Interaction[]; appointments: Appointment[]; notes: { id: string; body: string; createdAt: string }[]; activities: TimelineItem[]; jobs: Job[]; estimates: BillingRecord[]; invoices: BillingRecord[]; payments: BillingRecord[]; tags: string[] };

function formatDate(value: string) { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function titleCase(value: string) { return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function initials(value: string) { return value.split(' ').filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'CP'; }
function formatMoney(value: string | undefined) { return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value || 0)); }

function ActivityIcon({ type }: { type: string }) {
  const iconClass = 'h-4 w-4';
  if (type === 'note') return <FileText className={iconClass} />;
  if (type === 'call') return <PhoneCall className={iconClass} />;
  if (type === 'appointment') return <CalendarDays className={iconClass} />;
  return <MessageCircle className={iconClass} />;
}

function CustomerProfileContent() {
  const { customerId = '' } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingOrder, setAddingOrder] = useState(false);

  async function loadProfile() {
    setLoading(true);
    try {
      const response = await fetch(`/api/customers/${customerId}`, { credentials: 'include' });
      const payload = await response.json() as Profile & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to load customer profile.');
      setProfile(payload);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load customer profile.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProfile(); }, [customerId]);

  const upcomingAppointments = useMemo(() => {
    if (!profile) return [] as Appointment[];
    return profile.appointments
      .filter((appointment) => !['cancelled', 'completed'].includes(appointment.status) && new Date(appointment.scheduledAt).getTime() >= Date.now())
      .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime());
  }, [profile]);

  const lastContact = useMemo(() => {
    if (!profile) return null;
    return [...profile.interactions.map((item) => item.occurredAt), ...profile.conversations.map((item) => item.occurredAt)]
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
  }, [profile]);

  const recentActivity = useMemo(() => {
    if (!profile) return [] as TimelineItem[];
    return [
      ...profile.activities.map((item) => ({ ...item, title: item.activityType === 'note' ? 'Note added' : item.title })),
      ...profile.appointments.map((item) => ({
        id: `appointment-${item.id}`,
        activityType: 'appointment',
        title: item.status === 'cancelled' ? 'Appointment cancelled' : item.status === 'completed' ? 'Appointment completed' : 'Appointment booked',
        detail: item.title,
        occurredAt: item.createdAt,
      })),
      ...profile.interactions.map((item) => ({
        id: `interaction-${item.id}`,
        activityType: item.interactionType,
        title: item.interactionType === 'call' ? (item.direction === 'outbound' ? 'Call made' : 'Call received') : 'Important customer message',
        detail: item.conversation || item.summary,
        occurredAt: item.occurredAt,
      })),
      ...profile.conversations.map((item) => ({
        id: `conversation-${item.id}`,
        activityType: 'message',
        title: 'Important customer message',
        detail: item.content,
        occurredAt: item.occurredAt,
      })),
      ...profile.jobs.map((item) => ({
        id: `job-${item.id}`,
        activityType: 'order',
        title: profile.businessType.toLowerCase().includes('bakery') ? 'Order recorded' : 'Job recorded',
        detail: item.service,
        occurredAt: item.scheduledAt || new Date().toISOString(),
      })),
    ]
      .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
      .slice(0, 6);
  }, [profile]);

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/customers/${customerId}/activity`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'note', body: form.get('body') }) });
    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error || 'Unable to add note.');
      return;
    }
    event.currentTarget.reset();
    await loadProfile();
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch(`/api/customers/${customerId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), phoneNumber: form.get('phoneNumber'), email: form.get('email'), address: form.get('address'), status: form.get('status'), tags: String(form.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean) }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to update customer.');
      setEditing(false);
      await loadProfile();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update customer.');
    } finally {
      setSaving(false);
    }
  }

  async function addOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const response = await fetch('/api/jobs', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId: profile.customer.id, service: form.get('title'), scheduledAt: form.get('pickupAt') ? new Date(String(form.get('pickupAt'))).toISOString() : null, status: form.get('status'), notes: form.get('notes') }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to add the order.');
      setAddingOrder(false);
      await loadProfile();
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : 'Unable to add the order.');
    } finally {
      setSaving(false);
    }
  }

  async function archiveCustomer() {
    if (!window.confirm('Archive this customer? Their history will be retained.')) return;
    const response = await fetch(`/api/customers/${customerId}`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) navigate('/customers'); else setError('Unable to archive customer.');
  }

  if (loading) return <WorkspaceLayout><main className="py-xxl text-sm font-bold text-muted-foreground">Loading customer profile...</main></WorkspaceLayout>;
  if (error || !profile) return <WorkspaceLayout><main className="py-xxl"><p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error || 'Customer profile not found.'}</p><Link to="/customers" className="mt-base inline-block text-sm font-bold text-primary">Back to customers</Link></main></WorkspaceLayout>;

  const isBakery = isFoodBusiness(profile.businessType);
  const nextAppointment = upcomingAppointments[0] || null;
  const nextPickup = profile.jobs.filter((job) => job.scheduledAt && !['cancelled', 'completed'].includes(job.status) && new Date(job.scheduledAt).getTime() >= Date.now()).sort((left, right) => new Date(left.scheduledAt || 0).getTime() - new Date(right.scheduledAt || 0).getTime())[0] || null;
  const preferredContact = profile.customer.messageCount > profile.customer.callCount ? 'Text message' : profile.customer.callCount ? 'Phone call' : 'Not set';
  const status = titleCase(profile.customer.status);
  const paymentsReceived = profile.payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  const invoicedTotal = profile.invoices.reduce((total, invoice) => total + Number(invoice.total || 0), 0);
  const estimatedTotal = profile.estimates.reduce((total, estimate) => total + Number(estimate.total || 0), 0);
  const financialRecords = [
    ...profile.estimates.map((estimate) => ({ id: `estimate-${estimate.id}`, kind: customer_profile.labels.estimated, amount: estimate.total, status: estimate.status, date: estimate.createdAt })),
    ...profile.invoices.map((invoice) => ({ id: `invoice-${invoice.id}`, kind: customer_profile.labels.invoiced, amount: invoice.total, status: invoice.status, date: invoice.createdAt })),
    ...profile.payments.map((payment) => ({ id: `payment-${payment.id}`, kind: customer_profile.labels.paid, amount: payment.amount, status: payment.status, date: payment.receivedAt || payment.createdAt })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

  return <WorkspaceLayout><main className="grid gap-xl pb-xxl">
    <Link to="/customers" className="inline-flex w-fit items-center gap-2 text-sm font-bold text-primary hover:text-secondary"><ArrowLeft size={16} />{customer_profile.navigation.back}</Link>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}

    <section className="border-b border-border pb-lg">
      <div className="flex flex-col gap-base lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent text-xl font-extrabold text-primary">{initials(profile.customer.name)}</div>
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h1 className="text-3xl font-extrabold tracking-[-0.045em] text-secondary sm:text-4xl">{profile.customer.name}</h1><span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-bold text-success"><CheckCircle2 size={14} />{status === 'Active' ? customer_profile.labels.active : status}</span></div><div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Phone size={14} />{profile.customer.phoneNumber}</span></div></div>
        </div>
        <div className="flex flex-wrap gap-3"><button onClick={() => setEditing(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary">Edit customer</button><button onClick={archiveCustomer} className="inline-flex items-center gap-2 px-2 py-2 text-sm font-bold text-destructive transition-colors hover:text-secondary"><Archive size={16} />Archive</button></div>
      </div>
      <dl className="mt-lg grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <div className="p-4"><dt className="text-xs font-bold text-muted-foreground">{isBakery ? 'Next pickup' : customer_profile.labels.nextAppointment}</dt><dd className="mt-2 font-extrabold text-secondary">{isBakery ? nextPickup ? formatShortDate(nextPickup.scheduledAt || '') : customer_profile.labels.notScheduled : nextAppointment ? formatShortDate(nextAppointment.scheduledAt) : customer_profile.labels.notScheduled}</dd><p className="mt-1 text-xs text-muted-foreground">{isBakery ? nextPickup?.scheduledAt ? `${formatTime(nextPickup.scheduledAt)} · ${nextPickup.service}` : customer_profile.labels.notAvailable : nextAppointment ? `${formatTime(nextAppointment.scheduledAt)} · ${nextAppointment.title}` : customer_profile.labels.notAvailable}</p></div>
        <div className="p-4"><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.lastContact}</dt><dd className="mt-2 font-extrabold text-secondary">{lastContact ? formatShortDate(lastContact) : customer_profile.labels.notAvailable}</dd><p className="mt-1 text-xs text-muted-foreground">{lastContact ? formatTime(lastContact) : customer_profile.labels.unknown}</p></div>
        <div className="p-4"><dt className="text-xs font-bold text-muted-foreground">{isBakery ? 'Open orders' : customer_profile.labels.upcomingAppointments}</dt><dd className="mt-2 text-2xl font-extrabold text-secondary">{isBakery ? profile.jobs.filter((job) => !['cancelled', 'completed'].includes(job.status)).length : upcomingAppointments.length}</dd><p className="mt-1 text-xs text-muted-foreground">{isBakery ? `${profile.jobs.length} total orders` : `${profile.appointments.length} total appointments`}</p></div>
        <div className="p-4"><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.customerSince}</dt><dd className="mt-2 font-extrabold text-secondary">{formatShortDate(profile.customer.createdAt)}</dd><p className="mt-1 text-xs text-muted-foreground">{status} customer</p></div>
      </dl>
    </section>

    <div className="grid gap-xl xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
      <div className="grid gap-xl">
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><PilotAvatar size="sm" /><div><h2 className="text-2xl font-extrabold tracking-[-0.03em] text-secondary">Pilot's customer activity</h2><p className="mt-1 text-sm text-muted-foreground">The key moments that matter for this customer.</p></div></div><Link to="/messages" className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-bold text-primary transition-colors hover:border-primary"><MessageCircle size={15} />{customer_profile.navigation.viewConversation}</Link></div><div className="mt-lg grid gap-1">{recentActivity.length ? recentActivity.map((item) => <article key={item.id} className="grid grid-cols-[auto_1fr] gap-3 border-b border-border py-4 last:border-b-0"><div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><ActivityIcon type={item.activityType} /></div><div className="min-w-0"><div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 className="font-extrabold text-secondary">{item.title}</h3><time dateTime={item.occurredAt} className="text-xs font-medium text-muted-foreground">{formatDate(item.occurredAt)}</time></div>{item.detail && <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.detail}</p>}</div></article>) : <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">{customer_profile.headings.activityEmpty}</p>}</div></section>
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-2xl font-extrabold tracking-[-0.03em] text-secondary">{customer_profile.headings.notes}</h2><p className="mt-1 text-sm text-muted-foreground">Private context for your team.</p></div><FileText className="text-primary" size={21} /></div><form onSubmit={addNote} className="mt-lg grid gap-3"><label className="sr-only" htmlFor="customer-note">{customer_profile.labels.privateNote}</label><textarea id="customer-note" name="body" required placeholder={customer_profile.labels.addNote} className="min-h-24 rounded-2xl border border-border bg-background p-3 text-sm text-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring" /><button className="justify-self-start rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">{customer_profile.labels.saveNote}</button></form><div className="mt-lg grid gap-3">{profile.notes.length ? profile.notes.slice(0, 5).map((note) => <article key={note.id} className="rounded-2xl border border-border bg-background p-4"><p className="text-sm leading-6 text-secondary">{note.body}</p><time dateTime={note.createdAt} className="mt-3 block text-xs font-semibold text-muted-foreground">{formatDate(note.createdAt)}</time></article>) : <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">{customer_profile.headings.notesEmpty}</p>}</div></section>
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl"><div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-extrabold tracking-[-0.03em] text-secondary">{isBakery ? 'Orders & pickup history' : customer_profile.headings.serviceHistory}</h2><p className="mt-1 text-sm text-muted-foreground">{isBakery ? 'Every order is connected to this customer record.' : customer_profile.headings.serviceHistoryDescription}</p></div><div className="flex items-center gap-3">{isBakery && <button onClick={() => setAddingOrder(true)} className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"><PackagePlus size={15} />Add order</button>}<Link to="/jobs" className="text-sm font-bold text-primary hover:text-secondary">{isBakery ? 'Open orders' : 'Open jobs'}</Link></div></div><div className="mt-lg grid grid-cols-2 divide-y divide-border border-y border-border sm:grid-cols-4 sm:divide-x sm:divide-y-0"><div className="p-3"><p className="text-xs font-bold text-muted-foreground">{isBakery ? 'Orders' : customer_profile.labels.jobs}</p><p className="mt-1 text-xl font-extrabold text-secondary">{profile.jobs.length}</p></div><div className="p-3"><p className="text-xs font-bold text-muted-foreground">{customer_profile.labels.estimates}</p><p className="mt-1 text-xl font-extrabold text-secondary">{formatMoney(estimatedTotal.toFixed(2))}</p></div><div className="p-3"><p className="text-xs font-bold text-muted-foreground">{customer_profile.labels.invoices}</p><p className="mt-1 text-xl font-extrabold text-secondary">{formatMoney(invoicedTotal.toFixed(2))}</p></div><div className="p-3"><p className="text-xs font-bold text-muted-foreground">{customer_profile.labels.paymentsReceived}</p><p className="mt-1 text-xl font-extrabold text-secondary">{formatMoney(paymentsReceived.toFixed(2))}</p></div></div><div className="mt-lg grid gap-3">{profile.jobs.length ? profile.jobs.slice(0, 5).map((job) => <article key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-background p-4"><div><p className="font-bold text-secondary">{job.service}</p><p className="mt-1 text-xs text-muted-foreground">{job.scheduledAt ? `${isBakery ? 'Pickup' : 'Scheduled'} · ${formatDate(job.scheduledAt)}` : customer_profile.labels.notScheduled}</p>{job.notes && <p className="mt-1 text-xs text-muted-foreground">{job.notes}</p>}</div><span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-primary">{isBakery && job.status === 'completed' ? 'Picked up' : titleCase(job.status)}</span></article>) : <p className="rounded-2xl bg-muted p-4 text-sm text-muted-foreground">{isBakery ? 'No orders are connected to this customer yet.' : customer_profile.headings.jobsEmpty}</p>}</div></section>
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl"><div><h2 className="text-2xl font-extrabold tracking-[-0.03em] text-secondary">{customer_profile.headings.financialRecords}</h2><p className="mt-1 text-sm text-muted-foreground">{customer_profile.headings.financialRecordsDescription}</p></div>{financialRecords.length ? <div className="mt-lg overflow-x-auto"><table className="w-full min-w-[520px] text-left"><thead className="border-b border-border"><tr><th scope="col" className="pb-3 text-xs font-bold text-muted-foreground">{customer_profile.labels.recorded}</th><th scope="col" className="pb-3 text-xs font-bold text-muted-foreground">{customer_profile.labels.amount}</th><th scope="col" className="pb-3 text-xs font-bold text-muted-foreground">{customer_profile.labels.status}</th></tr></thead><tbody className="divide-y divide-border">{financialRecords.slice(0, 8).map((record) => <tr key={record.id}><td className="py-3"><p className="text-sm font-bold text-secondary">{record.kind}</p><time dateTime={record.date} className="mt-1 block text-xs text-muted-foreground">{formatShortDate(record.date)}</time></td><td className="py-3 text-sm font-extrabold text-secondary">{formatMoney(record.amount)}</td><td className="py-3"><span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-primary">{titleCase(record.status)}</span></td></tr>)}</tbody></table></div> : <p className="mt-lg rounded-2xl bg-muted p-4 text-sm text-muted-foreground">{customer_profile.headings.financialEmpty}</p>}</section>
      </div>

      <aside className="grid content-start gap-xl">
        <section className="rounded-3xl border border-primary bg-card p-base shadow-sm sm:p-lg"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-primary">{customer_profile.headings.upcoming}</p><h2 className="mt-1 text-xl font-extrabold text-secondary">{nextAppointment ? nextAppointment.title : customer_profile.headings.noUpcoming}</h2></div><CalendarDays className="text-primary" size={22} /></div>{nextAppointment ? <><div className="mt-lg grid gap-3 rounded-2xl bg-accent p-4"><div className="grid grid-cols-[auto_1fr] gap-3"><CalendarDays className="mt-0.5 text-primary" size={17} /><div><p className="text-xs font-bold text-muted-foreground">{customer_profile.labels.date}</p><p className="mt-0.5 text-sm font-extrabold text-secondary">{formatShortDate(nextAppointment.scheduledAt)}</p></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><Clock3 className="mt-0.5 text-primary" size={17} /><div><p className="text-xs font-bold text-muted-foreground">{customer_profile.labels.time}</p><p className="mt-0.5 text-sm font-extrabold text-secondary">{formatTime(nextAppointment.scheduledAt)}</p></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><MapPin className="mt-0.5 text-primary" size={17} /><div><p className="text-xs font-bold text-muted-foreground">{customer_profile.labels.address}</p><p className="mt-0.5 text-sm font-extrabold text-secondary">{profile.customer.address || customer_profile.labels.notAvailable}</p></div></div><div className="flex items-center justify-between gap-3 border-t border-border pt-3"><span className="text-xs font-bold text-muted-foreground">{customer_profile.labels.appointmentStatus}</span><span className="rounded-full bg-card px-2.5 py-1 text-xs font-bold text-primary">{titleCase(nextAppointment.status)}</span></div></div><div className="mt-base grid grid-cols-2 gap-3"><Link to="/calendar" className="rounded-full border border-border px-3 py-2 text-center text-sm font-bold text-secondary transition-colors hover:border-primary">{customer_profile.navigation.viewAppointment}</Link><Link to="/calendar" className="rounded-full bg-primary px-3 py-2 text-center text-sm font-bold text-primary-foreground">{customer_profile.navigation.reschedule}</Link></div></> : <Link to="/calendar" className="mt-lg inline-flex rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">{customer_profile.navigation.openCalendar}</Link>}</section>
        <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-lg"><h2 className="text-xl font-extrabold text-secondary">{customer_profile.headings.details}</h2><dl className="mt-lg grid gap-4"><div className="grid grid-cols-[auto_1fr] gap-3"><Phone className="mt-0.5 text-primary" size={17} /><div><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.phone}</dt><dd className="mt-0.5 text-sm font-bold text-secondary">{profile.customer.phoneNumber}</dd></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><Mail className="mt-0.5 text-primary" size={17} /><div><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.email}</dt><dd className="mt-0.5 break-words text-sm font-bold text-secondary">{profile.customer.email || customer_profile.labels.notAvailable}</dd></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><MapPin className="mt-0.5 text-primary" size={17} /><div><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.address}</dt><dd className="mt-0.5 text-sm font-bold text-secondary">{profile.customer.address || customer_profile.labels.notAvailable}</dd></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><MessageCircle className="mt-0.5 text-primary" size={17} /><div><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.preferredContact}</dt><dd className="mt-0.5 text-sm font-bold text-secondary">{preferredContact}</dd></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><CalendarDays className="mt-0.5 text-primary" size={17} /><div><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.totalAppointments}</dt><dd className="mt-0.5 text-sm font-bold text-secondary">{profile.appointments.length}</dd></div></div><div className="grid grid-cols-[auto_1fr] gap-3"><CheckCircle2 className="mt-0.5 text-primary" size={17} /><div><dt className="text-xs font-bold text-muted-foreground">{customer_profile.labels.customerStatus}</dt><dd className="mt-0.5 text-sm font-bold text-secondary">{status}</dd></div></div></dl>{profile.tags.length > 0 && <div className="mt-lg flex flex-wrap gap-2 border-t border-border pt-4">{profile.tags.map((tag) => <span key={tag} className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-primary">{tag}</span>)}</div>}</section>
      </aside>
    </div>

    {addingOrder && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-5"><form onSubmit={addOrder} className="max-h-full w-full max-w-xl overflow-y-auto rounded-3xl bg-card p-base shadow-xl sm:p-xl"><div className="flex justify-between gap-4"><div><h2 className="text-2xl font-extrabold text-secondary">Add order</h2><p className="mt-1 text-sm text-muted-foreground">This order will be saved in {profile.customer.name}&apos;s customer history.</p></div><button type="button" onClick={() => setAddingOrder(false)} className="text-sm font-bold text-primary">Close</button></div><div className="mt-xl grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">Order details<input required name="title" placeholder="e.g. Birthday cake · chocolate" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Pickup date and time<input name="pickupAt" type="datetime-local" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Order status<select name="status" defaultValue="booked" className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary"><option value="booked">Confirmed</option><option value="in_progress">In progress</option><option value="completed">Picked up</option><option value="cancelled">Cancelled</option></select></label><label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">Order notes<textarea name="notes" rows={4} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label></div><div className="mt-xl flex justify-end gap-3"><button type="button" onClick={() => setAddingOrder(false)} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-secondary">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"><PackagePlus size={16} />{saving ? 'Saving...' : 'Save order'}</button></div></form></div>}
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-5"><form onSubmit={saveCustomer} className="max-h-full w-full max-w-xl overflow-y-auto rounded-3xl bg-card p-base shadow-xl sm:p-xl"><div className="flex justify-between gap-4"><h2 className="text-2xl font-extrabold text-secondary">Edit customer</h2><button type="button" onClick={() => setEditing(false)} className="text-sm font-bold text-primary">Close</button></div><div className="mt-xl grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-secondary">Full name<input name="name" defaultValue={profile.customer.name} required className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Phone number<input name="phoneNumber" defaultValue={profile.customer.phoneNumber} required className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Email<input name="email" type="email" defaultValue={profile.customer.email || ''} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary sm:col-span-2">Address<input name="address" defaultValue={profile.customer.address || ''} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label><label className="grid gap-2 text-sm font-bold text-secondary">Status<select name="status" defaultValue={profile.customer.status} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary"><option value="new">New</option><option value="active">Active</option><option value="returning">Returning</option><option value="inactive">Inactive</option></select></label><label className="grid gap-2 text-sm font-bold text-secondary">Tags<input name="tags" defaultValue={profile.tags.join(', ')} className="rounded-xl border border-border bg-background px-3 py-2.5 font-normal outline-none focus:border-primary" /></label></div><div className="mt-xl flex justify-end gap-3"><button type="button" onClick={() => setEditing(false)} className="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-secondary">Cancel</button><button disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"><Save size={16} />{saving ? 'Saving...' : 'Save changes'}</button></div></form></div>}
  </main></WorkspaceLayout>;
}

export default function CustomerProfilePage() {
  return <><Helmet><title>Customer Profile | Clear Connect</title><meta name="description" content="Review a customer history, appointments, messages, and notes." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><CustomerProfileContent /></ProtectedRoute></>;
}
