import { describe, expect, it } from 'vitest';
import { reminderDueAt } from './chat-follow-up-reminder-due-at';

describe('reminderDueAt', () => {
  it.each([
    ['2026-11-25T09:00:00Z', '2026-11-25T09:00:00.000Z'],
    ['2026-11-25T09:00:00.900Z', '2026-11-25T09:00:00.000Z'],
    ['2026-11-25T10:00:00.100+01:00', '2026-11-25T09:00:00.000Z'],
  ])('keeps %s to the whole second', (value, expected) => {
    expect(reminderDueAt(value)).toBe(expected);
  });

  it('throws on a value that is not a time', () => {
    expect(() => reminderDueAt('soon')).toThrow(RangeError);
  });
});
