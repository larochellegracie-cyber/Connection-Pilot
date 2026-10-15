export type PilotChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
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
