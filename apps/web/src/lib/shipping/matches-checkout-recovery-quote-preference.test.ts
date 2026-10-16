import { describe, expect, it } from 'vitest';
import { matchesCheckoutRecoveryQuotePreference } from './matches-checkout-recovery-quote-preference';
import type { ShippingQuote } from './types';

const quote: ShippingQuote = {
  id: '70000000-0000-4000-8000-000000000001',
  provider: 'GIGL',
  serviceTier: 'GoStandard',
  carrierName: 'GIG Logistics',
  displayName: 'GoStandard',
  price: 110,
  currency: 'NGN',
  estimatedDays: 2,
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date('2099-01-01'),
  providerRateId: 'GIGL_30_0_1_0_0_4',
};
const preference = {
  service_tier: 'standard',
  carrier_name: 'GIGL',
  provider_rate_id: null,
};

describe('matchesCheckoutRecoveryQuotePreference', () => {
  it.each([
    'standard',
    ' GoStandard ',
    'STANDARD',
  ])('accepts the known standard alias %s', (service_tier) => {
    expect(
      matchesCheckoutRecoveryQuotePreference(quote, {
        ...preference,
        service_tier,
      })
    ).toBe(true);
  });
  it('accepts a verified stable legacy rate despite obsolete display labels', () => {
    expect(
      matchesCheckoutRecoveryQuotePreference(quote, {
        service_tier: 'Old label',
        carrier_name: 'Old label',
        provider_rate_id: 'GIGL_30_0_1',
      })
    ).toBe(true);
  });
  it('keeps exact saved provider-rate selection', () => {
    expect(
      matchesCheckoutRecoveryQuotePreference(quote, {
        ...preference,
        service_tier: null,
        provider_rate_id: quote.providerRateId ?? null,
      })
    ).toBe(true);
  });
  it.each([
    { ...preference, service_tier: 'GoFaster' },
    { ...preference, service_tier: 'express' },
    { ...preference, service_tier: 'unknown' },
    { ...preference, carrier_name: 'Another carrier' },
    {
      ...preference,
      service_tier: null,
      provider_rate_id: 'GIGL_30_0_1_0_1_4',
    },
    { ...preference, service_tier: null, provider_rate_id: 'malformed' },
  ])('rejects a different or unverified service %j', (saved) => {
    expect(matchesCheckoutRecoveryQuotePreference(quote, saved)).toBe(false);
  });
  it('allows paid-fee selection when no preference survives', () => {
    expect(matchesCheckoutRecoveryQuotePreference(quote, null)).toBe(true);
    expect(
      matchesCheckoutRecoveryQuotePreference(quote, {
        service_tier: null,
        carrier_name: null,
        provider_rate_id: null,
      })
    ).toBe(true);
  });
  it.each([
    'GIGL_30_0_1_0_bad_4',
    'GIGL_30_bad_1_0_0_4',
    'GIGL_30_0_9_0_0_4',
    'GIGL_30_0_1_-1_0_4',
    'GIGL_30_0_1_0_0_bad',
    'GIGL_30_0_1_0_0_4_extra',
    'GIGL_9007199254740993_0_1_0_0_4',
  ])('does not treat malformed fields as verified rate identity %s', (provider_rate_id) => {
    expect(
      matchesCheckoutRecoveryQuotePreference(quote, {
        service_tier: 'Unknown',
        carrier_name: 'Unknown',
        provider_rate_id,
      })
    ).toBe(false);
  });
  it('validates the candidate rate as well as the saved rate', () => {
    expect(
      matchesCheckoutRecoveryQuotePreference(
        { ...quote, providerRateId: 'GIGL_30_0_1_0_bad_4' },
        {
          service_tier: 'Unknown',
          carrier_name: 'Unknown',
          provider_rate_id: 'GIGL_30_0_1',
        }
      )
    ).toBe(false);
  });
});
