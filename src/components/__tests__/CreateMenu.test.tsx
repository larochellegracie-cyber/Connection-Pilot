import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import CreateMenu from '../CreateMenu';
import { useCreateIntent } from '@/lib/create-intent';

function Where() { const location = useLocation(); return <p data-testid="where">{location.pathname}{location.search}</p>; }
function Page({ onCreate }: { onCreate: (kind: string) => void }) { useCreateIntent(['quote', 'invoice'], onCreate); return <Where />; }

describe('+ Create menu', () => {
  it('lists every quick-create option and closes after one is chosen', () => {
    render(<MemoryRouter><CreateMenu /><Where /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['New Customer', 'New Lead', 'New Job', 'New Appointment', 'New Employee', 'New Quote', 'New Invoice', 'New Message']);
    expect(screen.queryByText('New Shift')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Invoice' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/finance?create=invoice');
  });

  it('closes with Escape or a click elsewhere', () => {
    render(<MemoryRouter><CreateMenu /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('uses orders and hides appointments for food businesses', () => {
    render(<MemoryRouter><CreateMenu foodBusiness /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(screen.getByRole('menuitem', { name: 'New Order' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'New Appointment' })).toBeNull();
  });

  it('a page opens its own form once for ?create= and then clears the parameter', () => {
    const opened: string[] = [];
    render(<MemoryRouter initialEntries={['/finance?create=quote']}><Routes><Route path="/finance" element={<Page onCreate={(kind) => opened.push(kind)} />} /></Routes></MemoryRouter>);
    expect(opened).toEqual(['quote']);
    expect(screen.getByTestId('where').textContent).toBe('/finance');
  });

  it('ignores unknown create requests', () => {
    const opened: string[] = [];
    render(<MemoryRouter initialEntries={['/finance?create=other']}><Routes><Route path="/finance" element={<Page onCreate={(kind) => opened.push(kind)} />} /></Routes></MemoryRouter>);
    expect(opened).toEqual([]);
  });
});
