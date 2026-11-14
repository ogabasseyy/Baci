import { describe, expect, it } from 'vitest';
import { projectChatwootDeliveryOptions } from './delivery-options-projection';

const baseQuote = {
  id: 'mrate-private-id',
  provider: 'MERCHANT' as const,
  serviceTier: 'pickup',
  carrierName: 'Store pickup',
  displayName: 'Store pickup',
  estimatedDays: 0,
  price: 0,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
  providerRateId: 'private-provider-rate-id',
  rawResponse: { secret: 'do-not-return' },
  providerCost: 500,
  platformMargin: 100,
  marginBasisPoints: 200,
  pricingVersion: 'private-pricing-version',
  isStationPickup: true,
  stationName: 'Ikeja collection point',
  stationAddress: 'Ikeja, Lagos',
  stationInstructions: 'Ask at the store counter',
  expiresAt: new Date('2026-11-14T12:00:00.000Z'),
};

describe('projectChatwootDeliveryOptions', () => {
  it('returns bounded customer estimate fields and excludes provider economics', () => {
    const result = projectChatwootDeliveryOptions({
      state: 'Lagos',
      cartVersion: 4,
      currency: 'NGN',
      subtotalMinor: 250_000,
      quotes: [baseQuote],
    });

    expect(result).toEqual({
      state: 'Lagos',
      cartVersion: 4,
      currency: 'NGN',
      subtotalMinor: 250_000,
      options: [
        {
          displayName: 'Store pickup',
          priceMajor: 0,
          currency: 'NGN',
          estimatedDays: 0,
          pickup: true,
          pickupLocation: 'Ikeja collection point · Ikeja, Lagos',
          pickupInstructions: 'Ask at the store counter',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private-provider-rate-id');
    expect(JSON.stringify(result)).not.toContain('do-not-return');
    expect(JSON.stringify(result)).not.toContain('providerCost');
    expect(JSON.stringify(result)).not.toContain('pricingVersion');
  });

  it('refuses carrier quotes, currency mismatch, and precision the customer display cannot represent', () => {
    const input = {
      state: 'Lagos',
      cartVersion: 4,
      currency: 'NGN',
      subtotalMinor: 250_000,
    };
    expect(
      projectChatwootDeliveryOptions({
        ...input,
        quotes: [{ ...baseQuote, provider: 'GIGL' as const }],
      })
    ).toBeNull();
    expect(
      projectChatwootDeliveryOptions({
        ...input,
        quotes: [{ ...baseQuote, currency: 'USD' }],
      })
    ).toBeNull();
    expect(
      projectChatwootDeliveryOptions({
        ...input,
        quotes: [{ ...baseQuote, price: 1.001 }],
      })
    ).toBeNull();
  });
});
