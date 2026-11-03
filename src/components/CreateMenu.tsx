import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Briefcase, CalendarPlus, ChevronDown, FileText, MessageSquare, Plus, Receipt, TrendingUp, UserPlus, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Each option opens the page that already owns that form (the page reads `?create=` and opens it),
 * so there are no duplicate forms. Messages has no compose form, so it opens the Messages page.
 */
export const createOptions: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: 'New Customer', href: '/customers?create=customer', icon: UserPlus },
  { label: 'New Lead', href: '/leads?create=lead', icon: TrendingUp },
  { label: 'New Job', href: '/jobs?create=job', icon: Briefcase },
  { label: 'New Appointment', href: '/calendar?create=appointment', icon: CalendarPlus },
  { label: 'New Employee', href: '/employees?create=employee', icon: Users },
  { label: 'New Quote', href: '/finance?create=quote', icon: FileText },
  { label: 'New Invoice', href: '/finance?create=invoice', icon: Receipt },
  { label: 'New Message', href: '/messages', icon: MessageSquare },
];

export default function CreateMenu({ foodBusiness = false }: { foodBusiness?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Food businesses have no calendar page; their bookings are orders.
  const options = foodBusiness ? createOptions.filter((option) => option.label !== 'New Appointment').map((option) => (option.label === 'New Job' ? { ...option, label: 'New Order' } : option)) : createOptions;

  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
        <span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden="true" />Create</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Create" className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl">
          {options.map((option) => { const Icon = option.icon; return (
            <Link key={option.label} role="menuitem" to={option.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-accent hover:text-primary focus-visible:bg-accent focus-visible:outline-none">
              <Icon className="h-4 w-4 text-primary" aria-hidden="true" />{option.label}
            </Link>
          ); })}
        </div>
      )}
    </div>
  );
}
