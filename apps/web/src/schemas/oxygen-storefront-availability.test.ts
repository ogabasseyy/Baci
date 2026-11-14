import { describe, expect, it } from 'vitest';
import { oxygenStorefrontAvailabilityQuery } from './oxygen-storefront-availability';

describe('Oxygen storefront availability query', () => {
  it('requires a merchant UUID', () => {
    expect(
      oxygenStorefrontAvailabilityQuery.safeParse({
        merchantId: 'f1ab0000-0000-4000-8000-000000000011',
      }).success
    ).toBe(true);
    expect(
      oxygenStorefrontAvailabilityQuery.safeParse({ merchantId: 'not-a-uuid' })
        .success
    ).toBe(false);
    expect(oxygenStorefrontAvailabilityQuery.safeParse({}).success).toBe(false);
  });
});
