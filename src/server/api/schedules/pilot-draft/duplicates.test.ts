import { describe, expect, it } from 'vitest';
import { dropDuplicateShifts } from './duplicates';

const shift = (employeeId: string, startHour: number, endHour: number, day = 21) => ({
  employeeId, startsAt: new Date(Date.UTC(2026, 9, day, startHour)), endsAt: new Date(Date.UTC(2026, 9, day, endHour)),
});

describe('dropDuplicateShifts', () => {
  it('keeps new shifts', () => {
    const result = dropDuplicateShifts([shift('a', 8, 17, 21), shift('a', 8, 17, 22)], []);
    expect(result.keep).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('skips a shift the employee already has at exactly that time', () => {
    const result = dropDuplicateShifts([shift('a', 8, 17, 21), shift('a', 8, 17, 22)], [{ id: 's1', ...shift('a', 8, 17, 21) }]);
    expect(result.keep).toEqual([shift('a', 8, 17, 22)]);
    expect(result.skipped).toBe(1);
  });

  it('does not treat a different time or a different employee as a duplicate', () => {
    const result = dropDuplicateShifts([shift('a', 9, 17), shift('b', 8, 17)], [{ id: 's1', ...shift('a', 8, 17) }]);
    expect(result.keep).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('skips a shift that is asked for twice in the same request', () => {
    const result = dropDuplicateShifts([shift('a', 8, 17), shift('a', 8, 17)], []);
    expect(result.keep).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('does not count a shift that the same request is removing or moving', () => {
    const result = dropDuplicateShifts([shift('a', 8, 17)], [{ id: 'being-moved', ...shift('a', 8, 17) }], new Set(['being-moved']));
    expect(result.keep).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });
});
