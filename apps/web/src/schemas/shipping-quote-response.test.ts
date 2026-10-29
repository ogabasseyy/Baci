import { describe, expect, it } from 'vitest';
import {
  normalizeShippingQuoteResponsePayload,
  shippingQuoteApiResponseSchema,
} from './shipping-quote-response';

const shippingQuote = {
  id: 'quote-1',
  provider: 'GIGL',
  serviceTier: 'standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 2,
  price: 2500,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: true,
} as const;

describe('shippingQuoteApiResponseSchema', () => {
  it.each([
    'supported',
    'unsupported',
    'unavailable',
  ])('preserves explicit home delivery coverage (%s) for the checkout', (homeDeliveryCoverage) => {
    const result = normalizeShippingQuoteResponsePayload({
      quotes: [{ ...shippingQuote, homeDeliveryCoverage }],
    });
    expect(result.quotes[0]).toHaveProperty(
      'homeDeliveryCoverage',
      homeDeliveryCoverage
    );
  });
  it('parses the nested quote response envelope', () => {
    expect(
      normalizeShippingQuoteResponsePayload({
        quotes: { featured: [shippingQuote], all: [shippingQuote] },
        sessionId: 'session-1',
        warnings: ['Address was normalized'],
      })
    ).toEqual({
      quotes: [shippingQuote],
      sessionId: 'session-1',
      warnings: ['Address was normalized'],
    });
  });

  it('keeps legacy top-level quote arrays', () => {
    expect(
      normalizeShippingQuoteResponsePayload({ quotes: [shippingQuote] })
    ).toEqual({
      quotes: [shippingQuote],
      sessionId: '',
      warnings: [],
    });
  });

  it('filters malformed quotes and warning values', () => {
    expect(
      normalizeShippingQuoteResponsePayload({
        quotes: { all: [{ id: 123 }, shippingQuote] },
        sessionId: 123,
        warnings: [null, '', 'usable warning'],
      })
    ).toEqual({
      quotes: [shippingQuote],
      sessionId: '',
      warnings: ['', 'usable warning'],
    });
  });

  it('drops quotes that only provide id without required shipping fields', () => {
    expect(
      normalizeShippingQuoteResponsePayload({
        quotes: { all: [{ id: 'incomplete-quote' }, shippingQuote] },
      })
    ).toEqual({
      quotes: [shippingQuote],
      sessionId: '',
      warnings: [],
    });
  });

  it('keeps quotes with nullable optional database-backed fields', () => {
    expect(
      normalizeShippingQuoteResponsePayload({
        quotes: {
          all: [
            {
              ...shippingQuote,
              deliveryRange: null,
              minDays: null,
              maxDays: null,
              isStationPickup: null,
              stationName: null,
              stationAddress: null,
              providerRateId: null,
            },
          ],
        },
      })
    ).toEqual({
      quotes: [shippingQuote],
      sessionId: '',
      warnings: [],
    });
  });

  it('returns defaults for non-object responses', () => {
    expect(normalizeShippingQuoteResponsePayload(null)).toEqual({
      quotes: [],
      sessionId: '',
      warnings: [],
    });
  });

  it('exposes a safeParse schema for direct boundary validation', () => {
    expect(
      shippingQuoteApiResponseSchema.safeParse({
        quotes: { all: [shippingQuote] },
      }).success
    ).toBe(true);
  });

  it('keeps merchant-configured rate quotes (provider MERCHANT)', () => {
    const merchantQuote = {
      ...shippingQuote,
      id: 'mrate_55555555-5555-4555-8555-555555555555',
      provider: 'MERCHANT',
      carrierName: 'Standard Delivery',
      displayName: 'Standard Delivery',
      estimatedDays: 0,
      price: 1500,
    };

    expect(
      normalizeShippingQuoteResponsePayload({
        quotes: { all: [merchantQuote, shippingQuote] },
      })
    ).toEqual({
      quotes: [merchantQuote, shippingQuote],
      sessionId: '',
      warnings: [],
    });
  });

  it('carries pickup station instructions through normalization', () => {
    const pickupQuote = {
      ...shippingQuote,
      id: 'mrate_55555555-5555-4555-8555-555555555555',
      provider: 'MERCHANT',
      isStationPickup: true,
      stationName: 'Ikeja Store',
      stationAddress: '12 Allen Avenue, Ikeja, Lagos',
      stationInstructions: 'Ring the bell twice and ask for Ada',
    };

    const { quotes } = normalizeShippingQuoteResponsePayload({
      quotes: { all: [pickupQuote] },
    });

    expect(quotes[0]?.stationInstructions).toBe(
      'Ring the bell twice and ask for Ada'
    );
  });

  it('drops quotes with unknown provider codes', () => {
    expect(
      normalizeShippingQuoteResponsePayload({
        quotes: { all: [{ ...shippingQuote, provider: 'BOGUS' }] },
      })
    ).toEqual({
      quotes: [],
      sessionId: '',
      warnings: [],
    });
  });
});
