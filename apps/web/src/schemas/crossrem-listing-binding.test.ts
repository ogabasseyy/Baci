import { describe, expect, it } from 'vitest';
import baseline from '@/app/api/partners/v1/catalog/ogabassey-listing-bindings.json';
import { sellableIdentityKey } from '@/app/api/partners/v1/catalog/sellable-identity-key';
import { crossRemListingBindingsSchema } from './crossrem-listing-binding';

describe('CrossRem listing bindings', () => {
  it('accepts the checked-in baseline', () => {
    const parsed = crossRemListingBindingsSchema.parse(baseline);
    expect(parsed).toEqual(baseline);

    const listingIds = new Set<string>();
    const activeIdentities = new Set<string>();
    for (const binding of parsed) {
      expect(listingIds.has(binding.listingId)).toBe(false);
      listingIds.add(binding.listingId);
      if (!binding.retired) {
        const key = sellableIdentityKey(binding);
        expect(activeIdentities.has(key)).toBe(false);
        activeIdentities.add(key);
      }
    }
  });

  it('rejects inconsistent condition fallbacks and ambiguous sellable identifiers', () => {
    const valid = baseline[0];
    for (const patch of [
      { condition: 'unknown' },
      { condition: 'used', assumeNewWhenMissing: true },
      { variantId: valid.productId, offerId: valid.productId },
    ]) {
      expect(
        crossRemListingBindingsSchema.safeParse([{ ...valid, ...patch }])
          .success
      ).toBe(false);
    }
  });
});
