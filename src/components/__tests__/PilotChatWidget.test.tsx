import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ useSession: () => ({ isAuthenticated: true, isPending: false }) }));

import PilotChatWidget from '../PilotChatWidget';

const RS = '\u001e';
const record = (value: unknown) => `${RS}${JSON.stringify(value)}${RS}`;
const card = { title: 'Email invoice to Cooper Bulmer', lines: ['INV-11111111: Weekly pool cleaning', 'Total: $450.00', 'Sent to: cooper@example.com'], confirmLabel: 'Send invoice', progressLabel: 'Sending the invoice…', link: { label: 'Open invoices', href: '/finance' } };

let confirmBodies: Array<Record<string, unknown>>;
let chatBodies: Array<Record<string, any>>;
let confirmReply: { status: number; body: Record<string, unknown> };
let stream: { controller: ReadableStreamDefaultController<Uint8Array> } | null;
const encoder = new TextEncoder();

beforeEach(() => {
  window.sessionStorage.clear(); confirmBodies = []; chatBodies = []; stream = null;
  confirmReply = { status: 200, body: { ok: true, message: 'Invoice INV-11111111 was emailed to cooper@example.com.', link: { label: 'Open invoices', href: '/finance' } } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/chat') {
      chatBodies.push(JSON.parse(String(init?.body)));
      const body = new ReadableStream<Uint8Array>({ start(controller) { stream = { controller }; } });
      return new Response(body, { status: 200 });
    }
    if (url === '/api/chat/confirm') { confirmBodies.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify(confirmReply.body), { status: confirmReply.status }); }
    return new Response('{}', { status: 404 });
  }));
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

async function ask(text = 'Send Cooper his invoice') {
  render(<MemoryRouter><PilotChatWidget /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Open Pilot chat' }));
  fireEvent.change(screen.getByLabelText('Message Pilot'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(stream).not.toBeNull());
}
const push = (text: string) => stream!.controller.enqueue(encoder.encode(text));

describe('Pilot chat taking actions', () => {
  it('asks the server for the structured stream', async () => {
    await ask();
    expect(chatBodies[0].structured).toBe(true);
    stream!.controller.close();
  });

  it('shows what Pilot is really doing while a tool runs, then clears it', async () => {
    await ask();
    push(record({ type: 'status', label: 'Looking up Cooper’s invoice…' }));
    expect(await screen.findByText('Looking up Cooper’s invoice…')).toBeTruthy();
    push(record({ type: 'status', label: '' }) + 'Here you go.');
    await waitFor(() => expect(screen.queryByText('Looking up Cooper’s invoice…')).toBeNull());
    stream!.controller.close();
    expect(await screen.findByText('Here you go.')).toBeTruthy();
  });

  it('shows a confirmation card with Confirm and Cancel, and nothing is sent until Confirm is pressed', async () => {
    await ask();
    push(record({ type: 'card', token: 'tok-1', tool: 'sendInvoice', card }) + 'I found his $450 invoice. Confirm below to send it.');
    stream!.controller.close();
    const section = await screen.findByRole('region', { name: 'Email invoice to Cooper Bulmer' });
    expect(within(section).getByText('Total: $450.00')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Send invoice' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(confirmBodies).toEqual([]);
  });

  it('runs the action on Confirm, shows progress while it runs, then the real result with a link', async () => {
    let release: () => void = () => undefined;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/chat') { chatBodies.push(JSON.parse(String(init?.body))); return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = { controller }; } }), { status: 200 }); }
      confirmBodies.push(JSON.parse(String(init?.body)));
      await new Promise<void>((resolve) => { release = resolve; });
      return new Response(JSON.stringify(confirmReply.body), { status: confirmReply.status });
    });
    await ask();
    push(record({ type: 'card', token: 'tok-1', tool: 'sendInvoice', card })); stream!.controller.close();
    fireEvent.click(await screen.findByRole('button', { name: 'Send invoice' }));
    expect(await screen.findByText('Sending the invoice…')).toBeTruthy();
    expect(confirmBodies).toEqual([{ token: 'tok-1', decision: 'confirm' }]);
    release();
    expect(await screen.findByText('Invoice INV-11111111 was emailed to cooper@example.com.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send invoice' })).toBeNull();
    expect(screen.getByRole('link', { name: /Open invoices/ }).getAttribute('href')).toBe('/finance');
  });

  it('does nothing when cancelled, and says so', async () => {
    await ask();
    push(record({ type: 'card', token: 'tok-2', tool: 'sendInvoice', card })); stream!.controller.close();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Cancelled. Nothing was changed.')).toBeTruthy();
    expect(confirmBodies).toEqual([{ token: 'tok-2', decision: 'cancel' }]);
  });

  it('shows a failure honestly, with the real reason', async () => {
    confirmReply = { status: 422, body: { ok: false, message: 'The invoice was NOT sent. Email sending isn’t configured yet, so nothing was sent.' } };
    await ask();
    push(record({ type: 'card', token: 'tok-3', tool: 'sendInvoice', card })); stream!.controller.close();
    fireEvent.click(await screen.findByRole('button', { name: 'Send invoice' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('I couldn’t complete that action.');
    expect(alert.textContent).toContain('Email sending isn’t configured yet, so nothing was sent.');
  });

  it('does not claim success if the connection drops while confirming', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/chat') { chatBodies.push(JSON.parse(String(init?.body))); return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = { controller }; } }), { status: 200 }); }
      throw new Error('network down');
    });
    await ask();
    push(record({ type: 'card', token: 'tok-4', tool: 'sendInvoice', card })); stream!.controller.close();
    fireEvent.click(await screen.findByRole('button', { name: 'Send invoice' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/can’t tell whether it went through/);
  });

  it('links to the records Pilot looked at, and tells Pilot how earlier actions turned out', async () => {
    await ask('Show me Cooper');
    push(record({ type: 'links', links: [{ label: 'Open Cooper Bulmer', href: '/dashboard/customers/c1' }] }) + 'Cooper is a repeat customer.');
    stream!.controller.close();
    expect((await screen.findByRole('link', { name: /Open Cooper Bulmer/ })).getAttribute('href')).toBe('/dashboard/customers/c1');
  });

  it('puts the outcome of a confirmed action into the next message so Pilot knows what really happened', async () => {
    await ask();
    push(record({ type: 'card', token: 'tok-5', tool: 'sendInvoice', card }) + 'Ready when you are.'); stream!.controller.close();
    fireEvent.click(await screen.findByRole('button', { name: 'Send invoice' }));
    await screen.findByText('Invoice INV-11111111 was emailed to cooper@example.com.');
    stream = null;
    fireEvent.change(screen.getByLabelText('Message Pilot'), { target: { value: 'Thanks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(chatBodies).toHaveLength(2));
    const history = chatBodies[1].messages as Array<{ role: string; content: string }>;
    expect(history.find((message) => message.content.includes('Ready when you are.'))?.content).toContain('Action result for “Email invoice to Cooper Bulmer”: done. Invoice INV-11111111 was emailed');
    stream!.controller.close();
  });
});
