import { describe, expect, it } from 'vitest';
import { buildBusinessActivity, type ActivityInput, type ActivityOptions } from './business-activity';

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 21, 18, 0) - minutesAgo * 60_000);
const base = { customerId: 'c1', customerName: 'Jordan Rivera' };
const empty = (): ActivityInput => ({ appointments: [], customers: [], interactions: [], conversations: [], jobs: [], quotes: [], invoices: [], payments: [], receivedByInvoice: new Map(), pilotActions: [] });
const opts: ActivityOptions = { foodBusiness: false, timezone: 'America/Toronto' };
const build = (input: Partial<ActivityInput>, options = opts) => buildBusinessActivity({ ...empty(), ...input }, options);

describe('business activity feed', () => {
  it('describes appointments as booked, completed or cancelled, with the appointment time', () => {
    const feed = build({ appointments: [
      { ...base, id: 'a1', title: 'Pool opening', status: 'scheduled', scheduledAt: new Date('2026-10-22T18:00:00Z'), createdAt: at(30), updatedAt: at(30) },
      { ...base, id: 'a2', title: 'Pool cleaning', status: 'completed', scheduledAt: new Date('2026-10-20T15:00:00Z'), createdAt: at(900), updatedAt: at(60) },
      { ...base, id: 'a3', title: 'Filter swap', status: 'cancelled', scheduledAt: new Date('2026-10-23T15:00:00Z'), createdAt: at(900), updatedAt: at(10) },
    ] });
    expect(feed.map((event) => event.title)).toEqual(['Appointment cancelled', 'Appointment booked', 'Appointment completed']);
    const booked = feed.find((event) => event.kind === 'appointment_booked')!;
    expect(booked.detail).toBe('Pool opening · Thu, Oct 22, 2:00 p.m.');
    expect(booked.action).toEqual({ label: 'View appointment', href: '/calendar' });
    expect(booked.customerName).toBe('Jordan Rivera');
  });

  it('lists new customers and links to their profile', () => {
    const [event] = build({ customers: [{ id: 'c9', name: 'Casey Lee', createdAt: at(5) }] });
    expect(event).toMatchObject({ title: 'New customer added', customerName: 'Casey Lee', customerId: 'c9', action: { label: 'View customer', href: '/dashboard/customers/c9' } });
  });

  it('shows customer contact from calls and messages, with a short preview', () => {
    const feed = build({
      interactions: [{ ...base, id: 'i1', interactionType: 'call', direction: 'inbound', summary: 'Asked about pool opening dates', occurredAt: at(20) }],
      conversations: [{ ...base, id: 'm1', channel: 'sms', direction: 'inbound', content: 'Can you come Thursday instead?', occurredAt: at(10) }],
    });
    expect(feed.map((event) => [event.title, event.detail])).toEqual([
      ['Customer contacted', 'Text message · Can you come Thursday instead?'],
      ['Customer contacted', 'Phone call · Asked about pool opening dates'],
    ]);
  });

  it('shows jobs as created or completed, and calls them orders for food businesses', () => {
    const jobs = [
      { ...base, id: 'j1', service: 'Weekly pool service', status: 'scheduled', createdAt: at(40), updatedAt: at(40) },
      { ...base, id: 'j2', service: 'Liner repair', status: 'completed', createdAt: at(500), updatedAt: at(15) },
    ];
    expect(build({ jobs }).map((event) => event.title)).toEqual(['Job completed', 'Job created']);
    expect(build({ jobs }, { ...opts, foodBusiness: true }).map((event) => [event.title, event.action?.label])).toEqual([['Order completed', 'View order'], ['Order created', 'View order']]);
  });

  it('shows each quote once, in its latest state, with the amount', () => {
    const feed = build({ quotes: [
      { ...base, id: 'q1', status: 'draft', total: '250', createdAt: at(50), updatedAt: at(50) },
      { ...base, id: 'q2', status: 'sent', total: '1200.5', createdAt: at(300), updatedAt: at(40) },
      { ...base, id: 'q3', status: 'accepted', total: '800', createdAt: at(900), updatedAt: at(30) },
    ] });
    expect(feed.map((event) => [event.title, event.detail])).toEqual([
      ['Quote accepted', '$800.00'], ['Quote sent', '$1,200.50'], ['Quote created', '$250.00'],
    ]);
    expect(feed[0].action).toEqual({ label: 'View quote', href: '/finance' });
  });

  it('shows invoices as created or sent, and a settling payment as "Invoice paid"', () => {
    const feed = build({
      invoices: [
        { ...base, id: 'v1', status: 'draft', total: 100, createdAt: at(80), updatedAt: at(80) },
        { ...base, id: 'v2', status: 'sent', total: 300, createdAt: at(400), updatedAt: at(70) },
        { ...base, id: 'v3', status: 'sent', total: 500, createdAt: at(900), updatedAt: at(600) },
      ],
      payments: [
        { ...base, id: 'p1', invoiceId: 'v3', amount: 500, status: 'completed', occurredAt: at(5) },
        { ...base, id: 'p2', invoiceId: 'v2', amount: 100, status: 'completed', occurredAt: at(6) },
        { ...base, id: 'p3', invoiceId: null, amount: 40, status: 'completed', occurredAt: at(7) },
      ],
      receivedByInvoice: new Map([['v3', 500], ['v2', 100]]),
    });
    expect(feed.map((event) => [event.title, event.detail])).toEqual([
      ['Invoice paid', '$500.00'], ['Payment received', '$100.00'], ['Payment received', '$40.00'],
      ['Invoice sent', '$300.00'], ['Invoice created', '$100.00'],
    ]);
    expect(feed.find((event) => event.id === 'payment-p1')?.action).toEqual({ label: 'View invoice', href: '/finance' });
    expect(feed.find((event) => event.id === 'payment-p3')?.action).toEqual({ label: 'View payments', href: '/finance' });
    // the fully paid invoice is not also listed on its own
    expect(feed.some((event) => event.id === 'invoice-v3')).toBe(false);
  });

  it('ignores payments that were not completed', () => {
    expect(build({ payments: [{ ...base, id: 'p1', invoiceId: null, amount: 10, status: 'pending', occurredAt: at(1) }] })).toEqual([]);
  });

  it('shows what Pilot did, tagged, instead of listing the same appointment change twice', () => {
    const feed = build({
      appointments: [{ ...base, id: 'a1', title: 'Pool opening', status: 'cancelled', scheduledAt: at(-1000), createdAt: at(900), updatedAt: at(2) }],
      pilotActions: [
        { ...base, id: 'x1', kind: 'appointment_cancelled', detail: 'Pool opening', occurredAt: at(2.5) },
        { ...base, id: 'x2', kind: 'appointment_rescheduled', detail: 'Filter swap to Fri, Oct 23, 10:00 a.m.', occurredAt: at(30) },
      ],
    });
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ id: 'pilot-x1', title: 'Appointment cancelled', byPilot: true });
    expect(feed[1]).toMatchObject({ id: 'pilot-x2', title: 'Appointment rescheduled', byPilot: true });
  });

  it('never lets one kind of event crowd out the others, and keeps the feed short', () => {
    const quotes = Array.from({ length: 9 }, (_, index) => ({ ...base, id: `q${index}`, status: 'sent', total: 10, createdAt: at(100 + index), updatedAt: at(index + 1) }));
    const feed = build({ quotes, customers: [{ id: 'c2', name: 'Casey Lee', createdAt: at(500) }] });
    expect(feed.filter((event) => event.kind === 'quote_sent')).toHaveLength(3);
    expect(feed.some((event) => event.kind === 'customer_added')).toBe(true);
    const many = build({ customers: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, name: `Customer ${index}`, createdAt: at(index) })) }, opts);
    expect(many.length).toBeLessThanOrEqual(3);
    expect(build({ quotes, customers: [{ id: 'c2', name: 'Casey Lee', createdAt: at(500) }] }, { ...opts, limit: 2 })).toHaveLength(2);
  });

  it('is built only from business records, so private notes and edits cannot appear', () => {
    const everything = build({
      appointments: [{ ...base, id: 'a1', title: 'Visit', status: 'scheduled', scheduledAt: at(-50), createdAt: at(5), updatedAt: at(5) }],
      customers: [{ id: 'c1', name: 'Jordan Rivera', createdAt: at(6) }],
    });
    const text = JSON.stringify(everything).toLowerCase();
    for (const banned of ['private note', 'note removed', 'note added', 'information updated', 'customer updated']) expect(text).not.toContain(banned);
  });

  it('does not break on records that have no timestamp; they simply sort last', () => {
    const feed = build({ customers: [{ id: 'c1', name: 'No Date', createdAt: null }, { id: 'c2', name: 'Dated', createdAt: at(5) }] });
    expect(feed.map((event) => event.customerName)).toEqual(['Dated', 'No Date']);
  });
});
