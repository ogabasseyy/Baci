import { describe, expect, it } from 'vitest';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import type { ShippingQuote } from './types';

const quote: ShippingQuote = {
  id: 'quote-1',
  provider: 'GIGL',
  serviceTier: 'GoFaster',
  carrierName: 'GIGL',
  displayName: 'GIGL GoFaster',
  estimatedDays: 1,
  price: 18_500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
};

describe('isGiglGoFasterQuote', () => {
  it('recognizes GIGL GoFaster quotes', () => {
    expect(isGiglGoFasterQuote(quote)).toBe(true);
  });

  it('rejects station-pickup and non-GoFaster quotes', () => {
    expect(isGiglGoFasterQuote({ ...quote, isStationPickup: true })).toBe(
      false
    );
    expect(isGiglGoFasterQuote({ ...quote, serviceTier: 'standard' })).toBe(
      false
    );
    expect(isGiglGoFasterQuote(undefined)).toBe(false);
  });
});
