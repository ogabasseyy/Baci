import { describe, expect, it } from 'vitest';
import { toPublicQuoteResponse } from './public-quote-response';

describe('shipping quotes GIGL margin response contract', () => {
  it('returns the bundled price while omitting internal economics', () => {
    const response = toPublicQuoteResponse({
      sessionId: 'session',
      expiresAt: new Date().toISOString(),
      quotes: {
        featured: [],
        all: [
          {
            id: 'quote',
            provider: 'GIGL',
            serviceTier: 'GoStandard',
            carrierName: 'GIG Logistics',
            displayName: 'GIG Logistics - GoStandard',
            estimatedDays: 2,
            price: 11000,
            currency: 'NGN',
            pickupIncluded: true,
            insuranceIncluded: true,
            expiresAt: new Date(),
            providerCost: 10000,
            platformMargin: 1000,
            marginBasisPoints: 1000,
            pricingVersion: 'gigl_platform_margin_v1',
            rawResponse: { GrandTotal: 10000 },
          },
        ],
      },
    });
    expect(response.quotes.all[0]?.price).toBe(11000);
    expect(response.quotes.all[0]).not.toHaveProperty('providerCost');
    expect(response.quotes.all[0]).not.toHaveProperty('rawResponse');
  });
});
