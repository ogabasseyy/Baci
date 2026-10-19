import { describe, expect, it } from 'vitest';
import { calculateDeliveryCost } from './calculate-delivery-cost';
import { isGiglGoFasterQuote } from './is-gigl-go-faster-quote';
import { isStationPickupQuote } from './is-station-pickup-quote';
import type { ShippingQuote } from './types';

const roadQuote: ShippingQuote = {
  id: 'road-quote',
  provider: 'TOPSHIP',
  serviceTier: 'standard',
  carrierName: 'Topship',
  displayName: 'Topship Standard',
  estimatedDays: 3,
  price: 3500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
};

const airQuote: ShippingQuote = {
  ...roadQuote,
  id: 'air-quote',
  provider: 'GIGL',
  serviceTier: 'GoFaster',
  price: 18500,
};

describe('calculateDeliveryCost', () => {
  it('uses the fixed 35,000 airport delivery fee without an air quote', () => {
    expect(calculateDeliveryCost('airport', '', [], 'delivery')).toBe(35_000);
  });

  it('uses the fixed 20,000 airport pickup fee without an air quote', () => {
    expect(calculateDeliveryCost('airport', '', [], 'pickup')).toBe(20_000);
  });

  it('uses a selected GIGL GoFaster quote for airport delivery', () => {
    expect(
      calculateDeliveryCost('airport', 'air-quote', [airQuote], 'delivery')
    ).toBe(18500);
  });

  it('returns the selected road quote price', () => {
    expect(
      calculateDeliveryCost('door', 'road-quote', [roadQuote], 'delivery')
    ).toBe(3500);
  });
});

describe('delivery quote predicates', () => {
  it('identifies station and GoFaster quotes', () => {
    expect(isStationPickupQuote({ ...roadQuote, isStationPickup: true })).toBe(
      true
    );
    expect(isGiglGoFasterQuote(airQuote)).toBe(true);
    expect(isGiglGoFasterQuote(roadQuote)).toBe(false);
  });
});
