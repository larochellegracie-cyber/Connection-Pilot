/** What the owner sees before an action runs: a short title, what will change, and the button wording. */
export type ConfirmationCard = {
  title: string;
  lines: string[];
  confirmLabel: string;
  /** Shown only while the action is really running. */
  progressLabel: string;
  link?: { label: string; href: string };
  /** Destructive actions get a more serious button. */
  tone?: 'normal' | 'danger';
};

export function card(title: string, lines: string[], confirmLabel: string, progressLabel: string, link?: { label: string; href: string }, tone: 'normal' | 'danger' = 'normal'): ConfirmationCard {
  return { title, lines: lines.filter(Boolean), confirmLabel, progressLabel, ...(link && { link }), ...(tone === 'danger' && { tone }) };
}
