import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import type { ImportKind, ImportResult, ParsedSheet, Plan, PlanItem, RecordChoice, SheetDecision, SheetKind, SheetSuggestion } from '@/server/import/types';

type Step = 'upload' | 'found' | 'review' | 'confirm' | 'done';
type UploadState = { id: number; name: string; status: 'uploading' | 'done' | 'error'; progress: number; message?: string };
type AnalyzeResponse = { sheets?: ParsedSheet[]; suggestions?: SheetSuggestion[]; error?: string };

const kinds: Array<{ kind: ImportKind; emoji: string; singular: string; plural: string; fields: Array<[string, string]> }> = [
  { kind: 'customers', emoji: '👥', singular: 'customer', plural: 'customers', fields: [['name', 'Name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['phone', 'Phone'], ['email', 'Email'], ['address', 'Address'], ['company', 'Company']] },
  { kind: 'invoices', emoji: '🧾', singular: 'invoice', plural: 'invoices', fields: [['number', 'Invoice number'], ['customerName', 'Customer name'], ['customerEmail', 'Customer email'], ['customerPhone', 'Customer phone'], ['date', 'Date'], ['due', 'Due date'], ['subtotal', 'Subtotal'], ['tax', 'Tax'], ['total', 'Total'], ['status', 'Status'], ['description', 'Description']] },
  { kind: 'quotes', emoji: '📋', singular: 'quote', plural: 'quotes', fields: [['number', 'Quote number'], ['customerName', 'Customer name'], ['customerEmail', 'Customer email'], ['customerPhone', 'Customer phone'], ['date', 'Date'], ['expires', 'Expiry date'], ['subtotal', 'Subtotal'], ['tax', 'Tax'], ['total', 'Total'], ['status', 'Status'], ['description', 'Description']] },
  { kind: 'jobs', emoji: '💼', singular: 'job', plural: 'jobs', fields: [['customerName', 'Customer name'], ['customerEmail', 'Customer email'], ['customerPhone', 'Customer phone'], ['service', 'Service / job'], ['address', 'Address'], ['employee', 'Assigned employee'], ['date', 'Date'], ['duration', 'Duration (minutes)'], ['status', 'Status']] },
  { kind: 'employees', emoji: '👤', singular: 'employee', plural: 'employees', fields: [['name', 'Name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['role', 'Role'], ['email', 'Email'], ['phone', 'Phone'], ['status', 'Status']] },
  { kind: 'services', emoji: '🛠️', singular: 'service', plural: 'services', fields: [['name', 'Service or product'], ['price', 'Price'], ['unit', 'Per (unit)'], ['details', 'Details']] },
];
const meta = (kind: ImportKind) => kinds.find((entry) => entry.kind === kind)!;
const noun = (kind: ImportKind, count: number) => (count === 1 ? meta(kind).singular : meta(kind).plural);
const choiceLabel = (choice: RecordChoice, type: 'existing' | 'file') => choice === 'skip' ? (type === 'existing' ? 'Keep existing' : 'Skip') : choice === 'update' ? 'Update existing' : choice === 'create' ? (type === 'existing' ? 'Create new' : 'Keep both') : 'Merge';
const acceptedTypes = '.xlsx,.xls,.xltx,.csv,.tsv';
const acceptedExtensions = ['.xlsx', '.xls', '.xltx', '.csv', '.tsv'];
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60';
const primary = `${button} bg-primary text-primary-foreground hover:brightness-110`;
const secondary = `${button} border border-border bg-card text-secondary hover:border-primary hover:text-primary`;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function postWithProgress(url: string, body: unknown, onProgress: (fraction: number) => void): Promise<{ status: number; body: AnalyzeResponse }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', 'application/json');
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    request.onload = () => { try { resolve({ status: request.status, body: JSON.parse(request.responseText) as AnalyzeResponse }); } catch { reject(new Error('Pilot sent back something unexpected.')); } };
    request.onerror = () => reject(new Error('The upload could not reach Pilot. Check your connection and try again.'));
    request.send(JSON.stringify(body));
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Something went wrong.');
  return payload;
}

/** The one Pilot import workflow, used during onboarding and from Business information. */
export default function PilotImport({ onFinished, onCancel, finishLabel = 'Go to my dashboard' }: { onFinished?: () => void; onCancel?: () => void; finishLabel?: string }) {
  const [step, setStep] = useState<Step>('upload');
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [suggestions, setSuggestions] = useState<Record<string, SheetSuggestion>>({});
  const [decisions, setDecisions] = useState<Record<string, SheetDecision>>({});
  const [recordChoices, setRecordChoices] = useState<Record<string, RecordChoice>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [tab, setTab] = useState<ImportKind>('customers');
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const nextId = useRef(1);
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const decisionList = useMemo(() => Object.values(decisions), [decisions]);

  // The preview always reflects the files and the owner's current choices. Nothing is saved here.
  useEffect(() => {
    if (step === 'upload' || step === 'done' || !sheets.length) return;
    const requestId = ++latest.current;
    setPlanLoading(true);
    const timer = setTimeout(() => {
      void postJson<{ plan: Plan }>('/api/import/preview', { sheets, decisions: decisionList, recordChoices }).then((payload) => {
        if (requestId !== latest.current) return;
        setPlan(payload.plan); setPlanError('');
      }).catch((previewError) => { if (requestId === latest.current) setPlanError(previewError instanceof Error ? previewError.message : 'Pilot could not prepare the preview.'); })
        .finally(() => { if (requestId === latest.current) setPlanLoading(false); });
    }, 250);
    return () => clearTimeout(timer);
  }, [step, sheets, decisionList, recordChoices]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    for (const file of Array.from(list)) {
      const id = nextId.current++;
      const update = (change: Partial<UploadState>) => setUploads((current) => current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
      setUploads((current) => [...current, { id, name: file.name, status: 'uploading', progress: 0 }]);
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!acceptedExtensions.includes(extension)) { update({ status: 'error', message: 'Pilot can import Excel (.xlsx, .xls, .xltx), CSV and TSV files here. For documents, PDFs and images, use Business information instead.' }); continue; }
      if (file.size > 5 * 1024 * 1024) { update({ status: 'error', message: 'This file is larger than 5 MB. Split it into smaller files and try again.' }); continue; }
      try {
        const base64 = await readBase64(file);
        const response = await postWithProgress('/api/import/analyze', { fileName: file.name, fileType: file.type, base64 }, (fraction) => update({ progress: Math.round(fraction * 100) }));
        if (response.status >= 400 || !response.body.sheets) { update({ status: 'error', message: response.body.error || 'Pilot could not read this file.' }); continue; }
        const found = response.body.sheets; const hints = response.body.suggestions ?? [];
        setSheets((current) => [...current.filter((sheet) => !found.some((added) => added.id === sheet.id)), ...found]);
        setSuggestions((current) => ({ ...current, ...Object.fromEntries(hints.map((hint) => [hint.id, hint])) }));
        setDecisions((current) => ({ ...current, ...Object.fromEntries(hints.map((hint) => [hint.id, hint.confidence === 'high' && hint.kind !== 'schedule' && hint.kind !== 'unknown' ? { id: hint.id, kind: hint.kind, mapping: hint.mappings[hint.kind] ?? {} } : { id: hint.id, kind: 'ignore' as const, mapping: {} }])) }));
        update({ status: 'done', progress: 100, message: `${found.length} ${found.length === 1 ? 'sheet' : 'sheets'} read` });
      } catch (uploadError) { update({ status: 'error', message: uploadError instanceof Error ? uploadError.message : 'The upload failed.' }); }
    }
  }, []);

  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files); }
  function startOver() { setStep('upload'); setUploads([]); setSheets([]); setSuggestions({}); setDecisions({}); setRecordChoices({}); setPlan(null); setResult(null); setError(''); setShowIssues(false); }
  function setSheetKind(sheetId: string, kind: ImportKind | 'ignore') {
    const hint = suggestions[sheetId];
    setDecisions((current) => ({ ...current, [sheetId]: { id: sheetId, kind, mapping: kind === 'ignore' ? {} : hint?.mappings[kind] ?? {} } }));
  }
  function setColumn(sheetId: string, column: number, field: string) {
    setDecisions((current) => { const existing = current[sheetId]; if (!existing) return current; const mapping = { ...existing.mapping }; if (field === 'ignore') delete mapping[String(column)]; else mapping[String(column)] = field; return { ...current, [sheetId]: { ...existing, mapping } }; });
  }

  async function runImport() {
    setImporting(true); setError('');
    try {
      const payload = await postJson<{ result: ImportResult }>('/api/import/commit', { sheets, decisions: decisionList, recordChoices, confirmed: true });
      setResult(payload.result); setStep('done');
    } catch (importError) { setError(importError instanceof Error ? importError.message : 'The import could not be finished.'); }
    finally { setImporting(false); }
  }

  const doneUploads = uploads.filter((entry) => entry.status === 'done').length;
  const present = kinds.filter((entry) => plan && plan.categories[entry.kind].found > 0);
  const scheduleSheets = sheets.filter((sheet) => suggestions[sheet.id]?.kind === 'schedule' && decisions[sheet.id]?.kind === 'ignore');
  const unsureSheets = sheets.filter((sheet) => suggestions[sheet.id]?.confidence === 'unsure' && suggestions[sheet.id]?.kind !== 'schedule');
  const importable = plan ? plan.willCreate + plan.willUpdate : 0;

  const sheetPicker = (sheet: ParsedSheet) => <label key={sheet.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted p-3 text-sm">
    <span><span className="font-bold text-secondary">{sheet.fileName}</span> · {sheet.sheetName} <span className="text-muted-foreground">({sheet.rows.length} rows; columns: {sheet.headers.slice(0, 6).join(', ')}{sheet.headers.length > 6 ? '…' : ''})</span></span>
    <select aria-label={`What is in ${sheet.sheetName}`} value={decisions[sheet.id]?.kind ?? 'ignore'} onChange={(event) => setSheetKind(sheet.id, event.target.value as ImportKind | 'ignore')} className="rounded-lg border border-border bg-card px-3 py-2 font-semibold text-secondary">
      <option value="ignore">Don’t import this sheet</option>
      {kinds.map((entry) => <option key={entry.kind} value={entry.kind}>{entry.emoji} {entry.plural[0].toUpperCase() + entry.plural.slice(1)}</option>)}
    </select>
  </label>;

  const header = (title: string, subtitle?: string) => <div className="mb-5"><h2 className="text-2xl font-extrabold tracking-[-0.03em] text-secondary">{title}</h2>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>;
  const errorBox = error && <p role="alert" className="mt-4 rounded-xl border border-destructive bg-card p-3 text-sm font-bold text-destructive">{error}</p>;

  if (step === 'upload') return <section aria-label="Pilot import" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    {header('Upload what you already have', 'Pilot reads your spreadsheets and organizes them. Nothing is added until you review it and confirm.')}
    <div onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? 'border-primary bg-accent' : 'border-border bg-muted'}`}>
      <UploadCloud className="mx-auto text-primary" size={32} aria-hidden="true" />
      <p className="mt-2 font-bold text-secondary">Drag and drop your files here</p>
      <p className="text-sm text-muted-foreground">or</p>
      <button type="button" onClick={() => input.current?.click()} className={`${secondary} mt-2`}>Browse files</button>
      <input ref={input} type="file" multiple accept={acceptedTypes} aria-label="Choose files to import" className="sr-only" onChange={(event) => { if (event.target.files?.length) void addFiles(event.target.files); event.target.value = ''; }} />
      <p className="mt-3 text-xs text-muted-foreground">Excel (.xlsx, .xls, .xltx), CSV and TSV files, up to 5 MB each. Customer lists, employee lists, invoices, quotes, jobs and price lists.</p>
    </div>
    {uploads.length > 0 && <ul className="mt-4 grid gap-2" aria-label="Uploaded files">{uploads.map((entry) => <li key={entry.id} className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-3 text-sm"><FileSpreadsheet size={18} className="shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate font-semibold text-secondary">{entry.name}</span>
        {entry.status === 'uploading' && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 size={14} className="animate-spin" aria-hidden="true" />{entry.progress < 100 ? `${entry.progress}%` : 'Reading…'}</span>}
        {entry.status === 'done' && <span className="flex items-center gap-1 font-bold text-primary"><CheckCircle2 size={14} aria-hidden="true" />{entry.message}</span>}
        {entry.status === 'error' && <span className="flex items-center gap-1 font-bold text-destructive"><AlertTriangle size={14} aria-hidden="true" />Not read</span>}</div>
      {entry.status === 'uploading' && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={entry.progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-primary transition-all" style={{ width: `${entry.progress}%` }} /></div>}
      {entry.status === 'error' && <p role="alert" className="mt-1 text-sm text-destructive">{entry.message}</p>}
    </li>)}</ul>}
    <div className="mt-6 flex flex-wrap gap-3"><button type="button" disabled={!doneUploads || uploads.some((entry) => entry.status === 'uploading')} onClick={() => setStep('found')} className={primary}><Sparkles size={16} aria-hidden="true" />See what Pilot found</button>{onCancel && <button type="button" onClick={onCancel} className={secondary}>Cancel</button>}</div>
  </section>;

  if (step === 'found') return <section aria-label="Pilot import" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    {header('Here’s what Pilot found', planLoading && !plan ? 'Pilot is organizing your files…' : undefined)}
    {planError && <p role="alert" className="rounded-xl border border-destructive p-3 text-sm font-bold text-destructive">{planError}</p>}
    {plan && present.length > 0 && <ul className="grid gap-2 sm:grid-cols-2" aria-label="What Pilot found">{present.map((entry) => <li key={entry.kind} className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3"><span className="font-bold text-secondary"><span aria-hidden="true">{entry.emoji}</span> {noun(entry.kind, plan.categories[entry.kind].found)[0].toUpperCase() + noun(entry.kind, plan.categories[entry.kind].found).slice(1)}</span><span className="text-xl font-extrabold tabular-nums text-primary">{plan.categories[entry.kind].found}</span></li>)}</ul>}
    {plan && present.length === 0 && !planLoading && <p className="rounded-xl bg-muted p-4 text-sm text-secondary">Pilot couldn’t tell what these files contain yet. Choose what each sheet is below and Pilot will organize it.</p>}
    {scheduleSheets.length > 0 && <p className="mt-4 rounded-xl border border-border bg-accent p-3 text-sm text-secondary">Pilot also found what looks like a weekly staff schedule in {scheduleSheets.map((sheet) => `${sheet.fileName} (${sheet.sheetName})`).join(', ')}. Schedules aren’t imported here. Use Scheduling → Let Pilot Build It to bring shifts in.</p>}
    {unsureSheets.length > 0 && <div className="mt-5"><h3 className="font-extrabold text-secondary">Pilot isn’t sure about {unsureSheets.length === 1 ? 'this sheet' : 'these sheets'}</h3><p className="mb-2 text-sm text-muted-foreground">Tell Pilot what it contains rather than letting it guess.</p><div className="grid gap-2">{unsureSheets.map(sheetPicker)}</div></div>}
    {plan && present.length > 0 && <p className="mt-5 font-bold text-secondary">Pilot is ready to organize this information.</p>}
    <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={!plan || present.length === 0} onClick={() => { setTab(present[0].kind); setStep('review'); }} className={primary}>Review &amp; Import</button><button type="button" onClick={startOver} className={secondary}>Start Over</button></div>
  </section>;

  if (step === 'review' && plan) {
    const category = plan.categories[tab]; const info = meta(tab);
    const mySheets = sheets.filter((sheet) => decisions[sheet.id]?.kind === tab);
    const columns = category.sample[0] ? Object.keys(category.sample[0].display) : [];
    const needsChoice = (item: PlanItem) => item.duplicate;
    return <section aria-label="Pilot import" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      {header('Review before importing', 'Look through each category. Pilot only asks about things it is unsure of.')}
      <div role="tablist" className="mb-5 flex flex-wrap gap-2">{present.map((entry) => <button key={entry.kind} role="tab" aria-selected={tab === entry.kind} type="button" onClick={() => setTab(entry.kind)} className={`rounded-lg px-3 py-2 text-sm font-bold ${tab === entry.kind ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-secondary'}`}>{entry.emoji} {entry.plural[0].toUpperCase() + entry.plural.slice(1)} · {plan.categories[entry.kind].found}</button>)}</div>
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-secondary">{info.plural}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{category.found} {noun(tab, category.found)} found</p>
      {mySheets.map((sheet) => { const decision = decisions[sheet.id]; const unmapped = sheet.headers.map((name, index) => ({ name, index })).filter(({ index }) => !decision?.mapping[String(index)]); return <div key={sheet.id} className="mt-4 grid gap-2">{sheetPicker(sheet)}
        {unmapped.map(({ name, index }) => <label key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-accent p-3 text-sm"><span className="text-secondary">I found a column called <strong>“{name}”</strong> but I’m not sure what it means.</span>
          <select aria-label={`What is ${name}`} value="ignore" onChange={(event) => setColumn(sheet.id, index, event.target.value)} className="rounded-lg border border-border bg-card px-3 py-2 font-semibold text-secondary"><option value="ignore">Ignore this column</option><option value="notes">Add it to notes</option>{info.fields.map(([key, label]) => <option key={key} value={key}>Use as {label.toLowerCase()}</option>)}</select></label>)}</div>; })}
      {category.sample.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-muted"><tr>{columns.map((column) => <th key={column} className="px-3 py-2 font-bold text-secondary">{column}</th>)}</tr></thead><tbody>{category.sample.map((item) => <tr key={item.key} className="border-t border-border">{columns.map((column) => <td key={column} className="px-3 py-2 text-secondary">{item.display[column] || '—'}</td>)}</tr>)}</tbody></table><p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Showing {category.sample.length} of {category.willCreate + category.willUpdate} ready to import.</p></div>}
      {category.notes.map((note) => <p key={note} className="mt-3 rounded-xl bg-muted p-3 text-sm text-secondary">{note}</p>)}
      {category.attention.length > 0 && <div className="mt-5"><h4 className="font-extrabold text-secondary">{category.needsAttention} {category.needsAttention === 1 ? 'record needs' : 'records need'} your attention</h4>
        <ul className="mt-2 grid gap-2">{category.attention.map((item) => <li key={item.key} className="rounded-xl border border-border p-3 text-sm">
          <p className="font-bold text-secondary">{item.label} <span className="font-normal text-muted-foreground">· {item.fileName}, row {item.row}</span></p>
          {item.issues.map((issue) => <p key={issue} className="text-muted-foreground">{issue}</p>)}
          {item.reason && !item.duplicate && !item.issues.includes(item.reason) && <p className="text-muted-foreground">{item.reason}</p>}
          {needsChoice(item) && item.duplicate && <div className="mt-2 flex flex-wrap items-center gap-2"><span className="font-semibold text-primary">{item.duplicate.description}</span><select aria-label={`What to do with ${item.label}`} value={item.duplicate.choice} onChange={(event) => setRecordChoices((current) => ({ ...current, [item.key]: event.target.value as RecordChoice }))} className="rounded-lg border border-border bg-card px-3 py-1.5 font-semibold text-secondary">{item.duplicate.options.map((option) => <option key={option} value={option}>{choiceLabel(option, item.duplicate!.type)}</option>)}</select></div>}
        </li>)}</ul>{category.needsAttention > category.attention.length && <p className="mt-2 text-xs text-muted-foreground">Showing the first {category.attention.length}.</p>}</div>}
      <p className="mt-5 font-bold text-secondary">{category.willCreate} {noun(tab, category.willCreate)} {category.willCreate === 1 ? 'is' : 'are'} ready to import{category.willUpdate ? `, and ${category.willUpdate} will be updated` : ''}.</p>
      {planLoading && <p className="mt-1 text-xs text-muted-foreground">Updating…</p>}
      {planError && <p role="alert" className="mt-2 text-sm font-bold text-destructive">{planError}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={() => setStep('found')} className={secondary}>Back</button><button type="button" disabled={planLoading} onClick={() => setStep('confirm')} className={primary}>Continue</button></div>
    </section>;
  }

  if (step === 'confirm' && plan) return <section aria-label="Pilot import" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    {header('Ready to import')}
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="What will be imported">{kinds.filter((entry) => plan.categories[entry.kind].willCreate + plan.categories[entry.kind].willUpdate > 0).map((entry) => { const row = plan.categories[entry.kind]; return <li key={entry.kind} className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3"><span className="font-bold text-secondary"><span aria-hidden="true">{entry.emoji}</span> {entry.plural[0].toUpperCase() + entry.plural.slice(1)}{row.willUpdate ? <span className="font-normal text-muted-foreground"> ({row.willUpdate} updated)</span> : null}</span><span className="text-xl font-extrabold tabular-nums text-primary">{row.willCreate + row.willUpdate}</span></li>; })}</ul>
    {importable === 0 && <p className="mt-4 rounded-xl bg-muted p-3 text-sm text-secondary">There is nothing to import yet. Go back and check the records that need your attention.</p>}
    <p className="mt-5 font-bold text-secondary">Nothing will be added until you confirm.</p>
    {errorBox}
    <div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={importing || importable === 0 || planLoading} onClick={() => void runImport()} className={primary}>{importing ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Importing…</> : 'Import everything'}</button><button type="button" disabled={importing} onClick={() => setStep('review')} className={secondary}>Go back</button></div>
  </section>;

  if (step === 'done' && result) {
    const lines = kinds.filter((entry) => result.imported[entry.kind] > 0 || result.updated[entry.kind] > 0);
    const attention = result.issues.length + result.failed.length;
    return <section aria-label="Pilot import" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
      {header(lines.length ? 'You’re all set! 🎉' : 'Nothing was imported', lines.length ? 'Pilot organized your business information.' : 'Pilot did not add anything. See below for why.')}
      {lines.length > 0 && <ul className="grid gap-2" aria-label="Import results">{lines.map((entry) => <li key={entry.kind} className="flex items-center gap-2 text-secondary"><CheckCircle2 size={18} className="text-primary" aria-hidden="true" /><span><strong>{result.imported[entry.kind]}</strong> {noun(entry.kind, result.imported[entry.kind])} imported{result.updated[entry.kind] ? <>, <strong>{result.updated[entry.kind]}</strong> updated</> : null}</span></li>)}</ul>}
      {result.failed.map((failure) => <p key={failure.kind} role="alert" className="mt-3 rounded-xl border border-destructive p-3 text-sm font-bold text-destructive">The {meta(failure.kind).plural} could not be saved, so none of them were added: {failure.message}</p>)}
      {attention > 0 && <div className="mt-5"><p className="font-bold text-secondary">{result.issues.length} {result.issues.length === 1 ? 'record needs' : 'records need'} your attention.</p><button type="button" onClick={() => setShowIssues((value) => !value)} className={`${secondary} mt-2`}>{showIssues ? 'Hide issues' : 'Review issues'}</button>
        {showIssues && <ul className="mt-3 grid gap-2">{result.issues.map((issue, index) => <li key={index} className="rounded-xl border border-border p-3 text-sm"><p className="font-bold text-secondary">{issue.label} <span className="font-normal text-muted-foreground">· {issue.fileName}, row {issue.row}</span></p><p className="text-muted-foreground">{issue.reason}</p></li>)}</ul>}</div>}
      <div className="mt-6 flex flex-wrap gap-3">{onFinished && <button type="button" onClick={onFinished} className={primary}>{finishLabel}</button>}<button type="button" onClick={startOver} className={secondary}>Import more</button></div>
    </section>;
  }
  return <section aria-label="Pilot import" className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Loading…</p></section>;
}
export type { SheetKind };
