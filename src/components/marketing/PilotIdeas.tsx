import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import type { Idea } from '@/server/marketing/generate';
import { api, Notice, primaryButton, secondaryButton, type WorkspaceData } from './shared';

const firstSentence = (value: string) => (value.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? value).trim();

/**
 * A simple feed of what Pilot thinks the business should post, from the business, the season, upcoming holidays, what was
 * already posted, and current trends when Pilot has found some. "Make it" sends the idea straight to Create.
 */
export default function PilotIdeas({ data, onMake, onGoToBusiness }: { data: WorkspaceData; onMake: (idea: Idea) => void; onGoToBusiness: () => void }) {
  const canWrite = data.setup.ai && data.hasRealData;
  const [ideas, setIdeas] = useState<Idea[] | null>(data.ideas?.ideas ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function load(refresh: boolean) {
    setLoading(true); setError('');
    const result = await api<{ ideas: Idea[] }>('/api/marketing/ideas', 'POST', { refresh });
    if (!alive.current) return;
    setLoading(false);
    if (!result.ok) { setError(result.data.error || 'Pilot couldn’t come up with ideas just now. Please try again.'); return; }
    setIdeas(result.data.ideas);
  }
  // Pilot comes up with ideas on its own the first time the owner looks
  useEffect(() => { if (!ideas && canWrite) void load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return <div className="grid gap-5">
    {!data.setup.ai && <Notice tone="warn">Pilot isn’t ready to create things yet. Please contact support.</Notice>}
    {data.setup.ai && !data.hasRealData && <Notice>Pilot needs to know a little about <strong>{data.business.name}</strong> first. <button type="button" onClick={onGoToBusiness} className="font-bold text-primary underline">Open Business information</button></Notice>}
    {error && <Notice tone="warn">{error}</Notice>}
    {loading && !ideas && <p role="status" className="cp-card flex items-center gap-3 px-6 py-10 text-lg font-bold text-muted-foreground"><Loader2 size={20} className="animate-spin" aria-hidden="true" />Pilot is thinking about what you should post…</p>}

    {ideas && <ul className="grid gap-4 md:grid-cols-2">{ideas.map((idea) => <li key={idea.id} className="cp-card grid content-between gap-4 p-6">
      <div className="grid gap-2"><h3 className="text-xl font-extrabold leading-snug tracking-[-0.02em] text-secondary">{idea.title}</h3><p className="text-sm text-muted-foreground">{firstSentence(idea.why)}</p></div>
      <button type="button" disabled={!canWrite} onClick={() => onMake(idea)} className={`${primaryButton} w-fit`}>Make it</button>
    </li>)}</ul>}

    {ideas && <div><button type="button" disabled={loading || !canWrite} onClick={() => void load(true)} className={secondaryButton}>{loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Show me new ideas</button></div>}
  </div>;
}
