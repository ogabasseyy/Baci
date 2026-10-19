import { describe, expect, it } from 'vitest';
import { toPublicQuoteResponse } from './public-quote-response';

describe('toPublicQuoteResponse', () => {
  it('redacts raw provider data and internal economics', () => {
    const response = toPublicQuoteResponse({
      sessionId: 's',
      expiresAt: new Date().toISOString(),
      quotes: {
        featured: [
          {
            id: 'q',
            provider: 'GIGL',
            serviceTier: 'x',
            carrierName: 'G',
            displayName: 'G',
            estimatedDays: 1,
            price: 11000,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            expiresAt: new Date(),
            rawResponse: { secret: true },
            providerCost: 10000,
            platformMargin: 1000,
            marginBasisPoints: 1000,
            pricingVersion: 'gigl_platform_margin_v1',
          },
        ],
        all: [],
      },
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toMatch(
      /providerCost|platformMargin|marginBasisPoints|pricingVersion|rawResponse/
    );
    expect(response.quotes.featured[0]?.price).toBe(11000);
  });
});
