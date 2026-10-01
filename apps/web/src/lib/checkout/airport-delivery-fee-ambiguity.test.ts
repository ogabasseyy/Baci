import { describe, expect, it } from 'vitest';
import { isAmbiguousMetadataFreeAirportFee } from './airport-delivery-fee-ambiguity';

describe('isAmbiguousMetadataFreeAirportFee', () => {
  it('flags the legacy fixed amount when no delivery metadata is present', () => {
    expect(isAmbiguousMetadataFreeAirportFee({ shippingFee: 25_000 })).toBe(
      true
    );
  });

  it('flags the airport-pickup fee when no delivery metadata is present', () => {
    expect(isAmbiguousMetadataFreeAirportFee({ shippingFee: 20_000 })).toBe(
      true
    );
  });

  it('flags the current airport-delivery fee when no delivery metadata is present', () => {
    expect(isAmbiguousMetadataFreeAirportFee({ shippingFee: 35_000 })).toBe(
      true
    );
  });

  it('does not classify an explicitly non-airport order from its fee', () => {
    expect(
      isAmbiguousMetadataFreeAirportFee({
        deliveryMethod: 'door',
        shippingFee: 25_000,
      })
    ).toBe(false);
  });
});
