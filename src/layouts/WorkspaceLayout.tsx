import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { BarChart3, BellRing, CalendarDays, CircleHelp, LayoutDashboard, MessageSquare, Megaphone, PlugZap, PhoneCall, ReceiptText, Settings, TrendingUp, UserRound, Users } from 'lucide-react';
import Dashboard from '@/layouts/Dashboard';
import TrialStatusBanner from '@/components/TrialStatusBanner';
import { LogoutButton, useSession } from '@/lib/auth/auth-client';
import { isFoodBusiness } from '@/lib/business-workflow';

type BusinessProfileResponse = {
  profile: {
    businessName: string;
    businessType: string;
  };
};

type SubscriptionResponse = {
  subscription?: {
    features: string[];
  };
};

function initials(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'CP';
}

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useSession();
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [planFeatures, setPlanFeatures] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/business-profile', { credentials: 'include' });
      if (!response.ok) return;
      const payload = await response.json() as BusinessProfileResponse;
      setBusinessName(payload.profile.businessName);
      setBusinessType(payload.profile.businessType);
      const subscriptionResponse = await fetch('/api/subscription', { credentials: 'include' });
      if (subscriptionResponse.ok) {
        const subscriptionPayload = await subscriptionResponse.json() as SubscriptionResponse;
        setPlanFeatures(subscriptionPayload.subscription?.features ?? []);
      }
    })();
  }, []);

  const displayName = businessName || user?.name || 'Your business';
  const foodBusiness = isFoodBusiness(businessType);
  const isDashboard = location.pathname === '/dashboard';
  const workspaceArea = location.pathname === '/business-profile' ? 'business-knowledge' : location.pathname.startsWith('/dashboard/customers/') ? 'customers' : location.pathname === '/dashboard/ai-receptionist' ? 'ai-receptionist' : location.pathname === '/dashboard/booking-rules' ? 'booking-rules' : location.pathname === '/dashboard/help' ? 'help' : location.pathname === '/dashboard' ? 'dashboard' : location.pathname.split('/').filter(Boolean)[0] || 'dashboard';
  const navigation = useMemo(() => [
    { title: 'Home', href: '/dashboard', icon: LayoutDashboard, active: isDashboard && !location.hash },
    { title: 'Customers', href: '/customers', icon: Users, active: location.pathname === '/customers' || location.pathname.startsWith('/dashboard/customers/') },
    { title: 'Leads', href: '/leads', icon: TrendingUp, active: location.pathname === '/leads' },
    { title: foodBusiness ? 'Orders' : 'Jobs', href: '/jobs', icon: BarChart3, active: location.pathname === '/jobs' },
    { title: 'Scheduling', href: '/scheduling', icon: CalendarDays, active: location.pathname === '/scheduling' },
    { title: 'Employees', href: '/employees', icon: Users, active: location.pathname === '/employees' },
    ...(!foodBusiness ? [{ title: 'Calendar', href: '/calendar', icon: CalendarDays, active: location.pathname === '/calendar' }] : []),
    { title: 'Quotes & invoices', href: '/finance', icon: ReceiptText, active: location.pathname === '/finance' },
    ...(planFeatures.includes('connections') ? [{ title: 'Connections', href: '/connections', icon: PlugZap, active: location.pathname === '/connections' }] : []),
    { title: 'Messages', href: '/messages', icon: MessageSquare, active: location.pathname === '/messages' },
    { title: 'Marketing', href: '/marketing', icon: Megaphone, active: location.pathname === '/marketing' },
    { title: 'Notifications', href: '/notifications', icon: BellRing, active: location.pathname === '/notifications' },
    { title: 'AI Voice Receptionist · Coming Soon', href: '/dashboard/ai-receptionist', icon: PhoneCall, active: location.pathname === '/dashboard/ai-receptionist' },
    ...(planFeatures.includes('basic_insights') ? [{ title: 'Insights', href: '/insights', icon: BarChart3, active: location.pathname === '/insights' }] : []),
  ], [foodBusiness, isDashboard, location.hash, location.pathname, planFeatures]);

  const secondaryNavigation = useMemo(() => [
    { title: 'Business information', href: '/business-profile', icon: UserRound },
    { title: 'Settings', href: '/settings', icon: Settings },
    { title: 'Help', href: '/dashboard/help', icon: CircleHelp },
  ], []);

  return (
    <Dashboard
      className={`workspace-page workspace-page--${workspaceArea} bg-[hsl(var(--canvas))]`}
      config={{
        sidebar: {
          logo: { image: '/airo-assets/images/logo/horizontal/dark', text: 'Connection Pilot', href: '/dashboard' },
          navigation: { main: navigation, secondary: secondaryNavigation },
          theme: 'dark',
          footer: (
            <div className="grid gap-3">
              <div>
                <p className="text-xs font-bold text-primary-foreground">Business workspace</p>
                <p className="mt-1 truncate text-sm font-semibold text-secondary-foreground">{displayName}</p>
              </div>
              <LogoutButton className="rounded-lg border border-primary bg-secondary px-3 py-2 text-left text-sm font-bold text-secondary-foreground hover:bg-primary" />
            </div>
          ),
        },
        header: {
          search: { enabled: false },
          notifications: { enabled: false },
          user: { name: displayName, email: user?.email || '', initials: initials(displayName) },
          userMenu: <><div className="my-1 border-t border-border" /><Link to="/profile" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserRound className="h-4 w-4" />Profile</Link><Link to="/settings" className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Settings className="h-4 w-4" />Settings</Link><Link to="/dashboard/help" className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-secondary transition-colors hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CircleHelp className="h-4 w-4" />Help</Link><div className="my-1 border-t border-border" /><LogoutButton className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold text-destructive transition-colors hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Log out</LogoutButton></>,
          className: 'border-border bg-background',
        },
        main: { maxWidth: '2xl', padding: true, className: 'bg-[hsl(var(--canvas))]' },
      }}
    >
      <TrialStatusBanner />
      {children}
    </Dashboard>
  );
}
