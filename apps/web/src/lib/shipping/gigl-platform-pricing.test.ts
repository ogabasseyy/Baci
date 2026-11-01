import { describe, expect, it } from 'vitest';
import {
  priceGiglQuote,
  priceGiglQuoteUnroundedV1,
} from './gigl-platform-pricing';

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

  it('rounds the price up to the next whole NGN 100 and lets the margin absorb it', () => {
    expect(priceGiglQuote(44_091.27)).toEqual({
      marginBasisPoints: 1000,
      platformMargin: 4_508.73,
      price: 48_600,
      pricingVersion: 'gigl_platform_margin_v1',
      providerCost: 44_091.27,
    });
  });

  it('rounds a fractional kobo charge up to the next NGN 100', () => {
    const quote = priceGiglQuote(1000.01);
    expect(quote.price).toBe(1_200);
    expect(quote.platformMargin).toBe(199.99);
  });

  it('keeps a price that already lands on a whole NGN 100', () => {
    expect(priceGiglQuote(95_000).price).toBe(104_500);
    expect(priceGiglQuote(1_000).price).toBe(1_100);
  });

  it('rounds one kobo over an NGN 100 boundary up to the next boundary', () => {
    // 909.10 * 1.1 = 1000.01 -> 1,100
    const quote = priceGiglQuote(909.1);
    expect(quote.price).toBe(1_100);
    expect(quote.platformMargin).toBe(190.9);
  });

  it('always charges cost + margin, a multiple of NGN 100, with at least 10% margin', () => {
    for (const cost of [0.01, 1, 99.99, 909.1, 1000.01, 11_585.25, 44_091.27]) {
      const quote = priceGiglQuote(cost);
      const priceKobo = Math.round(quote.price * 100);
      const costKobo = Math.round(quote.providerCost * 100);
      const marginKobo = Math.round(quote.platformMargin * 100);
      expect(priceKobo).toBe(costKobo + marginKobo);
      expect(priceKobo % 10_000).toBe(0);
      expect(marginKobo * 10).toBeGreaterThanOrEqual(costKobo);
    }
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

describe('priceGiglQuoteUnroundedV1', () => {
  it('reproduces the pre-rounding v1 price ceiled to the kobo', () => {
    expect(priceGiglQuoteUnroundedV1(44_091.27)).toEqual({
      marginBasisPoints: 1000,
      platformMargin: 4_409.13,
      price: 48_500.4,
      pricingVersion: 'gigl_platform_margin_v1',
      providerCost: 44_091.27,
    });
    expect(priceGiglQuoteUnroundedV1(1000.01).price).toBe(1100.02);
  });

  it('rejects invalid tariffs like the current rule', () => {
    expect(() => priceGiglQuoteUnroundedV1(-1)).toThrow(
      'GIGL provider cost must be positive'
    );
  });
});
