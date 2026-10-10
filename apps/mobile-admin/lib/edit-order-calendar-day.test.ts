import { describe, expect, it } from 'vitest';
import { parseCalendarDayToLocalDate } from './edit-order-calendar-day';

describe('parseCalendarDayToLocalDate', () => {
  it('parses valid calendar days as local midnight', () => {
    expect(parseCalendarDayToLocalDate('2024-01-05')?.getTime()).toBe(
      new Date(2024, 0, 5).getTime()
    );
  });

  it('accepts leap days', () => {
    expect(parseCalendarDayToLocalDate('2024-02-29')?.getTime()).toBe(
      new Date(2024, 1, 29).getTime()
    );
  });

  it.each([
    '01/02/2024',
    '2024-1-2',
    '2024-01-02T10:00:00Z',
    '',
    '  ',
  ])('rejects malformed days: %s', (value) => {
    expect(parseCalendarDayToLocalDate(value)).toBeUndefined();
  });

  it.each([
    '2024-02-30',
    '2024-02-31',
    '2023-02-29',
    '2024-13-01',
    '2024-00-10',
  ])('rejects rollover dates: %s', (value) => {
    expect(parseCalendarDayToLocalDate(value)).toBeUndefined();
  });

  it('rejects non-string input', () => {
    expect(parseCalendarDayToLocalDate(null)).toBeUndefined();
    expect(parseCalendarDayToLocalDate(undefined)).toBeUndefined();
  });
});
