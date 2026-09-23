import { describe, expect, it } from 'vitest';
import type { ShippingQuote } from '@/lib/shipping/types';
import { selectRepairPickupQuote } from './select-repair-pickup-quote';

function quote(price: number, isStationPickup = false): ShippingQuote {
  return {
    id: `q-${price}-${isStationPickup}`,
    provider: 'GIGL',
    serviceTier: 'GoStandard',
    carrierName: 'GIG Logistics',
    displayName: 'GIG Logistics - GoStandard',
    estimatedDays: 3,
    price,
    currency: 'NGN',
    pickupIncluded: true,
    insuranceIncluded: false,
    expiresAt: new Date('2099-09-01T12:00:00.000Z'),
    isStationPickup,
  };
}

describe('selectRepairPickupQuote', () => {
  it('selects the cheapest positive doorstep quote', () => {
    const result = selectRepairPickupQuote([
      quote(5000),
      quote(3000),
      quote(1000, true),
    ]);

    expect(result?.price).toBe(3000);
  });

  it('returns null when GIGL only offers service-centre delivery', () => {
    const result = selectRepairPickupQuote([quote(1000, true)]);

    expect(result).toBeNull();
  });

  it('ignores non-positive doorstep rates when a valid rate exists', () => {
    const result = selectRepairPickupQuote([
      quote(0),
      quote(-500),
      quote(3500),
    ]);

    expect(result?.price).toBe(3500);
  });

  it('returns null when every doorstep rate is non-positive', () => {
    const result = selectRepairPickupQuote([quote(0), quote(-500)]);

    expect(result).toBeNull();
  });
});
