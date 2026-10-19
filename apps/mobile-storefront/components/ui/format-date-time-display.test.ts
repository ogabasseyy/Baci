import { describe, expect, it } from '@jest/globals';
import { formatDateTimeDisplay } from './format-date-time-display';

describe('formatDateTimeDisplay', () => {
  it.each([
    ['2026-01-05', '5 January 2026'],
    ['2026-12-31', '31 December 2026'],
    ['2024-02-29', '29 February 2024'],
  ])('formats valid date %s', (value, expected) => {
    expect(formatDateTimeDisplay(value, 'date')).toBe(expected);
  });

  it.each([
    '2023-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-01-32',
    'not-a-date',
    '2026-1-5',
    '',
  ])('falls back for invalid date %s', (value) => {
    expect(formatDateTimeDisplay(value, 'date')).toBe('—');
  });

  it.each([
    ['00:00', '12:00 AM'],
    ['12:00', '12:00 PM'],
    ['09:05', '9:05 AM'],
    ['13:30', '1:30 PM'],
    ['23:59', '11:59 PM'],
  ])('formats valid time %s', (value, expected) => {
    expect(formatDateTimeDisplay(value, 'time')).toBe(expected);
  });

  it.each([
    '24:00',
    '12:60',
    '9:05',
    'noon',
    '',
  ])('falls back for invalid time %s', (value) => {
    expect(formatDateTimeDisplay(value, 'time')).toBe('—');
  });
});
