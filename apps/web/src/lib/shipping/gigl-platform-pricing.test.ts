import { describe, expect, it } from 'vitest';
import { priceGiglQuote } from './gigl-platform-pricing';

describe('priceGiglQuote', () => {
  it('prices a GIGL tariff with a 10% margin in integer kobo', () => {
    expect(priceGiglQuote(10_000)).toEqual({
      marginBasisPoints: 1000,
      platformMargin: 1_000,
      price: 11_000,
      pricingVersion: 'gigl_platform_margin_v1',
      providerCost: 10_000,
    });
  });

  it('ceils fractional kobo charges', () => {
    expect(priceGiglQuote(1000.01).price).toBe(1100.02);
  });

  it('rejects zero and invalid tariffs', () => {
    expect(() => priceGiglQuote(0)).toThrow(
      'GIGL provider cost must be positive'
    );
    expect(() => priceGiglQuote(Number.NaN)).toThrow(
      'GIGL provider cost must be finite'
    );
  });

  it('rejects tariffs whose kobo arithmetic would overflow safely', () => {
    expect(() => priceGiglQuote(Number.MAX_SAFE_INTEGER)).toThrow(
      'GIGL provider cost is too large'
    );
  });
});
