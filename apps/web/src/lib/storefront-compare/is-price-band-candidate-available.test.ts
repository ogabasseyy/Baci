import { describe, expect, it } from 'vitest';
import { isPriceBandCandidateAvailable } from './is-price-band-candidate-available';

describe('isPriceBandCandidateAvailable', () => {
  it('returns true when all availability fields are omitted (legacy fixtures)', () => {
    expect(
      isPriceBandCandidateAvailable({
        slug: 'phone-1',
        name: 'Phone 1',
        price: 100_000,
      })
    ).toBe(true);
  });

  it('returns true when product has condition offers, regardless of direct stock', () => {
    expect(
      isPriceBandCandidateAvailable({
        slug: 'phone-1',
        name: 'Phone 1',
        price: 100_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: true,
      })
    ).toBe(true);
  });

  it('returns false when manage_stock is true and stock is 0 without condition offers', () => {
    expect(
      isPriceBandCandidateAvailable({
        slug: 'phone-1',
        name: 'Phone 1',
        price: 100_000,
        stock: 0,
        manage_stock: true,
        has_condition_offers: false,
      })
    ).toBe(false);
  });

  it('returns true when manage_stock is false and stock is 0 (unmanaged inventory)', () => {
    expect(
      isPriceBandCandidateAvailable({
        slug: 'phone-1',
        name: 'Phone 1',
        price: 100_000,
        stock: 0,
        manage_stock: false,
        has_condition_offers: false,
      })
    ).toBe(true);
  });

  it('handles string stock quantities cleanly', () => {
    expect(
      isPriceBandCandidateAvailable({
        slug: 'phone-1',
        name: 'Phone 1',
        price: 100_000,
        stock: '5',
        manage_stock: true,
      })
    ).toBe(true);

    expect(
      isPriceBandCandidateAvailable({
        slug: 'phone-1',
        name: 'Phone 1',
        price: 100_000,
        stock: '0',
        manage_stock: true,
      })
    ).toBe(false);
  });
});
