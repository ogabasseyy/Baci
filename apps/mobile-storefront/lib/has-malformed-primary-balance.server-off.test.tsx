import { describe, expect, it } from '@jest/globals';
import { hasMalformedPrimaryBalance } from './has-malformed-primary-balance';

describe('hasMalformedPrimaryBalance', () => {
  it('is false with the server keeping PiggyVest off (no balance sent)', () => {
    expect(hasMalformedPrimaryBalance({})).toBe(false);
    expect(hasMalformedPrimaryBalance(null)).toBe(false);
  });

  it('is false for a valid PiggyVest balance', () => {
    expect(hasMalformedPrimaryBalance({ primary_balance_kobo: 0 })).toBe(false);
  });

  it('is true for a negative or non-finite balance', () => {
    expect(hasMalformedPrimaryBalance({ primary_balance_kobo: -1 })).toBe(true);
    expect(
      hasMalformedPrimaryBalance({ primary_balance_kobo: Number.NaN })
    ).toBe(true);
  });
});
