import { FormEvent, useState } from 'react';
import { Helmet } from '@dr.pogodin/react-helmet';
import { CalendarDays, MessageSquareText, Send, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Link } from 'react-router';
import { ContentListContext } from '@airo/content';
import { ProtectedRoute } from '@/lib/auth/auth-client';
import PilotAvatar from '@/components/PilotAvatar';
import WorkspaceLayout from '@/layouts/WorkspaceLayout';
import { assistant } from 'virtual:content';

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

const capabilityIcons = {
  users: Users,
  calendar: CalendarDays,
  messages: MessageSquareText,
  shield: ShieldCheck,
} as const;

function AssistantWorkspaceContent() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function askPilot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || loading) return;

    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: prompt };
    const pilotMessageId = `pilot-${Date.now()}`;
    const history = [...messages, userMessage].map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, userMessage, { id: pilotMessageId, role: 'assistant', content: '' }]);
    setQuestion('');
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/chat', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }) });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null) as { error?: string; requestId?: string } | null;
        const reference = failure?.requestId ? ` Reference: ${failure.requestId}.` : '';
        throw new Error(`${failure?.error || 'Pilot is unavailable right now. Please try again.'}${reference}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedResponse = false;
      for (let result = await reader.read(); !result.done; result = await reader.read()) {
        const chunk = decoder.decode(result.value, { stream: true });
        if (chunk) receivedResponse = true;
        setMessages((current) => current.map((message) => message.id === pilotMessageId ? { ...message, content: message.content + chunk } : message));
      }
      if (!receivedResponse) {
        const reference = response.headers.get('X-Request-Id');
        throw new Error(`Pilot could not complete that request. Please try again.${reference ? ` Reference: ${reference}.` : ''}`);
      }
    } catch (requestError) {
      setMessages((current) => current.filter((message) => message.id !== pilotMessageId));
      setError(requestError instanceof Error ? requestError.message : 'Pilot is unavailable right now. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function startPrompt(prompt: string) {
    setQuestion(prompt);
    setError('');
  }

  return <WorkspaceLayout><main className="grid gap-xl">
    <section className="grid gap-base border-b border-border pb-lg lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div className="flex items-start gap-4"><PilotAvatar size="lg" state="idle" /><div><p className="text-sm font-bold text-primary">{assistant.hero.eyebrow}</p><h1 className="mt-xs text-4xl font-extrabold tracking-[-0.045em] text-secondary">{assistant.hero.title}</h1><p className="mt-sm max-w-2xl text-muted-foreground">{assistant.hero.description}</p></div></div>
      <Link to="/dashboard/ai-receptionist" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-secondary shadow-sm transition-colors hover:border-primary hover:text-primary"><Sparkles size={17} />{assistant.receptionist.training}</Link>
    </section>

    <section className="overflow-hidden rounded-3xl bg-secondary shadow-xl">
      <div className="grid gap-base p-base lg:grid-cols-[minmax(0,1fr)_320px] lg:p-xl">
        <div className="flex flex-col justify-between gap-lg">
          <div className="flex items-center gap-3"><PilotAvatar size="md" state={loading ? 'thinking' : 'idle'} className="border-card" /><div><p className="text-lg font-extrabold text-primary-foreground">{assistant.chat.greeting}</p><p className="mt-1 text-sm text-secondary-foreground">{assistant.chat.subgreeting}</p></div></div>
          <ContentListContext field="quickActions.actions"><div className="flex flex-wrap gap-2">{assistant.quickActions.actions.map((action) => <button type="button" key={action.id} onClick={() => startPrompt(action.prompt)} className="rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-bold text-secondary transition-colors hover:border-primary hover:text-primary">{action.label}</button>)}</div></ContentListContext>
        </div>
        <div className="rounded-2xl bg-card p-4 shadow-sm"><h2 className="text-lg font-extrabold text-secondary">{assistant.chat.title}</h2><p className="mt-1 text-sm text-muted-foreground">{assistant.chat.description}</p><form onSubmit={askPilot} className="mt-4 flex gap-2"><label className="sr-only" htmlFor="assistant-question">{assistant.chat.title}</label><input id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={assistant.chat.placeholder} disabled={loading} className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed" /><button type="submit" disabled={loading || !question.trim()} className="inline-flex items-center justify-center rounded-xl bg-primary px-3 text-primary-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" aria-label={assistant.chat.send}><Send size={17} /></button></form></div>
      </div>
    </section>

    <section aria-live="polite" className="rounded-3xl border border-border bg-card shadow-sm"><div className="max-h-[30rem] min-h-56 overflow-y-auto p-base"><div className="grid gap-4">{messages.length ? messages.map((message) => <div key={message.id} className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>{message.role === 'assistant' && <PilotAvatar size="sm" state={loading && !message.content ? 'thinking' : 'speaking'} />}{message.content ? <p className={message.role === 'user' ? 'max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground' : 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm leading-6 text-secondary'}>{message.content}</p> : <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm font-semibold text-primary"><PilotAvatar size="sm" state="thinking" />{assistant.chat.thinking}</div>}</div>) : <div className="flex h-full min-h-44 flex-col items-center justify-center text-center"><PilotAvatar size="lg" state="idle" /><p className="mt-base text-lg font-extrabold text-secondary">{assistant.chat.greeting}</p><p className="mt-xs max-w-md text-sm text-muted-foreground">{assistant.chat.subgreeting}</p><ContentListContext field="chat.suggestions"><div className="mt-base flex flex-wrap justify-center gap-2">{assistant.chat.suggestions.map((suggestion) => <button type="button" key={suggestion.id} onClick={() => startPrompt(suggestion.prompt)} className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs font-semibold text-secondary transition-colors hover:border-primary hover:text-primary">{suggestion.prompt}</button>)}</div></ContentListContext></div>}</div></div>{error && <p role="alert" className="border-t border-border px-base py-3 text-sm font-semibold text-destructive">{error}</p>}</section>


    <section><div><p className="text-sm font-bold text-primary">{assistant.quickActions.title}</p><h2 className="mt-xs text-2xl font-extrabold tracking-tight text-secondary">{assistant.capabilities.title}</h2></div><ContentListContext field="capabilities.items"><div className="mt-base grid grid-cols-1 gap-base md:grid-cols-2 xl:grid-cols-4">{assistant.capabilities.items.map((item) => { const Icon = capabilityIcons[item.icon as keyof typeof capabilityIcons]; return <article key={item.id} className="rounded-2xl border border-border bg-card p-base shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><Icon size={19} /></span><h3 className="mt-base font-extrabold text-secondary">{item.title}</h3><p className="mt-sm text-sm leading-6 text-muted-foreground">{item.description}</p></article>; })}</div></ContentListContext></section>

    <section className="rounded-3xl border border-border bg-card p-base shadow-sm sm:p-xl"><div className="grid gap-base lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"><PilotAvatar size="lg" state="idle" /><div><p className="text-sm font-bold text-primary">{assistant.receptionist.eyebrow}</p><h2 className="mt-xs text-2xl font-extrabold tracking-tight text-secondary">{assistant.receptionist.title}</h2><p className="mt-sm max-w-2xl text-sm leading-6 text-muted-foreground">{assistant.receptionist.description}</p></div><Link to="/dashboard/ai-receptionist" className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-secondary">{assistant.receptionist.action}</Link></div></section>
  </main></WorkspaceLayout>;
}

export default function AssistantPage() {
  return <><Helmet><title>Your AI Assistant | Connection Pilot</title><meta name="description" content="Talk to Pilot, your Connection Pilot AI business assistant." /><meta name="robots" content="noindex, nofollow" /></Helmet><ProtectedRoute><AssistantWorkspaceContent /></ProtectedRoute></>;
}
