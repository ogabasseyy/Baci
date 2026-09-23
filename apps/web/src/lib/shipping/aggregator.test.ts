import { describe, expect, it } from 'vitest';
import { rankQuotes, selectFeaturedQuotes } from './aggregator';
import type { ShippingQuote } from './types';

const successfulQuote = {
  id: 'gigl-quote-1',
  provider: 'GIGL' as const,
  serviceTier: 'Standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 3,
  price: 5000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date(Date.now() + 60_000),
};

describe('rankQuotes', () => {
  function buildQuote(overrides: Partial<ShippingQuote>): ShippingQuote {
    return {
      ...successfulQuote,
      ...overrides,
    } as ShippingQuote;
  }

  it('does not rank an unknown-ETA merchant rate ahead of a cheaper known-ETA carrier', () => {
    // A merchant rate with no configured delivery days carries estimatedDays: 0
    // (the unknown-ETA sentinel). It must NOT be scored as 0-day/fastest and
    // out-rank a cheaper carrier with a real ETA — `quotes.all` ordering drives
    // checkout's first-door-quote auto-select.
    const unknownEtaMerchantRate = buildQuote({
      id: 'mrate_1',
      provider: 'MERCHANT',
      carrierName: 'Store Delivery',
      displayName: 'Store Delivery',
      estimatedDays: 0,
      price: 5000,
    });
    const cheaperKnownEtaCarrier = buildQuote({
      id: 'courier-1',
      carrierName: 'Local Courier',
      displayName: 'Local Courier',
      estimatedDays: 3,
      price: 4000,
    });

    const ranked = rankQuotes([unknownEtaMerchantRate, cheaperKnownEtaCarrier]);

    expect(ranked[0].id).toBe('courier-1');
    expect(ranked[1].id).toBe('mrate_1');
  });

  it('keeps a cheaper known-ETA merchant rate ahead of a pricier carrier', () => {
    // The penalty only applies to the unknown-ETA sentinel; a merchant rate
    // with a real ETA is scored normally and still wins when it is cheaper.
    const cheapMerchantRate = buildQuote({
      id: 'mrate_2',
      provider: 'MERCHANT',
      carrierName: 'Store Delivery',
      displayName: 'Store Delivery',
      estimatedDays: 2,
      price: 1000,
    });
    const carrierQuote = buildQuote({
      id: 'courier-2',
      carrierName: 'Local Courier',
      displayName: 'Local Courier',
      estimatedDays: 3,
      price: 5000,
    });

    const ranked = rankQuotes([carrierQuote, cheapMerchantRate]);

    expect(ranked[0].id).toBe('mrate_2');
  });
});

describe('selectFeaturedQuotes', () => {
  function buildQuote(overrides: Partial<ShippingQuote>): ShippingQuote {
    return {
      ...successfulQuote,
      ...overrides,
    } as ShippingQuote;
  }

  it('returns an empty list when there are no quotes', () => {
    expect(selectFeaturedQuotes([])).toEqual([]);
  });

  it('lets a merchant-rate quote win the cheapest bucket', () => {
    const merchantQuote = buildQuote({
      id: 'mrate_1',
      provider: 'MERCHANT',
      carrierName: 'Standard Delivery',
      displayName: 'Standard Delivery',
      estimatedDays: 2,
      price: 1000,
    });
    const carrierQuote = buildQuote({ id: 'gigl-1', price: 5000 });

    const featured = selectFeaturedQuotes([carrierQuote, merchantQuote]);

    expect(featured[0]).toMatchObject({
      id: 'mrate_1',
      displayName: expect.stringContaining('Economy Delivery'),
    });
  });

  it('never selects a 0-estimatedDays quote as the fastest pick', () => {
    const unEstimatedMerchantQuote = buildQuote({
      id: 'mrate_1',
      provider: 'MERCHANT',
      estimatedDays: 0,
      price: 1000,
    });
    const fastCarrierQuote = buildQuote({
      id: 'gigl-fast',
      estimatedDays: 2,
      price: 6000,
    });
    const slowCarrierQuote = buildQuote({
      id: 'gigl-slow',
      estimatedDays: 5,
      price: 4000,
    });

    const featured = selectFeaturedQuotes([
      unEstimatedMerchantQuote,
      fastCarrierQuote,
      slowCarrierQuote,
    ]);

    const express = featured.find((quote) =>
      quote.displayName.includes('Express Delivery')
    );
    expect(express).toMatchObject({ id: 'gigl-fast', estimatedDays: 2 });
  });

  it('omits the fastest bucket entirely when every candidate lacks an estimate', () => {
    const cheapQuote = buildQuote({
      id: 'mrate_1',
      provider: 'MERCHANT',
      estimatedDays: 0,
      price: 1000,
    });
    const otherQuote = buildQuote({
      id: 'mrate_2',
      provider: 'MERCHANT',
      estimatedDays: 0,
      price: 2000,
    });

    const featured = selectFeaturedQuotes([cheapQuote, otherQuote]);

    expect(featured).toHaveLength(2);
    expect(
      featured.some((quote) => quote.displayName.includes('Express Delivery'))
    ).toBe(false);
  });
});
