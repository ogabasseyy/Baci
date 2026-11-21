import { describe, expect, it } from 'vitest';
import { toKobo } from './to-kobo';

describe('toKobo', () => {
  it('converts numbers and numeric strings to kobo', () => {
    expect(toKobo(9835.58)).toBe(983_558);
    expect(toKobo('9835.58')).toBe(983_558);
  });

  it.each([
    [1.005, 101],
    ['1.005', 101],
    ['1.0049999999999999999', 100],
    ['.005', 1],
    ['1005e-3', 101],
    [1e-7, 0],
    ['90071992547409.905', Number.MAX_SAFE_INTEGER],
  ])('rounds %s exactly to %d kobo', (amount, kobo) => {
    expect(toKobo(amount)).toBe(kobo);
  });

  it('returns null for missing, blank, non-finite or non-positive values', () => {
    for (const value of [
      null,
      undefined,
      '',
      '  ',
      'abc',
      0,
      -1,
      Number.NaN,
      '90071992547409.915',
    ]) {
      expect(toKobo(value)).toBeNull();
    }
  });
});
