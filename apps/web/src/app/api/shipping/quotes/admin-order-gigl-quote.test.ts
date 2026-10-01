import { describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/lib/shipping/types';
import {
  calculateAdminWalletFunding,
  selectEligibleAdminGiglQuote,
} from './admin-order-gigl-quote';

function quote(overrides: Partial<ShippingQuote> = {}): ShippingQuote {
  return {
    id: 'quote-1',
    provider: 'GIGL',
    serviceTier: 'Standard',
    carrierName: 'GIG Logistics',
    displayName: 'Standard Delivery',
    estimatedDays: 2,
    price: 10_000,
    currency: 'NGN',
    pickupIncluded: true,
    insuranceIncluded: true,
    expiresAt: new Date('2026-09-02T10:00:00.000Z'),
    ...overrides,
  };
}

describe('selectEligibleAdminGiglQuote', () => {
  it('chooses the cheapest eligible address-delivery GIGL quote', () => {
    expect(
      selectEligibleAdminGiglQuote([
        quote({ id: 'pickup', price: 1_000, isStationPickup: true }),
        quote({ id: 'expensive', price: 15_000 }),
        quote({ id: 'cheapest', price: 8_000 }),
      ])?.id
    ).toBe('cheapest');
  });

  it('returns null when no positive NGN address quote is available', () => {
    expect(
      selectEligibleAdminGiglQuote([
        quote({ currency: 'USD' }),
        quote({ price: 0 }),
        quote({ isStationPickup: true }),
      ])
    ).toBeNull();
  });
});

describe('calculateAdminWalletFunding', () => {
  it('reports available balance and shortfall without allowing invalid balances', () => {
    expect(calculateAdminWalletFunding(10_000, Number.NaN)).toEqual({
      availableBalance: 0,
      shortfall: 10_000,
      canBook: false,
    });
    expect(calculateAdminWalletFunding(10_000, 12_000)).toEqual({
      availableBalance: 12_000,
      shortfall: 0,
      canBook: true,
    });
  });
});
