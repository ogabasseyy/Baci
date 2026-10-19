import { describe, expect, it } from 'vitest';
import { expenseDateCodec } from './expense-date';

describe('expenseDateCodec', () => {
  it('round-trips a local expense date without shifting the day', () => {
    const localDate = new Date(2026, 7, 9, 23, 30);

    expect(expenseDateCodec.toDateOnly(localDate)).toBe('2026-08-09');
    expect(expenseDateCodec.fromDateOnly('2026-08-09')).toEqual(
      new Date(2026, 7, 9)
    );
  });

  it('rejects malformed and impossible date-only values', () => {
    expect(expenseDateCodec.fromDateOnly('2026-2-09')).toBeNull();
    expect(expenseDateCodec.fromDateOnly('2026-02-29')).toBeNull();
    expect(expenseDateCodec.fromDateOnly('2026-13-01')).toBeNull();
  });

  it('preserves valid years below 100', () => {
    const date = expenseDateCodec.fromDateOnly('0099-01-02');

    expect(date).not.toBeNull();
    if (!date) throw new Error('expected valid date');
    expect(date.getFullYear()).toBe(99);
    expect(expenseDateCodec.toDateOnly(date)).toBe('0099-01-02');
  });

  it('rejects invalid dates when formatting', () => {
    expect(() => expenseDateCodec.toDateOnly(new Date(Number.NaN))).toThrow(
      'Cannot format an invalid expense date'
    );
  });
});
