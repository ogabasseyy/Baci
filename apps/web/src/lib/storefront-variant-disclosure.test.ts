import { describe, expect, it } from 'vitest';
import { getVariantConnectivityDisclosure } from './storefront-variant-disclosure';

describe('storefront-variant-disclosure', () => {
  it('returns a disclosure message for restricted Wi-Fi only variants', () => {
    expect(
      getVariantConnectivityDisclosure({
        id: 'v1',
        attributes: { sim_type: 'Wi-Fi Only' },
      })
    ).toBe(
      'Listed as Wi-Fi only. Do not assume cellular service support; confirm connectivity limitations before purchase.'
    );
  });

  it('returns undefined for non-restricted variants', () => {
    expect(
      getVariantConnectivityDisclosure({
        id: 'v2',
        attributes: { sim_type: 'Physical + eSIM' },
      })
    ).toBeUndefined();
  });
});
