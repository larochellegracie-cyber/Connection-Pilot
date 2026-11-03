export type PilotChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Links to the records Pilot looked at. */
  links?: Array<{ label: string; href: string }>;
  /** Actions Pilot prepared for the owner to confirm, and what became of them. */
  cards?: Array<{ token: string; tool: string; card: { title: string; lines: string[]; confirmLabel: string; progressLabel: string; link?: { label: string; href: string }; tone?: 'normal' | 'danger' }; state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; message?: string; link?: { label: string; href: string } }>;
};

const storageKey = 'connection-pilot-chat';
const eventName = 'connection-pilot-chat-change';

export function readPilotChatMessages(): PilotChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || '[]') as PilotChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePilotChatMessages(messages: PilotChatMessage[]) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-16)));
  window.dispatchEvent(new Event(eventName));
}

export function subscribeToPilotChat(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}
