/** The structured chat stream: reply text with small JSON records (progress, links, confirmation cards) between \u001e marks. */
const RECORD = '\u001e';

export type ActionLink = { label: string; href: string };
export type ConfirmationCardData = { title: string; lines: string[]; confirmLabel: string; progressLabel: string; link?: ActionLink; tone?: 'normal' | 'danger' };
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; label: string }
  | { type: 'links'; links: ActionLink[] }
  | { type: 'card'; token: string; tool: string; card: ConfirmationCardData }
  | { type: 'error'; message: string };

/** Feed it chunks as they arrive; it calls back with whole events, even when a record is split across chunks. */
export function createStreamParser(onEvent: (event: StreamEvent) => void) {
  let buffer = '';
  let inRecord = false;
  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf(RECORD);
        if (index < 0) break;
        const part = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (inRecord) { try { onEvent(JSON.parse(part) as StreamEvent); } catch { /* a damaged record is skipped */ } inRecord = false; }
        else { if (part) onEvent({ type: 'text', text: part }); inRecord = true; }
      }
      if (!inRecord && buffer) { onEvent({ type: 'text', text: buffer }); buffer = ''; }
    },
  };
}
