import { ChevronDown, Send, Sparkles, X } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import PilotAvatar from '@/components/PilotAvatar';
import { useSession } from '@/lib/auth/auth-client';
import { readPilotChatMessages, savePilotChatMessages, type PilotChatMessage } from '@/lib/pilot-chat-session';

type ChatMessage = PilotChatMessage;

const welcomeMessage: ChatMessage = { id: 'pilot-welcome', role: 'assistant', content: 'Hi! How can I help?' };

function readMessages(): ChatMessage[] {
  const stored = readPilotChatMessages();
  return stored.length ? stored : [welcomeMessage];
}

export default function PilotChatWidget() {
  const { isAuthenticated, isPending } = useSession();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(readMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, open]);
  useEffect(() => { savePilotChatMessages(messages); }, [messages]);

  if (isPending || !isAuthenticated) return null;

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text };
    const assistantId = `pilot-${Date.now()}`;
    setMessages((current) => [...current, userMessage, { id: assistantId, role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const history = [...messages, userMessage].slice(-12).map(({ role, content }) => ({ role, content }));
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
        const reference = failure?.requestId ? ` Reference: ${failure.requestId}.` : '';
        throw new Error(`${failure?.error || 'Pilot could not complete that request.'}${reference}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedResponse = false;
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        const textChunk = decoder.decode(chunk.value, { stream: true });
        if (textChunk) receivedResponse = true;
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + textChunk } : message));
      }
      if (!receivedResponse) {
        const reference = response.headers.get('X-Request-Id');
        throw new Error(`Pilot could not complete that request. Please try again.${reference ? ` Reference: ${reference}.` : ''}`);
      }
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(requestError instanceof Error ? requestError.message : 'Pilot could not complete that request.');
    } finally {
      setLoading(false);
    }
  }

  return <div className="fixed bottom-4 right-4 z-[70] sm:bottom-6 sm:right-6">
    {open && <section className="mb-3 flex h-[min(650px,calc(100vh-100px))] w-[calc(100vw-32px)] max-w-[390px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl sm:w-[390px]" aria-label="Pilot live chat">
      <header className="flex items-center justify-between border-b border-border bg-muted p-4">
        <div className="flex items-center gap-3"><PilotAvatar size="md" state={loading ? 'thinking' : 'idle'} /><div><h2 className="text-sm font-extrabold text-secondary">Pilot</h2><p className="text-xs text-muted-foreground">Your AI business assistant</p></div></div>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-card hover:text-secondary" aria-label="Minimize Pilot chat"><ChevronDown size={19} /></button>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap gap-2"><Link to="/calendar" onClick={() => setOpen(false)} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold text-secondary hover:bg-muted">Calendar</Link><Link to="/customers" onClick={() => setOpen(false)} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold text-secondary hover:bg-muted">Customers</Link><Link to="/messages" onClick={() => setOpen(false)} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-bold text-secondary hover:bg-muted">Messages</Link></div>
        <div className="grid gap-3">{messages.map((message) => message.content ? <div key={message.id} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>{message.role === 'assistant' && <PilotAvatar size="sm" state={loading && message.id === messages[messages.length - 1].id ? 'thinking' : 'idle'} />}<p className={`max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-2.5 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-muted text-secondary'}`}>{message.content}</p></div> : null)}{loading && !messages[messages.length - 1]?.content && <div className="flex items-center gap-2 text-sm text-muted-foreground"><PilotAvatar size="sm" state="thinking" /><span>Pilot is checking your business data…</span></div>}<div ref={bottomRef} /></div>
      </div>
      <form onSubmit={sendMessage} className="border-t border-border bg-background p-3"><div className="flex items-end gap-2"><label className="sr-only" htmlFor="pilot-chat-input">Message Pilot</label><textarea id="pilot-chat-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask Pilot anything…" rows={1} disabled={loading} className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:bg-muted" /><button type="submit" disabled={loading || !input.trim()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform hover:bg-secondary disabled:opacity-50" aria-label="Send message"><Send size={17} /></button></div>{error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}</form>
    </section>}
    <button type="button" onClick={() => setOpen((current) => { if (!current) setMessages(readMessages()); return !current; })} className={`relative flex h-14 w-14 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? '' : 'pilot-chat-attention'}`} aria-label={open ? 'Close Pilot chat' : 'Open Pilot chat'} aria-expanded={open}><PilotAvatar size="lg" state={open ? 'speaking' : 'idle'} />{!open && <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><Sparkles size={9} /></span>}{open && <X className="pointer-events-none absolute text-secondary" size={16} />}</button>
  </div>;
}
