import { describe, expect, it } from 'vitest';
import { isEligibleAirportQuote } from '@/lib/checkout/airport-delivery-quote-validation';

describe('airport delivery quote validation helpers', () => {
  it('accepts a local GIGL GoFaster home-delivery quote', () => {
    expect(
      isEligibleAirportQuote(
        {
          provider: 'GIGL',
          provider_rate_id: 'GIGL_30_0_1_0_1_4',
          service_tier: 'GoFaster',
        },
        'gigl'
      )
    ).toBe(true);
  });

  it('rejects an international rate even when its fee metadata resembles GoFaster', () => {
    expect(
      isEligibleAirportQuote(
        {
          provider: 'GIGL',
          provider_rate_id: 'GIGL_INTL_2_0_0_1',
        },
        'GIGL'
      )
    ).toBe(false);
  });
});
