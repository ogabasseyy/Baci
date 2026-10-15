import { describe, expect, it } from 'vitest';
import { selectPreferredQuote } from './select-preferred-quote';
import type { ShippingQuote } from './types';

describe('selectPreferredQuote', () => {
  const quote = (overrides: Partial<ShippingQuote>): ShippingQuote => ({
    id: '00000000-0000-4000-8000-000000000001',
    provider: 'GIGL',
    serviceTier: 'GoStandard',
    carrierName: 'GIGL',
    displayName: 'GoStandard',
    estimatedDays: 2,
    price: 100,
    currency: 'NGN',
    pickupIncluded: false,
    insuranceIncluded: false,
    expiresAt: new Date('2026-10-15T00:00:00Z'),
    ...overrides,
  });
  const standard = quote({ serviceTier: 'GoStandard', price: 100 });
  const faster = quote({
    id: '00000000-0000-4000-8000-000000000002',
    serviceTier: 'GoFaster',
    price: 200,
  });
  it('prefers the paid-fee candidate when no saved preference exists', () => {
    expect(
      selectPreferredQuote([standard, faster], {
        serviceTier: null,
        carrierName: null,
        providerRateId: null,
        samePrice: 200,
      })
    ).toBe(faster);
  });
  it('keeps provider ordering when no candidate matches the paid fee', () => {
    expect(
      selectPreferredQuote([standard, faster], {
        serviceTier: null,
        carrierName: null,
        providerRateId: null,
        samePrice: 999,
      })
    ).toBe(standard);
  });
  it('lets a saved preference win over the paid-fee fallback', () => {
    expect(
      selectPreferredQuote([standard, faster], {
        serviceTier: 'GoStandard',
        carrierName: null,
        providerRateId: null,
        samePrice: 200,
      })
    ).toBe(standard);
  });
});
