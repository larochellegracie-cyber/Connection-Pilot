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

describe('Finance: invoice form layout', () => {
  const saved: Record<string, unknown>[] = [];
  beforeEach(() => {
    saved.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/finance' && !init?.method) return json({ estimates: [], jobFiles: [], payments: [], invoices: [{ ...invoice('inv-1', 'Pool cleaning'), dueAt: '2026-11-06T12:00:00.000Z' }], summary: { estimated: 0, invoiced: 100, received: 0, outstanding: 100 } });
      if (url === '/api/customers') return json({ customers: [{ id: 'cust-1', name: 'Jordan Rivera', phoneNumber: '+15555550100' }] });
      if (url === '/api/jobs') return json({ jobs: [{ id: 'job-1', customerId: 'cust-1', customerName: 'Jordan Rivera', service: 'Pool cleaning' }] });
      if (url === '/api/finance' && init?.method === 'POST') { saved.push(JSON.parse(String(init.body))); return json({ ok: true }, 201); }
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  async function openInvoice() {
    render(<HelmetProvider><MemoryRouter><FinancePage /></MemoryRouter></HelmetProvider>);
    fireEvent.click((await screen.findAllByRole('button')).find((button) => button.textContent === 'Invoices') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = (await screen.findByDisplayValue('Pool cleaning line')).closest('form') as HTMLFormElement;
    return { form, items: form.querySelector('fieldset') as HTMLFieldSetElement };
  }
  const field = (items: HTMLElement, name: string) => items.querySelector(`[aria-label="${name}"]`) as HTMLInputElement;

  it('labels the line-item columns: Description, Qty, Rate, Tax %, Amount, Remove', async () => {
    const { items } = await openInvoice();
    const header = items.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect([...header.querySelectorAll('span')].map((span) => span.textContent)).toEqual(['Description', 'Qty', 'Rate', 'Tax %', 'Amount', 'Remove']);
    expect(field(items, 'Line item 1 description').placeholder).toBe('Description');
    expect(field(items, 'Line item 1 unit price').placeholder).toBe('Rate');
  });

  it('shows each line’s amount and keeps the subtotal, tax and total calculations exactly as before', async () => {
    const { items } = await openInvoice();
    const totals = () => [...items.querySelectorAll('dl > div')].map((row) => row.textContent);
    expect(field(items, 'Line item 1 amount').textContent).toBe('$100.00');
    expect(totals()).toEqual(['Subtotal$100.00', 'Tax$0.00', 'Total$100.00']);

    fireEvent.change(field(items, 'Line item 1 quantity'), { target: { value: '2' } });
    fireEvent.change(field(items, 'Line item 1 tax rate'), { target: { value: '10' } });
    expect(field(items, 'Line item 1 amount').textContent).toBe('$200.00');
    expect(totals()).toEqual(['Subtotal$200.00', 'Tax$20.00', 'Total$220.00']);
  });

  it('makes Total stand out from Subtotal and Tax', async () => {
    const { items } = await openInvoice();
    const rows = [...items.querySelectorAll('dl > div')] as HTMLElement[];
    expect(rows[2].className).toContain('font-extrabold');
    expect(rows[2].className).toContain('border-t');
    expect(rows[0].className).not.toContain('font-extrabold');
  });

  it('adds and removes lines, never leaving fewer than one', async () => {
    const { items } = await openInvoice();
    const removeButtons = () => [...items.querySelectorAll('button')].filter((button) => button.textContent === 'Remove') as HTMLButtonElement[];
    expect(removeButtons()).toHaveLength(1);
    expect(removeButtons()[0].disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Add line item' }));
    expect(removeButtons()).toHaveLength(2);
    expect(removeButtons().every((button) => !button.disabled)).toBe(true);
    expect(field(items, 'Line item 2 quantity').value).toBe('');   // new lines start empty, not 0
    expect(field(items, 'Line item 2 unit price').value).toBe('');
    expect(field(items, 'Line item 2 tax rate').value).toBe('');

    fireEvent.click(removeButtons()[1]);
    expect(removeButtons()).toHaveLength(1);
  });

  it('keeps every field: customer, linked job, status, due date and notes, plus Close, Cancel and Save', async () => {
    const { form } = await openInvoice();
    for (const name of ['customerId', 'jobId', 'status', 'dueAt', 'notes']) expect(form.querySelector(`[name="${name}"]`)).toBeTruthy();
    expect((form.querySelector('[name="dueAt"]') as HTMLInputElement).value).toBe('2026-11-06');
    for (const label of ['Close', 'Cancel', 'Save']) expect([...form.querySelectorAll('button')].some((button) => button.textContent === label)).toBe(true);
  });

  it('uses one control height and radius for the dropdowns and the date, a shorter notes box, and a clear primary Save', async () => {
    const { form } = await openInvoice();
    for (const name of ['customerId', 'jobId', 'status', 'dueAt']) {
      const control = form.querySelector(`[name="${name}"]`) as HTMLElement;
      expect(control.className).toContain('h-10');
      expect(control.className).toContain('rounded-lg');
    }
    expect((form.querySelector('[name="notes"]') as HTMLTextAreaElement).rows).toBe(2);
    const save = [...form.querySelectorAll('button')].find((button) => button.textContent === 'Save') as HTMLElement;
    const cancel = [...form.querySelectorAll('button')].find((button) => button.textContent === 'Cancel') as HTMLElement;
    expect(save.className).toContain('bg-primary');
    expect(cancel.className).not.toContain('bg-primary');
  });

  it('is wide enough for the line-item table on invoices and quotes, and never scrolls sideways', async () => {
    const { form } = await openInvoice();
    expect(form.className).toContain('max-w-3xl');
    expect(form.className).toContain('overflow-x-hidden');
  });
  async function openNewInvoice() {
    render(<HelmetProvider><MemoryRouter><FinancePage /></MemoryRouter></HelmetProvider>);
    fireEvent.click((await screen.findAllByRole('button')).find((button) => button.textContent === 'Invoices') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'New invoice' }));
    const form = (await screen.findByPlaceholderText('Description')).closest('form') as HTMLFormElement;
    return { form, items: form.querySelector('fieldset') as HTMLFieldSetElement };
  }

  it('starts a new line with empty Qty, Rate and Tax % that show their placeholders, never 0', async () => {
    const { items } = await openNewInvoice();
    for (const [name, placeholder] of [['quantity', 'Qty'], ['unit price', 'Rate'], ['tax rate', 'Tax %']] as const) {
      const input = field(items, `Line item 1 ${name}`);
      expect(input.value).toBe('');
      expect(input.placeholder).toBe(placeholder);
    }
    // an empty line is worth nothing, not NaN, and shows $0.00 only as the computed Amount
    expect(field(items, 'Line item 1 amount').textContent).toBe('$0.00');
    expect([...items.querySelectorAll('dl > div')].map((row) => row.textContent)).toEqual(['Subtotal$0.00', 'Tax$0.00', 'Total$0.00']);
  });

  it('treats an empty field as zero inside the calculation, and calculates exactly as before once values are typed', async () => {
    const { items } = await openNewInvoice();
    const totals = () => [...items.querySelectorAll('dl > div')].map((row) => row.textContent);
    fireEvent.change(field(items, 'Line item 1 quantity'), { target: { value: '3' } });
    expect(totals()).toEqual(['Subtotal$0.00', 'Tax$0.00', 'Total$0.00']); // no rate yet
    fireEvent.change(field(items, 'Line item 1 unit price'), { target: { value: '45' } });
    expect(field(items, 'Line item 1 amount').textContent).toBe('$135.00');
    expect(totals()).toEqual(['Subtotal$135.00', 'Tax$0.00', 'Total$135.00']); // tax left empty counts as 0
    fireEvent.change(field(items, 'Line item 1 tax rate'), { target: { value: '13' } });
    expect(totals()).toEqual(['Subtotal$135.00', 'Tax$17.55', 'Total$152.55']);
  });

  it('adds new lines empty too', async () => {
    const { items } = await openNewInvoice();
    fireEvent.click(screen.getByRole('button', { name: 'Add line item' }));
    for (const name of ['quantity', 'unit price', 'tax rate']) expect(field(items, `Line item 2 ${name}`).value).toBe('');
  });

  it('saves what was typed; an empty Tax % is sent empty, which the server already reads as 0%', async () => {
    const { form, items } = await openNewInvoice();
    fireEvent.change(form.querySelector('[name="customerId"]') as HTMLSelectElement, { target: { value: 'cust-1' } });
    fireEvent.change(field(items, 'Line item 1 description'), { target: { value: 'Pool cleaning' } });
    fireEvent.change(field(items, 'Line item 1 quantity'), { target: { value: '3' } });
    fireEvent.change(field(items, 'Line item 1 unit price'), { target: { value: '45' } });
    fireEvent.submit(form);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ recordType: 'invoices', customerId: 'cust-1', lineItems: [{ description: 'Pool cleaning', quantity: '3', unitPrice: '45', taxRate: '' }] });
  });

  it('still shows the real values of a saved invoice', async () => {
    const { items } = await openInvoice();
    expect(field(items, 'Line item 1 quantity').value).toBe('1');
    expect(field(items, 'Line item 1 unit price').value).toBe('100');
    expect(field(items, 'Line item 1 tax rate').value).toBe('0'); // a saved 0% tax is a real value and is shown
  });

  it('lays each line out as one real row on wide screens and labelled blocks on small ones', async () => {
    const { items } = await openNewInvoice();
    const row = field(items, 'Line item 1 description').closest('div.grid') as HTMLElement;
    // the desktop row must have its column template, and nothing that cancels it
    expect(row.className).toContain('md:grid-cols-[minmax(0,1fr)_4.25rem_6rem_4.25rem_5.5rem_4.5rem]');
    expect(row.className).not.toContain('md:grid-cols-none');
    // the desktop headers exist only from md up...
    const header = items.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('md:grid');
    expect(header.className).toContain('md:grid-cols-[minmax(0,1fr)_4.25rem_6rem_4.25rem_5.5rem_4.5rem]'); // ...and use the same columns as the rows
    // ...while on small screens every field carries its own visible label
    const smallLabels = [...row.querySelectorAll('span')].filter((span) => span.className.includes('md:hidden')).map((span) => span.textContent);
    expect(smallLabels).toEqual(['Description', 'Qty', 'Rate', 'Tax %', 'Amount']);
  });
});
