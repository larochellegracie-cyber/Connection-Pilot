/**
 * The questions Pilot asks when a business signs up. Shared by the screens and the server, so the server
 * only ever stores answers that are on this list and never trusts text sent from the browser.
 */
export type Option = { id: string; emoji: string; label: string; note?: string };

export const businessTypes: Option[] = [
  { id: 'pool', emoji: '🏊', label: 'Pool & outdoor services' },
  { id: 'cleaning', emoji: '🧹', label: 'Cleaning' },
  { id: 'plumbing', emoji: '🔧', label: 'Plumbing' },
  { id: 'landscaping', emoji: '🌳', label: 'Landscaping' },
  { id: 'home', emoji: '🏠', label: 'Home services' },
  { id: 'food', emoji: '🍰', label: 'Bakery / Food' },
  { id: 'beauty', emoji: '💇', label: 'Beauty & personal services' },
  { id: 'automotive', emoji: '🚗', label: 'Automotive' },
  { id: 'other', emoji: '📦', label: 'Other' },
];

export const customerChannels: Option[] = [
  { id: 'phone', emoji: '📞', label: 'Phone calls' },
  { id: 'text', emoji: '💬', label: 'Text messages' },
  { id: 'website', emoji: '🌐', label: 'Website' },
  { id: 'social', emoji: '📱', label: 'Social media' },
  { id: 'referrals', emoji: '🤝', label: 'Referrals' },
  { id: 'search', emoji: '🔎', label: 'Google / search' },
  { id: 'mix', emoji: '✨', label: 'A little bit of everything' },
];

export const timeConsumers: Option[] = [
  { id: 'scheduling', emoji: '📅', label: 'Scheduling' },
  { id: 'customers', emoji: '💬', label: 'Talking to customers' },
  { id: 'finance', emoji: '🧾', label: 'Quotes & invoices' },
  { id: 'employees', emoji: '👥', label: 'Managing employees' },
  { id: 'marketing', emoji: '📣', label: 'Marketing' },
  { id: 'jobs', emoji: '📋', label: 'Keeping track of jobs' },
  { id: 'organized', emoji: '📦', label: 'Staying organized' },
  { id: 'everything', emoji: '😵', label: 'Honestly... everything' },
];

/** "Answer missed calls" depends on the AI Voice Receptionist, which is not available yet. It is offered only as something the owner expects. */
export const voiceHelpId = 'calls';
export const helpWanted: Option[] = [
  { id: 'schedule', emoji: '', label: 'Schedule my team' },
  { id: 'customers', emoji: '', label: 'Keep track of customers' },
  { id: 'quotes', emoji: '', label: 'Create quotes' },
  { id: 'invoices', emoji: '', label: 'Send invoices' },
  { id: 'followups', emoji: '', label: 'Follow up with customers' },
  { id: 'marketing', emoji: '', label: 'Help with marketing' },
  { id: 'jobs', emoji: '', label: 'Organize my jobs' },
  { id: 'payments', emoji: '', label: 'Keep track of payments' },
  { id: 'attention', emoji: '', label: 'Tell me what needs my attention' },
  { id: voiceHelpId, emoji: '', label: 'Answer missed calls', note: 'Coming soon. Not active yet, so Pilot will note that you want it.' },
];

export const teamSizes: Option[] = [
  { id: 'solo', emoji: '🙋', label: 'Just me' },
  { id: '2-5', emoji: '👥', label: '2–5 people' },
  { id: '6-10', emoji: '👥', label: '6–10 people' },
  { id: '11-25', emoji: '🏢', label: '11–25 people' },
  { id: '26-50', emoji: '🏢', label: '26–50 people' },
  { id: '50+', emoji: '🏭', label: '50+' },
];

export const existingData: Option[] = [
  { id: 'files', emoji: '📁', label: 'Yes, I have files' },
  { id: 'software', emoji: '🔗', label: 'Yes, I use another software' },
  { id: 'fresh', emoji: '🌱', label: 'No, I’m starting fresh' },
];

/** Choices that mean "all of it", so they replace the others instead of sitting beside them. */
export const exclusiveChoices: Record<string, string> = { channels: 'mix', timeConsumers: 'everything' };

export type OnboardingAnswers = {
  businessType: string;
  /** Only used when the type is "Other". */
  otherType: string;
  channels: string[];
  timeConsumers: string[];
  helpWanted: string[];
  teamSize: string;
  existingData: string;
};

export const emptyAnswers: OnboardingAnswers = { businessType: '', otherType: '', channels: [], timeConsumers: [], helpWanted: [], teamSize: '', existingData: '' };

export const labelFor = (options: Option[], id: string) => options.find((option) => option.id === id)?.label ?? '';
