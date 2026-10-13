import { describe, expect, it } from 'vitest';
import { parseOptionalOrderAmount } from './order-money';

describe('parseOptionalOrderAmount', () => {
  it('parses persisted numeric and numeric-string amounts', () => {
    expect(parseOptionalOrderAmount(1250)).toBe(1250);
    expect(parseOptionalOrderAmount('1250.50')).toBe(1250.5);
  });

  it('returns undefined for nullish, blank, and non-finite amounts', () => {
    expect(parseOptionalOrderAmount(null)).toBeUndefined();
    expect(parseOptionalOrderAmount(undefined)).toBeUndefined();
    expect(parseOptionalOrderAmount('   ')).toBeUndefined();
    expect(parseOptionalOrderAmount('not-a-number')).toBeUndefined();
    expect(parseOptionalOrderAmount('1000junk')).toBeUndefined();
    expect(parseOptionalOrderAmount(Number.NaN)).toBeUndefined();
    expect(parseOptionalOrderAmount(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
