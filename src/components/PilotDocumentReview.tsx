import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, FileWarning, LoaderCircle, MessageSquareText, Pencil, Trash2, UploadCloud, X } from 'lucide-react';
import { Link } from 'react-router';

type ReviewFact = { id: string; subject: string; predicate: string; value: string; unit: string | null; details: string | null; evidence: string; status: string; matchingFact: { value: string; unit: string | null } | null };
type Review = { document: { id: string; fileName: string; fileType?: string }; summary: { found: number; readyToSave: number; duplicates: number; conflicts: number; warnings: string[] }; groups: Array<{ name: string; facts: ReviewFact[] }> };
type LearnedFact = { id: string; kind: string; subject: string; predicate: string; value: string; unit: string | null; details: string | null; learnedAt: string };
type UploadStatus = 'Ready to upload' | 'Uploading' | 'Reading' | 'Finding information' | 'Ready for review' | 'Could not process';
type SelectedFile = { id: string; file: File; status: UploadStatus; error?: string };

const confirmable = new Set(['pending_review']);
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const xltxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.template';
const accept = '.docx,.pdf,.xlsx,.xltx,.xls,.csv,.tsv,.txt,.md,.markdown,.json,.png,.jpg,.jpeg,.webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.spreadsheetml.template,application/vnd.ms-excel,text/plain,text/csv,text/tab-separated-values,text/markdown,application/json,image/png,image/jpeg,image/webp';
const supportedExtensions = new Set(['docx', 'pdf', 'xlsx', 'xltx', 'xls', 'csv', 'tsv', 'txt', 'md', 'markdown', 'json', 'png', 'jpg', 'jpeg', 'webp']);

function factText(item: { value: string; unit: string | null; details?: string | null }) {
  return `${item.value}${item.unit ? ` ${item.unit}` : ''}${item.details ? ` · ${item.details}` : ''}`;
}

function fileKey(file: File) { return `${file.name}-${file.size}-${file.lastModified}`; }
function fileTypeLabel(file: File) {
  const extension = file.name.split('.').pop()?.toUpperCase();
  return extension || file.type || 'File';
}
function fileTypeForUpload(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'xlsx') return xlsxMimeType;
  if (extension === 'xltx') return xltxMimeType;
  if (extension === 'xls') return 'application/vnd.ms-excel';
  return file.type || 'application/octet-stream';
}
function isSupported(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return supportedExtensions.has(extension);
}

export default function PilotDocumentReview() {
  const labels = { eyebrow: 'Teach Pilot', title: 'Give Pilot the information you already have.', description: 'I’ll organize it and learn your business for you.', uploadDescription: 'Upload documents, spreadsheets, screenshots, photos, PDFs, and other business files.', tellTitle: 'Tell Pilot', tellDescription: 'Tell Pilot something in your own words.', tellAction: 'Tell Pilot', recentTitle: 'Recently learned', recentDescription: 'Confirmed information Pilot can use in future conversations.', recentEmpty: 'No confirmed information yet. Upload a supported file or tell Pilot an important business detail.', reviewTitle: 'Review before saving', reviewDescription: 'Pilot organizes the information it finds. Confirm the facts you want saved, edit them if needed, or reject them.', unsupported: "This file type isn't supported yet. Try one of the supported business file types." };
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [learned, setLearned] = useState<LearnedFact[]>([]);
  const [editing, setEditing] = useState<Record<string, Partial<ReviewFact>>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadLearned() {
    const response = await fetch('/api/pilot-learning', { credentials: 'include' });
    const body = await response.json() as { facts?: LearnedFact[] };
    if (response.ok) setLearned(body.facts ?? []);
  }
  useEffect(() => { void loadLearned(); }, []);

  function addFiles(files: FileList | File[]) {
    setError(''); setNotice(''); setReviews([]); setEditing({}); setRejected([]);
    const incoming = Array.from(files).map((file) => ({ id: fileKey(file), file, status: isSupported(file) ? 'Ready to upload' as const : 'Could not process' as const, error: isSupported(file) ? undefined : labels.unsupported }));
    if (incoming.some((item) => item.error)) setError(labels.unsupported);
    setSelectedFiles((current) => [...current, ...incoming.filter((item) => !current.some((existing) => existing.id === item.id))]);
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) addFiles(event.target.files);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function updateFile(id: string, updates: Partial<SelectedFile>) {
    setSelectedFiles((current) => current.map((item) => item.id === id ? { ...item, ...updates } : item));
  }

  async function readBase64(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Pilot could not read that file.')); reader.readAsDataURL(file); });
    return dataUrl.split(',', 2)[1] ?? '';
  }

  async function reviewFiles() {
    const ready = selectedFiles.filter((item) => item.status === 'Ready to upload');
    if (!ready.length) return;
    setBusy(true); setError(''); setNotice(''); setReviews([]); setEditing({}); setRejected([]);
    const completed: Review[] = [];
    for (const item of ready) {
      try {
        updateFile(item.id, { status: 'Uploading', error: undefined });
        const base64 = await readBase64(item.file);
        updateFile(item.id, { status: 'Reading' });
        updateFile(item.id, { status: 'Finding information' });
        const response = await fetch('/api/pilot-documents', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: item.file.name, fileType: fileTypeForUpload(item.file), sourceReference: item.file.name, base64 }) });
        const body = await response.json() as Review & { error?: string };
        if (!response.ok) throw new Error(body.error || labels.unsupported);
        completed.push(body);
        updateFile(item.id, { status: 'Ready for review' });
      } catch (requestError) {
        updateFile(item.id, { status: 'Could not process', error: requestError instanceof Error ? requestError.message : labels.unsupported });
      }
    }
    setReviews(completed);
    if (completed.length) setNotice(`${completed.length} file${completed.length === 1 ? '' : 's'} ready for review. Nothing has been saved yet.`);
    setBusy(false);
  }

  function changedFact(item: ReviewFact) { return { ...item, ...editing[item.id] }; }
  function toggleRejected(id: string) { setRejected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function updateFact(id: string, field: keyof Pick<ReviewFact, 'subject' | 'predicate' | 'value' | 'unit' | 'details'>, value: string) { setEditing((current) => ({ ...current, [id]: { ...current[id], [field]: value } })); }

  async function saveReviews() {
    if (!reviews.length) return;
    setBusy(true); setError('');
    let saved = 0; let duplicates = 0; let conflicts = 0;
    try {
      for (const review of reviews) {
        const pending = review.groups.flatMap((group) => group.facts.filter((item) => confirmable.has(item.status)));
        const acceptedIds = pending.filter((item) => !rejected.includes(item.id)).map((item) => item.id);
        const edits = pending.filter((item) => editing[item.id]).map((item) => ({ id: item.id, ...editing[item.id] }));
        const response = await fetch(`/api/pilot-documents/${review.document.id}/confirm`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptedIds, rejectedIds: rejected, edits }) });
        const body = await response.json() as { saved?: number; duplicatesSkipped?: number; remainingConflicts?: number; error?: string };
        if (!response.ok) throw new Error(body.error || 'Pilot could not save this review.');
        saved += body.saved ?? 0; duplicates += body.duplicatesSkipped ?? 0; conflicts += body.remainingConflicts ?? 0;
      }
      setNotice(`Saved ${saved} confirmed fact${saved === 1 ? '' : 's'}. ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped.${conflicts ? ` ${conflicts} conflict${conflicts === 1 ? '' : 's'} still need your decision.` : ''}`);
      setReviews([]); setSelectedFiles([]); setEditing({}); setRejected([]); await loadLearned();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Pilot could not save this review.'); }
    finally { setBusy(false); }
  }

  const readyCount = selectedFiles.filter((item) => item.status === 'Ready to upload').length;
  return <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl" aria-labelledby="teach-pilot-title">
    <div><p className="text-sm font-bold text-primary">{labels.eyebrow}</p><h2 id="teach-pilot-title" className="mt-xs text-2xl font-extrabold tracking-tight text-secondary">{labels.title}</h2><p className="mt-sm max-w-2xl text-sm leading-6 text-muted-foreground">{labels.description}</p></div>
    <div className="mt-lg grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.54fr)]">
      <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop} className={`rounded-2xl border-2 border-dashed p-base text-center transition-colors sm:p-xl ${dragging ? 'border-primary bg-accent' : 'border-border bg-muted'}`}>
        <UploadCloud size={28} className="mx-auto text-primary" /><p className="mt-3 text-lg font-extrabold text-secondary">{dragging ? 'Drop files to upload' : 'Drop files here'}</p><p className="mt-1 text-sm text-muted-foreground">or <button type="button" onClick={() => inputRef.current?.click()} className="font-bold text-primary underline underline-offset-4">Choose files</button></p><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{labels.uploadDescription}</p><input ref={inputRef} type="file" accept={accept} multiple className="sr-only" disabled={busy} onChange={chooseFiles} />
      </div>
      <Link to="/assistant" className="rounded-2xl border border-border bg-background p-4 transition-colors hover:border-primary"><span className="flex items-center gap-2 text-sm font-extrabold text-secondary"><MessageSquareText size={17} className="text-primary" />{labels.tellTitle}</span><span className="mt-2 block text-sm leading-5 text-muted-foreground">{labels.tellDescription}</span><span className="mt-3 inline-flex rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold text-secondary">{labels.tellAction}</span></Link>
    </div>
    {selectedFiles.length > 0 && <div className="mt-base rounded-2xl border border-border bg-background p-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-extrabold text-secondary">{selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected</p><button type="button" disabled={busy || readyCount === 0} onClick={() => void reviewFiles()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"><UploadCloud size={16} />Review files</button></div><ul className="mt-3 grid gap-2" aria-label="Selected files">{selectedFiles.map((item) => <li key={item.id} className="flex items-center gap-3 rounded-xl bg-muted px-3 py-3"><FileText size={17} className="shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-secondary">{item.file.name}</p><p className={`mt-0.5 text-xs font-semibold ${item.status === 'Could not process' ? 'text-destructive' : item.status === 'Ready for review' ? 'text-primary' : 'text-muted-foreground'}`}>{fileTypeLabel(item.file)} · {item.status}{item.error ? ` — ${item.error}` : ''}</p></div>{item.status === 'Ready to upload' && <button type="button" onClick={() => setSelectedFiles((current) => current.filter((file) => file.id !== item.id))} className="rounded-lg p-2 text-muted-foreground hover:bg-card hover:text-destructive" aria-label={`Remove ${item.file.name}`}><Trash2 size={16} /></button>}{['Uploading', 'Reading', 'Finding information'].includes(item.status) && <LoaderCircle size={17} className="animate-spin text-primary" />}{item.status === 'Ready for review' && <Check size={17} className="text-primary" />}{item.status === 'Could not process' && <FileWarning size={17} className="text-destructive" />}</li>)}</ul></div>}
    {error && <p role="alert" className="mt-base rounded-xl border border-destructive bg-card p-3 text-sm font-semibold text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-base rounded-xl border border-primary bg-accent p-3 text-sm font-semibold text-secondary">{notice}</p>}
    {reviews.length > 0 && <div className="mt-lg border-t border-border pt-lg"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-extrabold text-secondary">{labels.reviewTitle}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{labels.reviewDescription}</p></div><button type="button" disabled={busy || !reviews.some((review) => review.summary.readyToSave > 0)} onClick={() => void saveReviews()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"><Check size={17} />{busy ? 'Saving…' : 'Save confirmed facts'}</button></div><div className="mt-base grid gap-4">{reviews.map((review) => <article key={review.document.id} className="rounded-2xl border border-border"><div className="border-b border-border bg-muted px-4 py-3"><p className="flex items-center gap-2 text-sm font-extrabold text-secondary"><FileText size={17} className="text-primary" />{review.document.fileName}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{review.summary.found} finding{review.summary.found === 1 ? '' : 's'}: {review.summary.readyToSave} ready to save, {review.summary.duplicates} duplicate{review.summary.duplicates === 1 ? '' : 's'}, and {review.summary.conflicts} conflict{review.summary.conflicts === 1 ? '' : 's'}.</p></div>{review.summary.warnings.map((warning) => <p key={warning} className="mx-4 mt-3 rounded-xl border border-border bg-card p-3 text-sm leading-6 text-muted-foreground">{warning}</p>)}<div className="grid gap-3 p-3">{review.groups.map((group) => <section key={group.name} className="rounded-xl border border-border"><h4 className="border-b border-border px-4 py-3 text-sm font-extrabold text-secondary">{group.name}</h4><div className="grid gap-2 p-3">{group.facts.map((item) => { const editable = confirmable.has(item.status) && !rejected.includes(item.id); const itemValue = changedFact(item); return <div key={item.id} className="rounded-xl bg-muted p-3"><div className="flex items-start justify-between gap-3"><p className="text-sm font-bold text-secondary">{itemValue.subject} <span className="font-normal text-muted-foreground">· {itemValue.predicate}</span></p><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${item.status === 'conflict' ? 'bg-card text-destructive' : item.status === 'duplicate' ? 'bg-card text-muted-foreground' : rejected.includes(item.id) ? 'bg-card text-muted-foreground' : 'bg-accent text-primary'}`}>{rejected.includes(item.id) ? 'rejected' : item.status.replace('_', ' ')}</span></div>{editable ? <details className="mt-2"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-primary"><Pencil size={14} />Edit before saving<ChevronDown size={14} /></summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={itemValue.subject} onChange={(event) => updateFact(item.id, 'subject', event.target.value)} aria-label="Subject" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-secondary" /><input value={itemValue.predicate} onChange={(event) => updateFact(item.id, 'predicate', event.target.value)} aria-label="Field" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-secondary" /><input value={itemValue.value} onChange={(event) => updateFact(item.id, 'value', event.target.value)} aria-label="Value" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-secondary" /><input value={itemValue.unit ?? ''} onChange={(event) => updateFact(item.id, 'unit', event.target.value)} aria-label="Unit" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-secondary" /></div></details> : <p className="mt-1 text-sm text-secondary">{factText(itemValue)}</p>}<p className="mt-2 text-xs leading-5 text-muted-foreground">Source: {item.evidence}</p>{item.matchingFact && <p className="mt-2 text-xs font-semibold text-destructive">Existing value: {factText(item.matchingFact)}. It will not be overwritten.</p>}{confirmable.has(item.status) && <button type="button" onClick={() => toggleRejected(item.id)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-secondary hover:text-primary"><X size={14} />{rejected.includes(item.id) ? 'Restore for review' : 'Reject this finding'}</button>}</div>; })}</div></section>)}</div></article>)}</div></div>}
    <div className="mt-lg border-t border-border pt-lg"><h3 className="text-lg font-extrabold text-secondary">{labels.recentTitle}</h3><p className="mt-1 text-sm text-muted-foreground">{labels.recentDescription}</p>{learned.length ? <div className="mt-base grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{learned.slice(0, 6).map((item) => <article key={item.id} className="rounded-xl border border-border bg-background p-4"><p className="text-sm font-extrabold text-secondary">{item.subject}</p><p className="mt-1 text-sm text-muted-foreground">{item.kind.replace('_', ' ')} · {factText(item)}</p></article>)}</div> : <p className="mt-base rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground">{labels.recentEmpty}</p>}</div>
  </section>;
}
