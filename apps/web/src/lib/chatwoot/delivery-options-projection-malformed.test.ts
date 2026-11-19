import { describe, expect, it } from 'vitest';
import { projectChatwootDeliveryOptions } from './delivery-options-projection';

const quote = {
  id: 'mrate-1',
  provider: 'MERCHANT' as const,
  serviceTier: 'standard',
  carrierName: 'Merchant delivery',
  displayName: 'Merchant delivery',
  estimatedDays: 2,
  price: 1500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
  providerRateId: 'rate-1',
  rawResponse: {},
  providerCost: 0,
  platformMargin: 0,
  marginBasisPoints: 0,
  pricingVersion: 'v1',
  isStationPickup: false,
  expiresAt: new Date('2026-11-14T12:00:00.000Z'),
};

const input = {
  state: 'Lagos',
  cartVersion: 3,
  currency: 'NGN',
  subtotalMinor: 100_000,
};

describe('bugfix: malformed merchant quote currency must not throw', () => {
  it.each([
    undefined,
    null,
    42,
    {},
  ])('drops a quote whose currency is %s instead of throwing', (currency) => {
    const malformed = { ...quote, currency } as unknown as typeof quote;

    expect(() =>
      projectChatwootDeliveryOptions({ ...input, quotes: [malformed] })
    ).not.toThrow();
    expect(
      projectChatwootDeliveryOptions({ ...input, quotes: [malformed] })
    ).toBeNull();
  });

  it('still returns the valid quotes next to a malformed one', () => {
    const malformed = { ...quote, currency: null } as unknown as typeof quote;

    const result = projectChatwootDeliveryOptions({
      ...input,
      quotes: [malformed, quote],
    });

    expect(result?.options).toHaveLength(1);
  });
});
