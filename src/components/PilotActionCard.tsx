import { Link } from 'react-router';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { ActionLink, ConfirmationCardData } from '@/lib/pilot-chat-stream';

export type ChatCard = { token: string; tool: string; card: ConfirmationCardData; state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; message?: string; link?: ActionLink };

/** What Pilot intends to do, with Confirm and Cancel. Once answered it becomes a record of what really happened. */
export default function PilotActionCard({ item, onDecision, onNavigate }: { item: ChatCard; onDecision: (decision: 'confirm' | 'cancel') => void; onNavigate?: () => void }) {
  const { card, state } = item;
  const danger = card.tone === 'danger';
  return <section aria-label={card.title} className={`rounded-xl border bg-card p-3 text-sm shadow-sm ${state === 'failed' ? 'border-destructive' : 'border-border'}`}>
    <p className="font-extrabold text-secondary">{card.title}</p>
    <ul className="mt-1.5 grid gap-0.5 text-secondary">{card.lines.map((line) => <li key={line} className="flex gap-1.5"><span aria-hidden="true" className="text-primary">•</span><span>{line}</span></li>)}</ul>
    {state === 'pending' && <div className="mt-3 flex gap-2"><button type="button" onClick={() => onDecision('confirm')} className={`rounded-lg px-3 py-1.5 text-xs font-bold text-primary-foreground ${danger ? 'bg-destructive' : 'bg-primary hover:brightness-110'}`}>{card.confirmLabel}</button><button type="button" onClick={() => onDecision('cancel')} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-secondary hover:border-primary">Cancel</button></div>}
    {state === 'running' && <p role="status" className="mt-3 flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><Loader2 size={13} className="animate-spin" aria-hidden="true" />{card.progressLabel}</p>}
    {state === 'done' && <div className="mt-3 border-t border-border pt-2"><p role="status" className="flex items-start gap-1.5 text-xs font-bold text-primary"><CheckCircle2 size={14} className="mt-px shrink-0" aria-hidden="true" /><span>{item.message || 'Done.'}</span></p>{(item.link ?? card.link) && <Link to={(item.link ?? card.link)!.href} onClick={onNavigate} className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-primary underline">{(item.link ?? card.link)!.label}<ArrowUpRight size={12} aria-hidden="true" /></Link>}</div>}
    {state === 'failed' && <p role="alert" className="mt-3 flex items-start gap-1.5 border-t border-border pt-2 text-xs font-bold text-destructive"><AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /><span>I couldn’t complete that action. {item.message}</span></p>}
    {state === 'cancelled' && <p className="mt-3 flex items-center gap-1.5 border-t border-border pt-2 text-xs font-bold text-muted-foreground"><XCircle size={14} aria-hidden="true" />Cancelled. Nothing was changed.</p>}
  </section>;
}
