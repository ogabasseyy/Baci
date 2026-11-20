import { describe, expect, it } from 'vitest';
import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import { seedBindingCandidates } from './seed-bindings';

const row: GoogleMerchantListing = {
  id: 'google-family',
  product: {
    id: 'family',
    name: 'Phone',
    description: '',
    price: 100,
    stock: 1,
  },
  variant: { id: 'sku', condition: 'open_box' },
  title: 'Phone',
  imageUrl: 'https://example.test/phone.jpg',
  url: 'https://example.test/phone',
  price: 100,
  stock: 1,
};

describe('seedBindingCandidates', () => {
  it('produces reviewable candidates with the Google ID and exact SKU', () => {
    expect(seedBindingCandidates([row])).toEqual({
      bindings: [
        {
          listingId: 'google-family',
          productId: 'family',
          variantId: 'sku',
          condition: 'open_box',
        },
      ],
      unresolved_listing_ids: [],
    });
  });

  it('flags distinct Google IDs for the same sellable SKU', () => {
    expect(
      seedBindingCandidates([row, { ...row, id: 'google-alias' }])
    ).toEqual({
      bindings: [],
      unresolved_listing_ids: ['google-alias', 'google-family'],
    });
  });

  it('flags unknown conditions and repeated Google IDs for review', () => {
    expect(
      seedBindingCandidates([
        { ...row, id: 'unknown', variant: undefined },
        row,
        { ...row, variant: { ...row.variant, id: 'other' } },
      ])
    ).toEqual({
      bindings: [],
      unresolved_listing_ids: ['google-family', 'unknown'],
    });
  });
});
