import { describe, expect, it } from 'vitest';
import { resolveTrackingCurrency } from './resolve-tracking-currency';

describe('resolveTrackingCurrency', () => {
  it('prefers the payout currency', () => {
    expect(
      resolveTrackingCurrency({ country: 'NG', payout_currency: 'gbp' })
    ).toBe('GBP');
  });

  it('falls back to the merchant country currency', () => {
    expect(resolveTrackingCurrency({ country: 'GH' })).toBe('GHS');
  });

  it('falls back to NGN when the merchant is unknown', () => {
    expect(resolveTrackingCurrency(null)).toBe('NGN');
  });
});
