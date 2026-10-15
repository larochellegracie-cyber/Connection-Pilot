import { describe, expect, it } from 'vitest';
import { buildProactiveInsights, type ProactiveInsightInput } from './proactive-insights.js';

const now = new Date('2026-10-03T12:50:00.000Z');
const base = (): ProactiveInsightInput => ({ businessType: 'Bakery', now, upcoming: [], appointments: [], followUps: [], invoices: [], quotes: [], facts: [], allowOverlaps: false });
const scheduled = new Date('2026-10-04T14:00:00.000Z');

describe('proactive Pilot insights', () => {
  it('returns no insights when there is no evidence', () => expect(buildProactiveInsights(base())).toEqual([]));
  it('surfaces an upcoming appointment without inventing a risk', () => {
    const input = base(); input.businessType = 'Electrical service'; input.upcoming = [{ id: 'job-1', title: 'Panel inspection', customerName: 'Avery', scheduledAt: scheduled }];
    expect(buildProactiveInsights(input)[0]).toMatchObject({ category: 'Upcoming work', priority: 'opportunity' });
  });
  it('surfaces a quote that has waited seven days', () => {
    const input = base(); input.quotes = [{ id: 'quote-1', customerName: 'Avery', total: 840, status: 'sent', createdAt: new Date('2026-09-24T12:00:00.000Z') }];
    expect(buildProactiveInsights(input)[0]).toMatchObject({ category: 'Quote follow-up' });
  });
  it('surfaces unpaid invoices only when the record is past due', () => {
    const input = base(); input.invoices = [{ id: 'invoice-1', customerName: 'Avery', total: 125, status: 'overdue', dueAt: null }];
    expect(buildProactiveInsights(input)[0]).toMatchObject({ category: 'Unpaid invoice', priority: 'needs_attention' });
  });
  it('connects supplier timing only when a documented upcoming need matches confirmed knowledge', () => {
    const input = base(); input.upcoming = [{ id: 'order-1', title: 'Chocolate Cupcake', customerName: 'Avery', scheduledAt: scheduled }]; input.facts = [
      { id: 'material-1', kind: 'resource_requirement', subject: 'Chocolate Cupcake', predicate: 'requires_material', value: '0.08', unit: 'kg', details: 'Flour' },
      { id: 'supplier-1', kind: 'supplier_relationship', subject: 'Sweet Supply Co.', predicate: 'lead time', value: '2 days', unit: null, details: 'Orders Monday and Thursday' },
    ];
    const insight = buildProactiveInsights(input)[0]; expect(insight).toMatchObject({ category: 'Supplier timing' }); expect(insight.evidence).toHaveLength(3);
  });
  it('surfaces documented customer follow-ups', () => {
    const input = base(); input.followUps = [{ id: 'follow-1', customerName: 'Avery', summary: 'Asked for a callback', occurredAt: now }];
    expect(buildProactiveInsights(input)[0]).toMatchObject({ category: 'Customer follow-up', priority: 'needs_attention' });
  });
  it('surfaces appointment conflicts when overlaps are disabled', () => {
    const input = base(); input.appointments = [
      { id: 'appointment-1', title: 'Consultation', customerName: 'Avery', scheduledAt: scheduled, durationMinutes: 60 },
      { id: 'appointment-2', title: 'Repair', customerName: 'Morgan', scheduledAt: new Date('2026-10-04T14:30:00.000Z'), durationMinutes: 60 },
    ];
    expect(buildProactiveInsights(input).some((item) => item.category === 'Scheduling conflict')).toBe(true);
  });
  it('does not claim supplier timing with insufficient facts', () => {
    const input = base(); input.upcoming = [{ id: 'order-1', title: 'Chocolate Cupcake', customerName: 'Avery', scheduledAt: scheduled }];
    expect(buildProactiveInsights(input).some((item) => item.category === 'Supplier timing')).toBe(false);
  });
  it('keeps service businesses compatible with service-language insights', () => {
    const input = base(); input.businessType = 'Plumbing'; input.upcoming = [{ id: 'job-1', title: 'Pipe repair', customerName: 'Avery', scheduledAt: scheduled }];
    expect(buildProactiveInsights(input)[0].category).toBe('Upcoming work');
  });
});
