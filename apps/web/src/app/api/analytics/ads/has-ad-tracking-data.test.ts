import { describe, expect, it } from 'vitest';
import { hasAdTrackingData } from './has-ad-tracking-data';

describe('hasAdTrackingData', () => {
  it('does not count discount provenance metadata as ad tracking', () => {
    const input = {
      baci_transaction_discount: {
        lineDiscounts: [],
        version: 2,
      },
    };

    const result = hasAdTrackingData(input);

    expect(result).toBe(false);
  });

  it('counts ordinary attribution fields', () => {
    const input = { fbclid: 'fb-1' };

    const result = hasAdTrackingData(input);

    expect(result).toBe(true);
  });
});
