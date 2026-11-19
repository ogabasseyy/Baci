import { describe, expect, it } from 'vitest';
import { toKobo } from './to-kobo';

describe('toKobo', () => {
  it('converts numbers and numeric strings to kobo', () => {
    expect(toKobo(9835.58)).toBe(983_558);
    expect(toKobo('9835.58')).toBe(983_558);
  });

  it('returns null for missing, blank, non-finite or non-positive values', () => {
    for (const value of [null, undefined, '', '  ', 'abc', 0, -1, Number.NaN]) {
      expect(toKobo(value)).toBeNull();
    }
  });
});
