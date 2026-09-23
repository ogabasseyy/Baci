import { describe, expect, it } from 'vitest';
import { findQuoteByStableIdentity } from './find-quote-by-stable-identity';
import type { ShippingQuote } from './types';

function quote(
  overrides: Partial<ShippingQuote> & Pick<ShippingQuote, 'id'>,
): ShippingQuote {
  return {
    carrierName: 'GIG Logistics',
    currency: 'NGN',
    displayName: 'Standard',
    estimatedDays: 3,
    insuranceIncluded: true,
    pickupIncluded: true,
    price: 2000,
    provider: 'GIGL',
    serviceTier: 'Standard',
    ...overrides,
  };
}

describe('bugfix: restore carrier choices with a stable identity', () => {
  it('matches a refreshed quote by providerRateId when the UUID changed', () => {
    const quotes = [
      quote({ id: 'fresh-uuid-1', providerRateId: 'GIGL_30_0', price: 2000 }),
      quote({
        id: 'fresh-uuid-2',
        providerRateId: 'GIGL_30_1',
        displayName: 'Express',
        price: 4000,
        serviceTier: 'Express',
      }),
    ];

    const matched = findQuoteByStableIdentity(quotes, {
      quoteId: 'stale-uuid-before-refresh',
      providerRateId: 'GIGL_30_1',
    });

    expect(matched?.id).toBe('fresh-uuid-2');
  });

  it('still prefers an exact quote id when it is still present', () => {
    const quotes = [
      quote({ id: 'door-quote-2', providerRateId: 'GIGL_30_1' }),
    ];

    expect(
      findQuoteByStableIdentity(quotes, {
        quoteId: 'door-quote-2',
        providerRateId: 'other',
      })?.id,
    ).toBe('door-quote-2');
  });
});
