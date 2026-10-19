import { describe, expect, it } from 'vitest';
import {
  formatPayoutOnlyCurrency,
  resolvePayoutOnlyCurrencyConfig,
} from './resolve-merchant-currency';

describe('resolvePayoutOnlyCurrencyConfig', () => {
  it('never substitutes the country currency for a blank payout', () => {
    // Mirrors merchant_resolved_currency: a US merchant with no payout
    // currency issues NGN-denominated codes, so labels resolve NGN.
    const config = resolvePayoutOnlyCurrencyConfig({
      country: 'US',
      payout_currency: '',
    });
    expect(config.code).toBe('NGN');
    expect(
      formatPayoutOnlyCurrency(100, { country: 'US', payout_currency: null })
    ).toContain('₦');
  });

  it('uses a valid payout currency regardless of country', () => {
    const config = resolvePayoutOnlyCurrencyConfig({
      country: 'US',
      payout_currency: ' ghs ',
    });
    expect(config.code).toBe('GHS');
  });
});
