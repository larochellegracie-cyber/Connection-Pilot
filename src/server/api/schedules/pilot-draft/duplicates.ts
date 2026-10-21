type TimedShift = { employeeId: string; startsAt: Date; endsAt: Date };

const sameShift = (left: TimedShift, right: TimedShift) =>
  left.employeeId === right.employeeId && left.startsAt.getTime() === right.startsAt.getTime() && left.endsAt.getTime() === right.endsAt.getTime();

/**
 * Drops requested shifts that would duplicate something: the same shift asked for
 * twice in one request, or a shift the employee already has at exactly that time.
 * Shifts being removed or moved by the same request (`ignoreIds`) don't count as
 * existing. Returns the shifts to create and how many were skipped.
 */
export function dropDuplicateShifts<T extends TimedShift>(requested: T[], existing: (TimedShift & { id: string })[], ignoreIds: Set<string> = new Set()) {
  const keep: T[] = [];
  for (const shift of requested) {
    if (keep.some((kept) => sameShift(kept, shift))) continue;
    if (existing.some((current) => !ignoreIds.has(current.id) && sameShift(current, shift))) continue;
    keep.push(shift);
  }
  return { keep, skipped: requested.length - keep.length };
}
