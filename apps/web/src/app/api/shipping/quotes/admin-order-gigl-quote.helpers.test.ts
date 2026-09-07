import { describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/lib/shipping/types';
import {
  calculateAdminWalletFunding,
  selectEligibleAdminGiglQuote,
} from './admin-order-gigl-quote.helpers';

const baseQuote = {
  provider: 'GIGL',
  currency: 'NGN',
  isStationPickup: false,
} as ShippingQuote;

describe('admin-order-gigl-quote.helpers', () => {
  it('selects the cheapest eligible GIGL quote', () => {
    expect(
      selectEligibleAdminGiglQuote([
        { ...baseQuote, price: 2_500 },
        { ...baseQuote, price: 1_800 },
      ])
    ).toMatchObject({ price: 1_800 });
  });

  it('calculates wallet shortfall for admin booking', () => {
    expect(calculateAdminWalletFunding(10_000, 12_000)).toEqual({
      availableBalance: 12_000,
      shortfall: 0,
      canBook: true,
    });
  });
});
