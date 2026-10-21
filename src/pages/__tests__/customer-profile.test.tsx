import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('@/lib/auth/auth-client', () => ({ ProtectedRoute: ({ children }: { children: unknown }) => children }));
vi.mock('@/layouts/WorkspaceLayout', () => ({ default: ({ children }: { children: unknown }) => children }));

import CustomerProfilePage from '../customer-profile';

type Note = { id: string; body: string; createdAt: string };

function profileWith(notes: Note[]) {
  return {
    businessType: 'service',
    customer: { id: 'cust-123', name: 'Jordan Rivera', phoneNumber: '+15555550100', email: 'jordan@example.com', address: null, status: 'active', createdAt: '2026-10-01T00:00:00.000Z', callCount: 0, messageCount: 0 },
    conversations: [], interactions: [], appointments: [], notes, activities: [], jobs: [], estimates: [], invoices: [], payments: [], tags: [],
  };
}

describe('Customer profile notes', () => {
  let savedNotes: Note[];
  let postedBodies: unknown[];
  let deletedUrls: string[];
  let patched: { url: string; body: unknown }[];
  let releaseSave: (() => void) | null;

  beforeEach(() => {
    savedNotes = [];
    postedBodies = [];
    deletedUrls = [];
    patched = [];
    releaseSave = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === '/api/customers/cust-123/activity') {
        const body = JSON.parse(String(init.body)) as { type: string; body: string };
        postedBodies.push(body);
        // Hold the save open until the test releases it, like a slow network.
        if (releaseSave === null) await new Promise<void>((resolve) => { releaseSave = resolve; });
        savedNotes = [{ id: `note-${savedNotes.length + 1}`, body: body.body, createdAt: '2026-10-21T01:00:00.000Z' }, ...savedNotes];
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      if (init?.method === 'PATCH' && url.startsWith('/api/customers/cust-123/notes/')) {
        const body = JSON.parse(String(init.body)) as { body: string };
        patched.push({ url, body });
        const noteId = url.split('/').pop();
        savedNotes = savedNotes.map((note) => (note.id === noteId ? { ...note, body: body.body } : note));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (init?.method === 'DELETE' && url.startsWith('/api/customers/cust-123/notes/')) {
        deletedUrls.push(url);
        const noteId = url.split('/').pop();
        savedNotes = savedNotes.filter((note) => note.id !== noteId);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === '/api/customers/cust-123') return new Response(JSON.stringify(profileWith(savedNotes)), { status: 200 });
      return new Response('{}', { status: 404 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderProfile() {
    return render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/dashboard/customers/cust-123']}>
          <Routes><Route path="/dashboard/customers/:customerId" element={<CustomerProfilePage />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
  }

  it('keeps the note composer out of the Customer Notes section', async () => {
    const { container } = renderProfile();
    await screen.findByRole('button', { name: 'Add Note' });
    const notes = container.querySelector('#customer-notes-title')!.closest('section')!;
    expect(notes.querySelector('textarea')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('opens a dialog from + Add Note, saves for this customer, and shows the note straight away', async () => {
    const { container } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Note' }));
    const dialog = screen.getByRole('dialog');
    const box = dialog.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Always go through back gate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Note' }));
    await waitFor(() => expect(releaseSave).not.toBeNull());
    releaseSave?.();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const notes = container.querySelector('#customer-notes-title')!.closest('section')!;
    await waitFor(() => expect(notes.textContent).toContain('Always go through back gate'));
    expect(postedBodies).toEqual([{ type: 'note', body: 'Always go through back gate' }]);
  });

  it('closes the dialog with Cancel without saving anything', async () => {
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Note' }));
    fireEvent.change(screen.getByRole('dialog').querySelector('textarea')!, { target: { value: 'Never mind' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postedBodies).toEqual([]);
  });

  it('does not save the same note twice when Save is pressed again while saving', async () => {
    renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Note' }));
    const form = screen.getByRole('dialog') as HTMLFormElement;
    fireEvent.change(form.querySelector('textarea')!, { target: { value: 'Call before arriving' } });
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(releaseSave).not.toBeNull());
    releaseSave?.();

    await waitFor(() => expect(screen.getByText('Call before arriving')).toBeTruthy());
    expect(postedBodies).toHaveLength(1);
  });

  describe('with existing notes', () => {
    beforeEach(() => {
      savedNotes = [
        { id: 'note-1', body: 'Always go through back gate', createdAt: '2026-10-21T01:00:00.000Z' },
        { id: 'note-2', body: 'Prefers morning visits', createdAt: '2026-10-20T01:00:00.000Z' },
      ];
    });

    it('shows Notes near the top, after the customer summary and before the rest of the profile', async () => {
      const { container } = renderProfile();
      await screen.findByText('Always go through back gate');
      const notes = container.querySelector('#customer-notes-title')!.closest('section')!;
      const summary = container.querySelector('dl')!;
      const sidebar = container.querySelector('aside')!;
      expect(summary.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(notes.compareDocumentPosition(sidebar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('asks for confirmation before removing, and Cancel keeps the note', async () => {
      renderProfile();
      await screen.findByText('Always go through back gate');
      fireEvent.click(screen.getAllByRole('button', { name: 'Note actions' })[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove note' }));

      expect(screen.getByRole('alertdialog', { name: 'Confirm note removal' })).toBeTruthy();
      expect(deletedUrls).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(deletedUrls).toEqual([]);
      expect(screen.getByText('Always go through back gate')).toBeTruthy();
    });

    it('removes only the chosen note, for this customer, after it is confirmed', async () => {
      renderProfile();
      await screen.findByText('Prefers morning visits');
      fireEvent.click(screen.getAllByRole('button', { name: 'Note actions' })[0]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Remove note' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

      await waitFor(() => expect(screen.queryByText('Always go through back gate')).toBeNull());
      expect(deletedUrls).toEqual(['/api/customers/cust-123/notes/note-1']);
      expect(screen.getByText('Prefers morning visits')).toBeTruthy();
    });
    it('edits a note in the same dialog, pre-filled, and saves the new wording to that note only', async () => {
      renderProfile();
      await screen.findByText('Prefers morning visits');
      fireEvent.click(screen.getAllByRole('button', { name: 'Note actions' })[1]);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

      const box = screen.getByRole('dialog').querySelector('textarea') as HTMLTextAreaElement;
      expect(box.value).toBe('Prefers morning visits');
      fireEvent.change(box, { target: { value: 'Prefers early morning visits' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(screen.getByText('Prefers early morning visits')).toBeTruthy());
      expect(patched).toEqual([{ url: '/api/customers/cust-123/notes/note-2', body: { body: 'Prefers early morning visits' } }]);
      expect(postedBodies).toEqual([]);
      expect(screen.getByText('Always go through back gate')).toBeTruthy();
    });
  });
});
