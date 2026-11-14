import { describe, expect, it } from 'vitest';
import { priceGiglQuoteUnroundedV1 } from './gigl-platform-pricing-unrounded-v1';

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
