import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import FinancePage from '../finance';

const json = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });
const invoice = (id: string, service: string) => ({
  id, customerId: 'cust-1', customerName: 'Jordan Rivera', jobId: null, jobService: service, status: 'sent', paymentStatus: 'partly_paid',
  subtotal: '100', taxTotal: '0', total: '100', received: 40, balance: 60, notes: null, dueAt: null, createdAt: '2026-10-01T00:00:00.000Z',
  lineItems: [{ description: `${service} line`, quantity: 1, unitPrice: 100, taxRate: 0 }],
});
const payment = (id: string, invoiceId: string | null, service: string | null) => ({
  id, customerId: 'cust-1', customerName: 'Jordan Rivera', invoiceId, invoiceJobId: null, invoiceJobService: service,
  status: 'received', amount: '40', method: 'Cash', notes: null, receivedAt: '2026-10-02T00:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z',
});

describe('Finance: payments link to their invoice', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/finance') return json({
        estimates: [], jobFiles: [],
        invoices: [invoice('inv-1', 'Pool cleaning'), invoice('inv-2', 'Pool opening')],
        payments: [payment('pay-1', 'inv-2', 'Pool opening'), payment('pay-2', null, null)],
        summary: { estimated: 0, invoiced: 200, received: 80, outstanding: 120 },
      });
      if (url === '/api/customers') return json({ customers: [{ id: 'cust-1', name: 'Jordan Rivera', phoneNumber: '+15555550100' }] });
      if (url === '/api/jobs') return json({ jobs: [] });
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the linked invoice, and the right one, when it is clicked', async () => {
    render(<HelmetProvider><MemoryRouter><FinancePage /></MemoryRouter></HelmetProvider>);
    const paymentsTab = (await screen.findAllByRole('button')).find((button) => button.textContent === 'Payments');
    fireEvent.click(paymentsTab as HTMLElement);

    fireEvent.click(await screen.findByRole('button', { name: 'Open invoice for Pool opening' }));

    await waitFor(() => expect(screen.getByDisplayValue('Pool opening line')).toBeTruthy());
    expect(screen.queryByDisplayValue('Pool cleaning line')).toBeNull();
  });

  it('shows no link for a payment that has no invoice', async () => {
    render(<HelmetProvider><MemoryRouter><FinancePage /></MemoryRouter></HelmetProvider>);
    const paymentsTab = (await screen.findAllByRole('button')).find((button) => button.textContent === 'Payments');
    fireEvent.click(paymentsTab as HTMLElement);
    await screen.findByRole('button', { name: 'Open invoice for Pool opening' });
    expect(screen.getAllByRole('button', { name: /^Open invoice/ })).toHaveLength(1);
  });
});

describe('Finance: sending an invoice', () => {
  const sent: string[] = [];
  function stubFinance(sendResponse: () => Response) {
    sent.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url.startsWith('/api/finance/invoices/')) { sent.push(url); return sendResponse(); }
      if (url === '/api/finance') return json({ estimates: [], jobFiles: [], payments: [], invoices: [invoice('inv-1', 'Pool cleaning'), { ...invoice('inv-2', 'Pool opening'), status: 'void' }], summary: { estimated: 0, invoiced: 100, received: 0, outstanding: 100 } });
      if (url === '/api/customers') return json({ customers: [] });
      if (url === '/api/jobs') return json({ jobs: [] });
      return new Response('{}', { status: 404 });
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  async function openInvoicesTab() {
    render(<HelmetProvider><MemoryRouter><FinancePage /></MemoryRouter></HelmetProvider>);
    const tab = (await screen.findAllByRole('button')).find((button) => button.textContent === 'Invoices');
    fireEvent.click(tab as HTMLElement);
  }

  it('sends the chosen invoice and confirms who it went to, only after the server says so', async () => {
    stubFinance(() => json({ ok: true, messageId: 'msg_1', sentTo: 'cooper@example.com', invoiceNumber: 'INV-ABCD1234' }));
    await openInvoicesTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invoice' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Invoice INV-ABCD1234 was sent to cooper@example.com.'));
    expect(sent).toEqual(['/api/finance/invoices/inv-1/send']);
  });

  it('shows the failure instead of "sent" when the email could not go out', async () => {
    stubFinance(() => new Response(JSON.stringify({ error: 'Email isn’t set up yet, so nothing was sent. Add RESEND_API_KEY and EMAIL_FROM to this app’s settings.', setupRequired: true }), { status: 503 }));
    await openInvoicesTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Resend invoice' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/nothing was sent/));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers no send button for a void invoice', async () => {
    stubFinance(() => json({}));
    await openInvoicesTab();
    await screen.findByRole('button', { name: 'Resend invoice' });
    expect(screen.getAllByRole('button', { name: /(Re)?send invoice/ })).toHaveLength(1);
  });
});
