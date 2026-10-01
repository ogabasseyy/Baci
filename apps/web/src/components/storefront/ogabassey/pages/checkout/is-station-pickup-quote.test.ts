import { describe, expect, it } from 'vitest';
import { isStationPickupQuote } from './is-station-pickup-quote';
import type { ShippingQuote } from './types';

const quote: ShippingQuote = {
  id: 'quote-1',
  provider: 'GIGL',
  serviceTier: 'standard',
  carrierName: 'GIGL',
  displayName: 'GIGL Standard',
  estimatedDays: 2,
  price: 3500,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: false,
};

describe('isStationPickupQuote', () => {
  it('recognizes station-pickup quotes', () => {
    expect(isStationPickupQuote({ ...quote, isStationPickup: true })).toBe(
      true
    );
  });

  it('rejects regular delivery quotes', () => {
    expect(isStationPickupQuote(quote)).toBe(false);
  });
});
