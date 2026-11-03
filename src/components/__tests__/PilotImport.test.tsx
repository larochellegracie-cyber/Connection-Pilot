import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PilotImport from '../PilotImport';

const sheet = { id: 'customers.csv::Customers', fileName: 'customers.csv', sheetName: 'Customers', headers: ['Name', 'Phone', 'Email', 'Cust. Type'], rows: [['Jo Rivera', '5550100001', 'jo@example.com', 'VIP'], ['Sam Lee', '5550100002', '', 'Regular']], truncated: false };
const suggestion = { id: sheet.id, kind: 'customers', confidence: 'high', mappings: { customers: { '0': 'name', '1': 'phone', '2': 'email' } } };

const item = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, kind: 'customers', row: 2, fileName: 'customers.csv', label, display: { Name: label, Phone: '5550100001', Email: '', Address: '' }, issues: [], action: 'create', ...extra });
const planWith = (overrides: Record<string, unknown> = {}) => {
  const empty = (kind: string) => ({ kind, found: 0, willCreate: 0, willUpdate: 0, skipped: 0, needsAttention: 0, notes: [], sample: [], attention: [] });
  return { categories: { customers: { ...empty('customers'), found: 2, willCreate: 2, sample: [item('a', 'Jo Rivera'), item('b', 'Sam Lee')], ...overrides }, employees: empty('employees'), services: empty('services'), jobs: empty('jobs'), quotes: empty('quotes'), invoices: empty('invoices') }, found: 2, willCreate: 2, willUpdate: 0 };
};

class FakeXhr {
  static last: FakeXhr | null = null;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  status = 200; responseText = '';
  open() { FakeXhr.last = this; }
  setRequestHeader() { /* noop */ }
  withCredentials = false;
  send() { this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 }); this.status = FakeXhr.reply.status; this.responseText = JSON.stringify(FakeXhr.reply.body); this.onload?.(); }
  static reply: { status: number; body: unknown } = { status: 200, body: { sheets: [sheet], suggestions: [suggestion] } };
}

describe('Pilot import workflow', () => {
  let commits: unknown[];
  let previews: Array<Record<string, unknown>>;
  let nextPlan: () => unknown;
  beforeEach(() => {
    commits = []; previews = []; nextPlan = () => planWith();
    FakeXhr.reply = { status: 200, body: { sheets: [sheet], suggestions: [suggestion] } };
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (url === '/api/import/preview') { previews.push(body); return new Response(JSON.stringify({ plan: nextPlan() }), { status: 200 }); }
      if (url === '/api/import/commit') { commits.push(body); return new Response(JSON.stringify({ result: { imported: { customers: 2, employees: 0, services: 0, jobs: 0, quotes: 0, invoices: 0 }, updated: { customers: 0, employees: 0, services: 0, jobs: 0, quotes: 0, invoices: 0 }, issues: [], failed: [] } }), { status: 201 }); }
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const upload = async (name = 'customers.csv') => {
    render(<PilotImport onFinished={() => undefined} />);
    const file = new File(['Name,Phone\nJo,1'], name, { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Choose files to import'), { target: { files: [file] } });
  };

  const toReview = async () => {
    await screen.findByText('1 sheet read');
    fireEvent.click(screen.getByRole('button', { name: /See what Pilot found/ }));
    const go = await screen.findByRole('button', { name: /Review & Import/ });
    await waitFor(() => expect(go.hasAttribute('disabled')).toBe(false));
    fireEvent.click(go);
  };

  it('only advertises the file types it can process', () => {
    render(<PilotImport />);
    expect(document.body.textContent).toMatch(/Excel \(\.xlsx, \.xls, \.xltx\), CSV and TSV/);
    expect((screen.getByLabelText('Choose files to import') as HTMLInputElement).accept).toBe('.xlsx,.xls,.xltx,.csv,.tsv');
    expect(document.body.textContent).not.toMatch(/\.pdf|\.docx/i);
  });

  it('refuses unsupported files with a clear message and does not contact the server', async () => {
    await upload('notes.pdf');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Pilot can import Excel/);
    expect(screen.getByRole('button', { name: /See what Pilot found/ }).hasAttribute('disabled')).toBe(true);
    expect(FakeXhr.last).toBeNull();
  });

  it('shows server errors for a file that cannot be read', async () => {
    FakeXhr.reply = { status: 400, body: { error: 'Pilot could not find any rows of data in this file.' } };
    await upload();
    expect((await screen.findByRole('alert')).textContent).toContain('could not find any rows');
  });

  it('shows the real counts from the preview, then review, confirmation and results — importing only after confirm', async () => {
    await upload();
    await screen.findByText('1 sheet read');
    fireEvent.click(screen.getByRole('button', { name: /See what Pilot found/ }));
    const found = await screen.findByRole('list', { name: 'What Pilot found' });
    expect(within(found).getByText('2')).toBeTruthy();
    expect(screen.getByText('Pilot is ready to organize this information.')).toBeTruthy();

    const go = screen.getByRole('button', { name: /Review & Import/ });
    await waitFor(() => expect(go.hasAttribute('disabled')).toBe(false));
    fireEvent.click(go);
    expect(await screen.findByText('2 customers found')).toBeTruthy();
    expect(screen.getByText('Jo Rivera')).toBeTruthy();
    expect(screen.getByText(/I found a column called/).textContent).toContain('Cust. Type');
    expect(screen.getByText('2 customers are ready to import.')).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Ready to import')).toBeTruthy();
    expect(screen.getByText('Nothing will be added until you confirm.')).toBeTruthy();
    expect(commits).toEqual([]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import everything' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Import everything' }));
    expect(await screen.findByText('You’re all set! 🎉')).toBeTruthy();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ confirmed: true });
    expect(screen.getByRole('list', { name: 'Import results' }).textContent).toContain('2 customers imported');
  });

  it('lets the owner decide what an unfamiliar column means, and re-checks the preview with that choice', async () => {
    await upload();
    await toReview();
    fireEvent.change(await screen.findByLabelText('What is Cust. Type'), { target: { value: 'notes' } });
    await waitFor(() => expect(previews.some((request) => (request.decisions as Array<{ mapping: Record<string, string> }>)[0].mapping['3'] === 'notes')).toBe(true));
  });

  it('asks about possible duplicates and sends the owner’s choice', async () => {
    nextPlan = () => planWith({ needsAttention: 1, attention: [item('a', 'Jo Rivera', { action: 'skip', reason: 'Kept the existing customer.', duplicate: { type: 'existing', description: 'Possible existing customer: Jordan R (jo@example.com)', options: ['skip', 'update', 'create'], choice: 'skip' } })] });
    await upload();
    await toReview();
    expect(await screen.findByText('Possible existing customer: Jordan R (jo@example.com)')).toBeTruthy();
    const select = screen.getByLabelText('What to do with Jo Rivera') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Keep existing', 'Update existing', 'Create new']);
    fireEvent.change(select, { target: { value: 'update' } });
    await waitFor(() => expect(previews.some((request) => (request.recordChoices as Record<string, string>)?.a === 'update')).toBe(true));
  });

  it('reports skipped records honestly and offers to review the issues', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/import/preview') return new Response(JSON.stringify({ plan: planWith() }), { status: 200 });
      commits.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ result: { imported: { customers: 1, employees: 0, services: 0, jobs: 0, quotes: 0, invoices: 0 }, updated: { customers: 0, employees: 0, services: 0, jobs: 0, quotes: 0, invoices: 0 }, issues: [{ kind: 'customers', label: 'No Phone', row: 4, fileName: 'customers.csv', reason: 'Connection Pilot needs a phone number for each customer, and this row has none.' }], failed: [] } }), { status: 201 });
    });
    await upload();
    await toReview();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('button', { name: 'Import everything' });
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    fireEvent.click(confirm);
    expect(await screen.findByText('1 record needs your attention.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Import results' }).textContent).toContain('1 customer imported');
    fireEvent.click(screen.getByRole('button', { name: 'Review issues' }));
    expect(screen.getByText(/needs a phone number/)).toBeTruthy();
  });
});
