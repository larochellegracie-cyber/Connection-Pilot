import { Helmet } from '@dr.pogodin/react-helmet';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, ReceiptText, WalletCards, Plus } from 'lucide-react';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { finance } from 'virtual:content';

type Customer = { id: string; name: string; phoneNumber: string };
type Job = { id: string; customerId: string; customerName: string; service: string };
type FinanceLineItem = { id?: string; description: string; quantity: string; unitPrice: string; taxRate: string; subtotal?: string; taxAmount?: string; total?: string };
type Estimate = { id: string; customerId: string; customerName: string; jobId: string | null; jobService: string | null; status: string; subtotal: string; taxTotal: string; total: string; lineItems: FinanceLineItem[]; notes: string | null; expiresAt: string | null; createdAt: string };
type Invoice = { id: string; customerId: string; customerName: string; jobId: string | null; jobService: string | null; status: string; paymentStatus: string; subtotal: string; taxTotal: string; total: string; lineItems: FinanceLineItem[]; received: number; balance: number; notes: string | null; dueAt: string | null; createdAt: string };
type Payment = { id: string; customerId: string; customerName: string; invoiceId: string | null; invoiceJobId: string | null; invoiceJobService: string | null; status: string; amount: string; method: string | null; notes: string | null; receivedAt: string | null; createdAt: string };
type JobFile = { id: string; jobId: string; customerId: string; customerName: string; jobService: string; fileName: string; fileUrl: string; fileType: string | null; createdAt: string };
type FinanceData = { estimates: Estimate[]; invoices: Invoice[]; payments: Payment[]; jobFiles: JobFile[]; summary: { estimated: number; invoiced: number; received: number; outstanding: number } };
type Tab = 'estimates' | 'invoices' | 'payments' | 'jobFiles';
type EditableRecord = Estimate | Invoice | Payment | JobFile;
const inputClass = 'h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60';
const textareaClass = 'w-full min-w-0 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-secondary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring';
const labelClass = 'grid gap-1.5 text-[0.8125rem] font-bold text-secondary';
const money = (value: string | number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const localDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';

function isJobFile(record: EditableRecord): record is JobFile { return 'fileName' in record; }
function isPayment(record: EditableRecord): record is Payment { return 'amount' in record; }
function isInvoice(record: EditableRecord): record is Invoice { return 'dueAt' in record; }

function FinanceContent() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tab, setTab] = useState<Tab>('estimates');
  const [modal, setModal] = useState<Tab | null>(null);
  const [editing, setEditing] = useState<EditableRecord | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [lineItems, setLineItems] = useState<FinanceLineItem[]>([]);
  const [clientRequestId, setClientRequestId] = useState('');
  const [sendingQuoteId, setSendingQuoteId] = useState('');
  const [quoteEmailNotice, setQuoteEmailNotice] = useState('');
  const quoteSendInFlight = useRef<string | null>(null);

  async function load() {
    try {
      const [financeResponse, customerResponse, jobResponse] = await Promise.all([fetch('/api/finance', { credentials: 'include' }), fetch('/api/customers', { credentials: 'include' }), fetch('/api/jobs', { credentials: 'include' })]);
      const financePayload = await financeResponse.json() as FinanceData & { error?: string };
      if (!financeResponse.ok) throw new Error(financePayload.error || 'Unable to load finance records.');
      setData(financePayload);
      if (customerResponse.ok) setCustomers((await customerResponse.json() as { customers: Customer[] }).customers);
      if (jobResponse.ok) setJobs((await jobResponse.json() as { jobs: Job[] }).jobs);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load finance records.'); }
  }
  useEffect(() => { void load(); }, []);
  const visibleJobs = useMemo(() => selectedCustomerId ? jobs.filter((job) => job.customerId === selectedCustomerId) : jobs, [jobs, selectedCustomerId]);
  const visibleInvoices = useMemo(() => selectedCustomerId ? (data?.invoices || []).filter((invoice) => invoice.customerId === selectedCustomerId && invoice.status !== 'void' && invoice.paymentStatus !== 'paid') : [], [data?.invoices, selectedCustomerId]);
  const statusOptions = modal === 'estimates' ? ['draft', 'accepted', 'declined', 'expired'] : modal === 'invoices' ? ['draft', 'sent', 'open', 'overdue', 'void'] : ['pending', 'completed', 'refunded'];

  function openNew(next: Tab) { setEditing(null); setSelectedCustomerId(''); setLineItems(next === 'estimates' || next === 'invoices' ? [{ description: '', quantity: '', unitPrice: '', taxRate: '' }] : []); setClientRequestId(crypto.randomUUID()); setModal(next); }
  function openEdit(next: Tab, record: EditableRecord) { setEditing(record); setSelectedCustomerId(record.customerId); setLineItems((next === 'estimates' || next === 'invoices') && !isPayment(record) && !isJobFile(record) ? record.lineItems.map((item) => ({ description: item.description, quantity: String(item.quantity), unitPrice: String(item.unitPrice), taxRate: String(item.taxRate) })) : []); setClientRequestId(''); setModal(next); }
  /** From a payment, jump to its linked invoice: show the Invoices tab with that invoice's details open. */
  function openInvoice(invoiceId: string) {
    const invoiceRecord = data?.invoices.find((item) => item.id === invoiceId);
    if (!invoiceRecord) { setError('That invoice could not be found. Refresh the page and try again.'); return; }
    setError('');
    setTab('invoices');
    openEdit('invoices', invoiceRecord);
  }
  function closeModal() { setModal(null); setEditing(null); setSelectedCustomerId(''); setLineItems([]); setClientRequestId(''); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const financePayload = modal === 'estimates' || modal === 'invoices' ? { ...payload, lineItems } : payload;
      const response = editing ? await fetch(`/api/finance/${modal}/${editing.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(financePayload) }) : await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...financePayload, recordType: modal, clientRequestId }) });
      const responsePayload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(responsePayload.error || finance.messages.saveError);
      closeModal();
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : finance.messages.saveError); } finally { setSaving(false); }
  }
  async function sendQuote(id: string) {
    if (quoteSendInFlight.current) return;
    quoteSendInFlight.current = id;
    setSendingQuoteId(id); setError(''); setQuoteEmailNotice('');
    try {
      const response = await fetch(`/api/finance/estimates/${id}/send`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID() }) });
      const payload = await response.json() as { error?: string; messageId?: string; duplicate?: boolean };
      if (!response.ok) throw new Error(payload.error || 'We could not send this quote email. Please try again.');
      setQuoteEmailNotice(payload.duplicate ? 'This resend was already accepted by the email provider.' : `Quote email accepted by the email provider${payload.messageId ? ` (message ID: ${payload.messageId})` : ''}.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'We could not send this quote email. Please try again.'); } finally { quoteSendInFlight.current = null; setSendingQuoteId(''); }
  }
  async function sendInvoice(id: string) {
    if (quoteSendInFlight.current) return;
    quoteSendInFlight.current = id;
    setSendingQuoteId(id); setError(''); setQuoteEmailNotice('');
    try {
      const response = await fetch(`/api/finance/invoices/${id}/send`, { method: 'POST', credentials: 'include' });
      const payload = await response.json() as { error?: string; sentTo?: string; invoiceNumber?: string };
      if (!response.ok) throw new Error(payload.error || 'We could not send this invoice. Please try again.');
      setQuoteEmailNotice(`Invoice ${payload.invoiceNumber ?? ''} was sent to ${payload.sentTo ?? 'the customer'}.`.replace('  ', ' '));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'We could not send this invoice. Please try again.'); }
    finally { quoteSendInFlight.current = ''; setSendingQuoteId(''); }
  }
  async function remove(recordType: Tab, id: string) {
    if (!window.confirm(finance.messages.deleteConfirm)) return;
    const response = await fetch(`/api/finance/${recordType}/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) { const payload = await response.json() as { error?: string }; setError(payload.error || finance.messages.saveError); return; }
    await load();
  }

  const defaultCustomer = editing?.customerId || '';
  return <WorkspaceLayout><main className="grid gap-xl pb-xxl">
    <section className="flex flex-col justify-between gap-base border-b border-border pb-lg sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-primary">{finance.hero.eyebrow}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{finance.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{finance.hero.description}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => openNew('estimates')} className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-secondary hover:border-primary">{finance.hero.addEstimate}</button><button onClick={() => openNew('invoices')} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-secondary">{finance.hero.addInvoice}</button></div></section>
    {error && <p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-sm font-bold text-destructive">{error}</p>}
    {quoteEmailNotice && <p role="status" className="rounded-xl border border-primary bg-card p-4 text-sm font-bold text-secondary">{quoteEmailNotice}</p>}
    <section aria-label="Finance summary" className="grid grid-cols-2 divide-y divide-border border-y border-border lg:grid-cols-4 lg:divide-x lg:divide-y-0">{[{ label: finance.summary.estimated, value: data?.summary.estimated || 0 }, { label: finance.summary.invoiced, value: data?.summary.invoiced || 0 }, { label: finance.summary.received, value: data?.summary.received || 0 }, { label: finance.summary.outstanding, value: data?.summary.outstanding || 0 }].map((item) => <article key={item.label} className="p-4"><WalletCards className="text-primary" size={18} /><p className="mt-4 text-2xl font-extrabold text-secondary">{money(item.value)}</p><p className="mt-1 text-sm font-bold text-muted-foreground">{item.label}</p></article>)}</section>
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"><div role="group" aria-label="Finance records" className="flex flex-wrap gap-2 border-b border-border p-3">{finance.tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id as Tab)} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === item.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{item.label}</button>)}</div>
      {tab === 'estimates' && <RecordTable rows={data?.estimates || []} tab="estimates" onDelete={(id) => void remove('estimates', id)} onEdit={(row) => openEdit('estimates', row)} onSendQuote={(id) => void sendQuote(id)} sendingQuoteId={sendingQuoteId} />}
      {tab === 'invoices' && <RecordTable rows={data?.invoices || []} tab="invoices" onDelete={(id) => void remove('invoices', id)} onEdit={(row) => openEdit('invoices', row)} onSendInvoice={(id) => void sendInvoice(id)} sendingQuoteId={sendingQuoteId} />}
      {tab === 'payments' && <PaymentTable rows={data?.payments || []} onDelete={(id) => void remove('payments', id)} onEdit={(row) => openEdit('payments', row)} onCreate={() => openNew('payments')} onOpenInvoice={openInvoice} />}
      {tab === 'jobFiles' && <JobFileTable rows={data?.jobFiles || []} onDelete={(id) => void remove('jobFiles', id)} onEdit={(row) => openEdit('jobFiles', row)} onCreate={() => openNew('jobFiles')} />}
    </section>
    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary p-3 sm:p-4"><form onSubmit={submit} className={`max-h-full w-full overflow-x-hidden overflow-y-auto rounded-2xl bg-card p-4 shadow-xl sm:p-6 ${(modal === 'estimates' || modal === 'invoices') ? 'max-w-3xl' : 'max-w-xl'}`}><div className="flex items-start justify-between gap-4 border-b border-border pb-3"><div><h2 className="text-xl font-extrabold tracking-[-0.02em] text-secondary">{editing ? finance.table.open : finance.tabs.find((item) => item.id === modal)?.label}</h2><p className="mt-0.5 text-sm text-muted-foreground">{modal === 'jobFiles' ? finance.empty.jobFiles.description : finance.hero.description}</p></div><button type="button" onClick={closeModal} className="-mr-1 shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-bold text-primary transition-colors hover:bg-accent">Close</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className={labelClass}>{finance.form.customer}<select required disabled={Boolean(editing)} name="customerId" defaultValue={defaultCustomer} onChange={(event) => setSelectedCustomerId(event.target.value)} className={inputClass}><option value="" disabled>Select customer</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.phoneNumber}</option>)}</select></label>
      {modal !== 'payments' && <label className={labelClass}>{finance.form.job}<select name="jobId" defaultValue={editing && !isPayment(editing) && !isJobFile(editing) ? editing.jobId || '' : editing && isJobFile(editing) ? editing.jobId : ''} className={inputClass}><option value="">{finance.messages.noJob}</option>{visibleJobs.map((item) => <option key={item.id} value={item.id}>{item.service} · {item.customerName}</option>)}</select></label>}
      {modal === 'jobFiles' ? <><label className={labelClass}>{finance.form.fileName}<input required name="fileName" defaultValue={editing && isJobFile(editing) ? editing.fileName : ''} className={inputClass} /></label><label className={labelClass}>{finance.form.fileType}<input name="fileType" defaultValue={editing && isJobFile(editing) ? editing.fileType || '' : ''} className={inputClass} /></label>{!editing && <label className={`${labelClass} sm:col-span-2`}>{finance.form.fileUrl}<input required name="fileUrl" className={inputClass} /></label>}</> : <>{modal === 'payments' ? <label className={labelClass}>{finance.form.amount}<input required name="amount" defaultValue={editing && isPayment(editing) ? editing.amount : ''} type="number" min="0.01" step="0.01" className={inputClass} /></label> : <LineItemsEditor items={lineItems} onChange={setLineItems} />}<label className={labelClass}>{finance.form.status}<select name="status" defaultValue={editing && !isJobFile(editing) ? editing.status : modal === 'payments' ? 'completed' : 'draft'} className={`${inputClass} capitalize`}>{statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{modal === 'estimates' && <label className={labelClass}>{finance.form.expiresDate}<input name="expiresAt" type="date" defaultValue={editing && !isJobFile(editing) && !isPayment(editing) && !isInvoice(editing) ? localDate(editing.expiresAt) : ''} className={inputClass} /></label>}{modal === 'invoices' && <label className={labelClass}>{finance.form.dueDate}<input name="dueAt" type="date" defaultValue={editing && isInvoice(editing) ? localDate(editing.dueAt) : ''} className={inputClass} /></label>}{modal === 'payments' && <><label className={labelClass}>Linked invoice<select name="invoiceId" defaultValue={editing && isPayment(editing) ? editing.invoiceId || '' : ''} disabled={!selectedCustomerId || Boolean(editing)} className={inputClass}><option value="">{selectedCustomerId ? 'No linked invoice' : finance.messages.noCustomerInvoice}</option>{visibleInvoices.map((item) => <option key={item.id} value={item.id}>{item.customerName} · {money(item.balance)} owing{item.jobService ? ` · ${item.jobService}` : ''}</option>)}</select></label><label className={labelClass}>{finance.form.method}<select name="method" defaultValue={editing && isPayment(editing) ? editing.method || 'other' : 'cash'} className={inputClass}><option value="cash">Cash</option><option value="card">Card</option><option value="e-transfer">E-transfer</option><option value="other">Other</option></select></label><label className={labelClass}>{finance.form.receivedDate}<input name="receivedAt" type="date" defaultValue={editing && isPayment(editing) ? localDate(editing.receivedAt) : ''} className={inputClass} /></label></>}<label className={`${labelClass} sm:col-span-2`}>{finance.form.notes}<textarea name="notes" defaultValue={editing && !isJobFile(editing) ? editing.notes || '' : ''} rows={2} className={textareaClass} /></label></>}</div><div className="mt-4 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={closeModal} className="h-10 rounded-lg border border-border bg-card px-5 text-sm font-bold text-secondary transition-colors hover:bg-muted">{finance.form.cancel}</button><button disabled={saving} className="h-10 min-w-28 rounded-lg bg-primary px-6 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-secondary disabled:opacity-60">{saving ? 'Saving...' : finance.form.save}</button></div></form></div>}
  </main></WorkspaceLayout>;
}

function LineItemsEditor({ items, onChange }: { items: FinanceLineItem[]; onChange: (items: FinanceLineItem[]) => void }) {
  const update = (index: number, field: keyof FinanceLineItem, value: string) => onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  const lineAmount = (item: FinanceLineItem) => Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0);
  const subtotal = items.reduce((sum, item) => sum + lineAmount(item), 0);
  const tax = items.reduce((sum, item) => { const lineSubtotal = Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unitPrice) || 0); return sum + lineSubtotal * Math.max(0, Number(item.taxRate) || 0) / 100; }, 0);
  // Description | Qty | Rate | Tax % | Amount | Remove. On small screens each line becomes a compact two-column block, so nothing scrolls sideways.
  const columns = 'md:grid-cols-[minmax(0,1fr)_4.25rem_6rem_4.25rem_5.5rem_4.5rem]';
  const cell = 'grid min-w-0 gap-1';
  const smallLabel = 'text-xs font-bold text-muted-foreground md:hidden';
  return <fieldset className="grid gap-2 rounded-lg border border-border bg-muted p-3 sm:col-span-2"><legend className="px-1 text-[0.8125rem] font-bold text-secondary">Line items</legend>
    <div aria-hidden="true" className={`hidden gap-2 px-0.5 text-xs font-bold text-muted-foreground md:grid ${columns}`}><span>Description</span><span>Qty</span><span>Rate</span><span>Tax %</span><span className="text-right">Amount</span><span className="text-right">Remove</span></div>
    <div className="grid gap-2">{items.map((item, index) => <div key={index} className={`grid grid-cols-2 items-end gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0 md:items-center md:border-t-0 md:pt-0 md:first:pt-0 ${columns}`}>
      <label className={`${cell} col-span-2 md:col-span-1`}><span className={smallLabel}>Description</span><input required aria-label={`Line item ${index + 1} description`} value={item.description} onChange={(event) => update(index, 'description', event.target.value)} placeholder="Description" className={inputClass} /></label>
      <label className={cell}><span className={smallLabel}>Qty</span><input required aria-label={`Line item ${index + 1} quantity`} value={item.quantity} onChange={(event) => update(index, 'quantity', event.target.value)} type="number" min="0.01" step="0.01" placeholder="Qty" className={`${inputClass} tabular-nums`} /></label>
      <label className={cell}><span className={smallLabel}>Rate</span><input required aria-label={`Line item ${index + 1} unit price`} value={item.unitPrice} onChange={(event) => update(index, 'unitPrice', event.target.value)} type="number" min="0" step="0.01" placeholder="Rate" className={`${inputClass} tabular-nums`} /></label>
      <label className={cell}><span className={smallLabel}>Tax %</span><input aria-label={`Line item ${index + 1} tax rate`} value={item.taxRate} onChange={(event) => update(index, 'taxRate', event.target.value)} type="number" min="0" max="100" step="0.01" placeholder="Tax %" className={`${inputClass} tabular-nums`} /></label>
      <div className={cell}><span className={`${smallLabel} md:sr-only`}>Amount</span><output aria-label={`Line item ${index + 1} amount`} className="flex h-10 items-center justify-end text-sm font-bold tabular-nums text-secondary">{money(lineAmount(item))}</output></div>
      <button type="button" onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} disabled={items.length === 1} className="col-span-2 h-10 justify-self-end rounded-lg px-2.5 text-sm font-bold text-destructive transition-colors hover:bg-card disabled:opacity-40 disabled:hover:bg-transparent md:col-span-1">Remove</button>
    </div>)}</div>
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-3">
      <button type="button" onClick={() => onChange([...items, { description: '', quantity: '', unitPrice: '', taxRate: '' }])} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-bold text-primary transition-colors hover:border-primary"><Plus size={15} aria-hidden="true" />Add line item</button>
      <dl className="ml-auto grid w-full gap-1 text-sm sm:w-60"><div className="flex justify-between text-muted-foreground"><dt>Subtotal</dt><dd className="font-bold tabular-nums text-secondary">{money(subtotal)}</dd></div><div className="flex justify-between text-muted-foreground"><dt>Tax</dt><dd className="font-bold tabular-nums text-secondary">{money(tax)}</dd></div><div className="flex justify-between border-t border-border pt-1.5 text-base font-extrabold text-secondary"><dt>Total</dt><dd className="tabular-nums">{money(subtotal + tax)}</dd></div></dl>
    </div>
  </fieldset>;
}

function RecordTable({ rows, tab, onDelete, onEdit, onSendQuote, onSendInvoice, sendingQuoteId }: { rows: Array<Estimate | Invoice>; tab: 'estimates' | 'invoices'; onDelete: (id: string) => void; onEdit: (row: Estimate | Invoice) => void; onSendQuote?: (id: string) => void; onSendInvoice?: (id: string) => void; sendingQuoteId?: string }) { return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="bg-muted"><tr>{[finance.table.record, finance.table.customer, finance.table.job, finance.table.amount, finance.table.balance, finance.table.status, finance.table.date, finance.table.action].map((item) => <th key={item} className="px-4 py-3 text-xs font-bold text-muted-foreground">{item}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row) => { const invoiceRecord = tab === 'invoices' ? row as Invoice : null; return <tr key={row.id} className="border-t border-border"><td className="p-4 font-bold text-secondary">{tab === 'invoices' ? 'Invoice' : 'Quote'}</td><td className="p-4 text-sm text-secondary">{row.customerName}</td><td className="p-4 text-sm text-muted-foreground">{row.jobService || finance.messages.noJob}</td><td className="p-4 font-bold text-secondary">{money(row.total)}</td><td className="p-4 text-sm font-bold text-secondary">{invoiceRecord ? money(invoiceRecord.balance) : '—'}</td><td className="p-4"><span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-primary">{invoiceRecord ? invoiceRecord.paymentStatus.replace('_', ' ') : row.status}</span></td><td className="p-4 text-sm text-muted-foreground">{date('dueAt' in row ? row.dueAt : row.expiresAt)}</td><td className="p-4">{tab === 'estimates' && onSendQuote && <button disabled={sendingQuoteId === row.id} onClick={() => onSendQuote(row.id)} className="mr-4 text-sm font-bold text-primary disabled:opacity-60">{sendingQuoteId === row.id ? 'Sending…' : row.status === 'sent' ? 'Resend quote' : 'Send quote'}</button>}{tab === 'invoices' && onSendInvoice && row.status !== 'void' && <button disabled={sendingQuoteId === row.id} onClick={() => onSendInvoice(row.id)} className="mr-4 text-sm font-bold text-primary disabled:opacity-60">{sendingQuoteId === row.id ? 'Sending…' : row.status === 'draft' ? 'Send invoice' : 'Resend invoice'}</button>}<button onClick={() => onEdit(row)} className="mr-4 text-sm font-bold text-primary">{finance.table.open}</button><button onClick={() => onDelete(row.id)} className="text-sm font-bold text-destructive">{finance.table.delete}</button></td></tr>; }) : <tr><td colSpan={8} className="p-10 text-center"><ReceiptText className="mx-auto text-primary" size={26} /><p className="mt-3 font-bold text-secondary">{tab === 'estimates' ? finance.empty.estimates.title : finance.empty.invoices.title}</p><p className="mt-1 text-sm text-muted-foreground">{tab === 'estimates' ? finance.empty.estimates.description : finance.empty.invoices.description}</p></td></tr>}</tbody></table></div>; }
function PaymentTable({ rows, onDelete, onEdit, onCreate, onOpenInvoice }: { rows: Payment[]; onDelete: (id: string) => void; onEdit: (row: Payment) => void; onCreate: () => void; onOpenInvoice: (invoiceId: string) => void }) { return <div className="overflow-x-auto"><div className="flex justify-end border-b border-border p-3"><button onClick={onCreate} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">{finance.hero.recordPayment}</button></div><table className="w-full min-w-[760px] text-left"><thead className="bg-muted"><tr>{[finance.table.customer, finance.table.job, finance.table.amount, finance.form.method, finance.table.status, finance.table.date, finance.table.action].map((item) => <th key={item} className="px-4 py-3 text-xs font-bold text-muted-foreground">{item}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="p-4 text-sm font-bold text-secondary">{row.customerName}</td><td className="p-4 text-sm text-muted-foreground">{row.invoiceId ? <button type="button" onClick={() => onOpenInvoice(row.invoiceId as string)} aria-label={`Open invoice${row.invoiceJobService ? ` for ${row.invoiceJobService}` : ''}`} title="Open this invoice" className="text-left font-bold text-primary underline-offset-2 hover:underline">{row.invoiceJobService || 'Linked invoice'}</button> : finance.messages.noJob}</td><td className="p-4 text-sm font-bold text-secondary">{money(row.amount)}</td><td className="p-4 text-sm text-secondary">{row.method || 'Other'}</td><td className="p-4 text-sm text-primary">{row.status}</td><td className="p-4 text-sm text-muted-foreground">{date(row.receivedAt || row.createdAt)}</td><td className="p-4"><button onClick={() => onEdit(row)} className="mr-4 text-sm font-bold text-primary">{finance.table.open}</button><button onClick={() => onDelete(row.id)} className="text-sm font-bold text-destructive">{finance.table.delete}</button></td></tr>) : <tr><td colSpan={7} className="p-10 text-center"><ReceiptText className="mx-auto text-primary" size={26} /><p className="mt-3 font-bold text-secondary">{finance.empty.payments.title}</p><p className="mt-1 text-sm text-muted-foreground">{finance.empty.payments.description}</p></td></tr>}</tbody></table></div>; }
function JobFileTable({ rows, onDelete, onEdit, onCreate }: { rows: JobFile[]; onDelete: (id: string) => void; onEdit: (row: JobFile) => void; onCreate: () => void }) { return <div className="overflow-x-auto"><div className="flex justify-end border-b border-border p-3"><button onClick={onCreate} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"><FilePlus2 size={16} />{finance.hero.addFile}</button></div><table className="w-full min-w-[680px] text-left"><thead className="bg-muted"><tr>{[finance.table.record, finance.table.customer, finance.table.job, finance.table.date, finance.table.action].map((item) => <th key={item} className="px-4 py-3 text-xs font-bold text-muted-foreground">{item}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="p-4 text-sm font-bold text-secondary">{row.fileName}</td><td className="p-4 text-sm text-secondary">{row.customerName}</td><td className="p-4 text-sm text-muted-foreground">{row.jobService}</td><td className="p-4 text-sm text-muted-foreground">{date(row.createdAt)}</td><td className="p-4"><a href={row.fileUrl} target="_blank" rel="noreferrer" className="mr-4 text-sm font-bold text-primary">{finance.table.download}</a><button onClick={() => onEdit(row)} className="mr-4 text-sm font-bold text-primary">{finance.table.open}</button><button onClick={() => onDelete(row.id)} className="text-sm font-bold text-destructive">{finance.table.delete}</button></td></tr>) : <tr><td colSpan={7} className="p-10 text-center"><ReceiptText className="mx-auto text-primary" size={26} /><p className="mt-3 font-bold text-secondary">{finance.empty.jobFiles.title}</p><p className="mt-1 text-sm text-muted-foreground">{finance.empty.jobFiles.description}</p></td></tr>}</tbody></table></div>; }
function EmptyState({ title, description }: { title: string; description: string }) { return <tr><td colSpan={7} className="p-10 text-center"><ReceiptText className="mx-auto text-primary" size={26} /><p className="mt-3 font-bold text-secondary">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></td></tr>; }
export default function FinancePage() { return <><Helmet><title>{finance.seo.title}</title><meta name="description" content={finance.seo.description} /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><FinanceContent /></ProtectedRoute></>; }
