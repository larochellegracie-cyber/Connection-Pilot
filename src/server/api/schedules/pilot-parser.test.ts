import { describe, expect, it } from 'vitest';
import { parsePilotInstruction, type PilotCommand, type PilotEmployee } from './pilot-parser';

const employees: PilotEmployee[] = [
  { id: 'avery', name: 'Avery Stone', status: 'active' },
  { id: 'sam', name: 'Sam Patel', status: 'active' },
  { id: 'old', name: 'Olive Gone', status: 'inactive' },
];
// Monday 19 October 2026, local midnight in Toronto.
const context = { weekStart: new Date('2026-10-19T04:00:00.000Z'), timezone: 'America/Toronto' };

const MON = 1, TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, SUN = 0;
const add = (employeeId: string, days: number[], start: [number, number], end: [number, number]) => ({
  type: 'add', employeeId, days, start: { hour: start[0], minute: start[1] }, end: { hour: end[0], minute: end[1] },
});
function parse(text: string, staff = employees) {
  const result = parsePilotInstruction(text, staff, context);
  return { ...result, commands: result.commands?.map((command) => { const { employeeName: _name, ...rest } = command as PilotCommand & { employeeName?: string }; return rest; }) as unknown as Partial<PilotCommand>[] | undefined };
}

describe('Pilot schedule parser: days', () => {
  it.each([
    'Add Avery Tuesday-Friday 8-5',
    'Add Avery Tuesday - Friday 8-5',
    'Add Avery Tue-Fri 8am-5pm',
    'Add Avery Tuesday through Friday 8am to 5pm',
    'Add Avery Tuesday to Friday 8-5',
    'Add Avery Tues–Fri 8:00-17:00',
    'add avery tuesday-friday 8-5.',
  ])('turns %j into four shifts, Tuesday to Friday, 8 AM to 5 PM', (text) => {
    expect(parse(text).commands).toEqual([add('avery', [TUE, WED, THU, FRI], [8, 0], [17, 0])]);
  });

  it('understands a list of days', () => {
    expect(parse('Avery Monday, Wednesday and Friday 9-3').commands).toEqual([add('avery', [MON, WED, FRI], [9, 0], [15, 0])]);
    expect(parse('Avery Mon Wed Fri 9am-3pm').commands).toEqual([add('avery', [MON, WED, FRI], [9, 0], [15, 0])]);
  });

  it('understands a range followed by an extra day', () => {
    expect(parse('Avery Mon-Wed, Fri 8-4').commands).toEqual([add('avery', [MON, TUE, WED, FRI], [8, 0], [16, 0])]);
  });

  it('understands days written after the time', () => {
    expect(parse('Avery 8-5 Tuesday-Friday').commands).toEqual([add('avery', [TUE, WED, THU, FRI], [8, 0], [17, 0])]);
  });

  it('keeps a single day working as before', () => {
    expect(parse('Add Avery Friday 8am-5pm').commands).toEqual([add('avery', [FRI], [8, 0], [17, 0])]);
  });

  it('runs a range that ends on Sunday, the last day of the week', () => {
    expect(parse('Avery Friday-Sunday 8-5').commands).toEqual([add('avery', [FRI, SAT, SUN], [8, 0], [17, 0])]);
  });

  it('asks when a range runs backwards instead of guessing', () => {
    expect(parse('Avery Friday-Tuesday 8-5').clarification).toMatch(/valid day/);
  });
});

describe('Pilot schedule parser: several shifts in one sentence', () => {
  it('gives each time range its own days', () => {
    expect(parse('Avery Mon 8-5, Tue 9-6').commands).toEqual([
      add('avery', [MON], [8, 0], [17, 0]),
      add('avery', [TUE], [9, 0], [18, 0]),
    ]);
    expect(parse('Avery 8-5 Monday, 9-6 Tuesday').commands).toEqual([
      add('avery', [MON], [8, 0], [17, 0]),
      add('avery', [TUE], [9, 0], [18, 0]),
    ]);
  });

  it('handles more than one employee', () => {
    expect(parse('Add Avery Tuesday-Friday 8-5 and Sam Monday 9-3').commands).toEqual([
      add('avery', [TUE, WED, THU, FRI], [8, 0], [17, 0]),
      add('sam', [MON], [9, 0], [15, 0]),
    ]);
  });
});

describe('Pilot schedule parser: times', () => {
  const times = (text: string) => (parse(text).commands?.[0] as { start: { hour: number; minute: number }; end: { hour: number; minute: number } });
  it.each([
    ['8-5', [8, 0], [17, 0]],
    ['9-6', [9, 0], [18, 0]],
    ['7-3', [7, 0], [15, 0]],
    ['6-2', [6, 0], [14, 0]],
    ['10-2', [10, 0], [14, 0]],
    ['1-5', [13, 0], [17, 0]],
    ['12-8', [12, 0], [20, 0]],
    ['8-12', [8, 0], [12, 0]],
    ['4-11', [16, 0], [23, 0]],
    ['8am-5pm', [8, 0], [17, 0]],
    ['8am-5', [8, 0], [17, 0]],
    ['8-5pm', [8, 0], [17, 0]],
    ['9-12pm', [9, 0], [12, 0]],
    ['8:30-5:15', [8, 30], [17, 15]],
    ['8:30am to 4:45pm', [8, 30], [16, 45]],
    ['08:00-17:00', [8, 0], [17, 0]],
    ['13:00-21:00', [13, 0], [21, 0]],
    ['5pm-9pm', [17, 0], [21, 0]],
  ] as const)('reads %s on Monday', (range, start, end) => {
    const parsed = times(`Avery Monday ${range}`);
    expect([parsed.start.hour, parsed.start.minute]).toEqual(start);
    expect([parsed.end.hour, parsed.end.minute]).toEqual(end);
  });

  it('asks about a shift that would end before it starts', () => {
    expect(parse('Avery Monday 10pm-6am').clarification).toMatch(/must be after the start time/);
  });

  it('asks for a day when none is given', () => {
    expect(parse('Add Avery 8-5').clarification).toMatch(/valid day/);
  });
});

describe('Pilot schedule parser: employees and other requests', () => {
  it('asks when a first name matches more than one employee', () => {
    const twins = [...employees, { id: 'avery2', name: 'Avery Park', status: 'active' }];
    expect(parse('Add Avery Tuesday-Friday 8-5', twins).clarification).toMatch(/More than one employee matches “Avery”/);
  });

  it('accepts a full name even when the first name is shared', () => {
    const twins = [...employees, { id: 'avery2', name: 'Avery Park', status: 'active' }];
    expect(parse('Add Avery Park Monday 8-5', twins).commands).toEqual([add('avery2', [MON], [8, 0], [17, 0])]);
  });

  it('ignores inactive employees', () => {
    expect(parse('Add Olive Monday 8-5').clarification).toMatch(/employee name/);
  });

  it.each([
    ['Take Avery off Friday', [FRI]],
    ['Avery Friday off', [FRI]],
    ['Avery off Fri and Sat', [FRI, SAT]],
    ['Avery off Tuesday-Thursday', [TUE, WED, THU]],
  ])('reads %j as time off', (text, days) => {
    expect(parse(text).commands).toEqual([{ type: 'off', employeeId: 'avery', days }]);
  });

  it('only takes off the day that is marked off', () => {
    expect(parse('Avery Monday 8-5, Friday off').commands).toEqual([{ type: 'off', employeeId: 'avery', days: [FRI] }]);
  });

  it('still understands moving a shift', () => {
    expect(parse('Move Avery’s Monday shift to Tuesday').commands).toEqual([{ type: 'move', employeeId: 'avery', fromDay: MON, toDay: TUE }]);
  });

  it('still understands repeating the same shift every day', () => {
    expect(parse('Avery same shift every day').commands).toEqual([{ type: 'repeat', employeeId: 'avery' }]);
  });

  it('still checks calendar dates against the weekday', () => {
    expect(parse('Avery Tuesday October 22 8-5').clarification).toMatch(/does not match/);
  });
});

describe('Pilot schedule parser: copy last week and fill the gaps', () => {
  it('understands the whole request: copy last week, then add Avery on the days she is not working, 8am-5pm', () => {
    const result = parse("Can you make this week's schedule like last week but add Avery on every day she's not working from last week and make the shifts 8am-5pm");
    expect(result.commands).toEqual([{ type: 'copy_previous' }, { type: 'fill', employeeId: 'avery', start: { hour: 8, minute: 0 }, end: { hour: 17, minute: 0 } }]);
  });

  it('does not mistake "every day she is not working" for "repeat the same shift every day"', () => {
    expect(parse('Add Avery on every day she is not working 8-5').commands).toEqual([{ type: 'fill', employeeId: 'avery', start: { hour: 8, minute: 0 }, end: { hour: 17, minute: 0 } }]);
  });

  it.each([
    'Make this week like last week',
    'Make the schedule the same as last week',
    'Copy the previous week',
    'Make this week match last week’s schedule',
  ])('reads %j as copying the previous week', (text) => {
    expect(parse(text).commands).toEqual([{ type: 'copy_previous' }]);
  });

  it('applies changes on top of the copy, in that order', () => {
    expect(parse('Make this week like last week but take Avery off Friday').commands).toEqual([{ type: 'copy_previous' }, { type: 'off', employeeId: 'avery', days: [FRI] }]);
    expect(parse('Like last week, and add Sam Monday 9-3').commands).toEqual([{ type: 'copy_previous' }, add('sam', [MON], [9, 0], [15, 0])]);
  });

  it('works for any employee on the other days', () => {
    expect(parse('Add Sam on the other days 10am-6pm').commands).toEqual([{ type: 'fill', employeeId: 'sam', start: { hour: 10, minute: 0 }, end: { hour: 18, minute: 0 } }]);
  });

  it('asks for the hours when they are missing, or impossible', () => {
    expect(parse('Add Avery on every day she is not working').clarification).toMatch(/What hours should Avery Stone work/);
    expect(parse('Add Avery on the days she is not working 10pm-6am').clarification).toMatch(/must be after the start time/);
  });

  it('does not treat "from last week" on its own as a request to copy', () => {
    expect(parse('Add Avery Monday 8-5 from last week').commands).toEqual([add('avery', [MON], [8, 0], [17, 0])]);
  });

  it('still reads a plain "every day" as repeating one shift', () => {
    expect(parse('Avery same shift every day').commands).toEqual([{ type: 'repeat', employeeId: 'avery' }]);
  });
});
