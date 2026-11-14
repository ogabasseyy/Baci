import { describe, expect, it } from 'vitest';
import { priceGiglQuote } from './gigl-platform-pricing';
import { repriceGiglQuoteForPaidFee } from './reprice-gigl-quote-for-paid-fee';
import type { ShippingQuote } from './types';

function freshGiglQuote(providerCost: number): ShippingQuote {
  return {
    id: 'quote-fresh',
    provider: 'GIGL',
    serviceTier: 'GoStandard',
    carrierName: 'GIG Logistics',
    displayName: 'GIG Logistics - GoStandard',
    estimatedDays: 3,
    currency: 'NGN',
    pickupIncluded: true,
    insuranceIncluded: false,
    providerRateId: 'GIGL_4_0',
    expiresAt: new Date('2026-11-01T00:00:00.000Z'),
    ...priceGiglQuote(providerCost),
  };
}

describe('repriceGiglQuoteForPaidFee', () => {
  it('re-prices at the unrounded v1 fee an order already paid under that rule', () => {
    const fresh = freshGiglQuote(44_091.27);
    expect(fresh.price).toBe(48_600);

    const result = repriceGiglQuoteForPaidFee(fresh, 48_500.4);

    expect(result).toEqual({
      ...fresh,
      price: 48_500.4,
      providerCost: 44_091.27,
      platformMargin: 4_409.13,
      marginBasisPoints: 1000,
      pricingVersion: 'gigl_platform_margin_v1',
    });
  });

  it('accepts a paid fee read back from the database as a numeric string', () => {
    const result = repriceGiglQuoteForPaidFee(
      freshGiglQuote(44_091.27),
      '48500.40'
    );
    expect(result.price).toBe(48_500.4);
    expect(result.platformMargin).toBe(4_409.13);
  });

  it('keeps the rounded quote when it already equals the paid fee', () => {
    const fresh = freshGiglQuote(44_091.27);
    expect(repriceGiglQuoteForPaidFee(fresh, 48_600)).toBe(fresh);
  });

  it('keeps the rounded quote when neither v1 price matches the paid fee', () => {
    const fresh = freshGiglQuote(45_000.01);
    expect(repriceGiglQuoteForPaidFee(fresh, 48_500.4)).toBe(fresh);
  });

  it('never charges more than the paid fee or less than cost plus 10%', () => {
    for (const [cost, paid] of [
      [44_091.27, 48_500.4],
      [114_534.49, 125_987.94],
      [1000.01, 1100.02],
    ] as const) {
      const result = repriceGiglQuoteForPaidFee(freshGiglQuote(cost), paid);
      const priceKobo = Math.round(result.price * 100);
      const costKobo = Math.round((result.providerCost ?? 0) * 100);
      const marginKobo = Math.round((result.platformMargin ?? 0) * 100);
      expect(priceKobo).toBe(Math.round(paid * 100));
      expect(priceKobo).toBe(costKobo + marginKobo);
      expect(marginKobo * 10).toBeGreaterThanOrEqual(costKobo);
    }
  });

  it('leaves a quote that is not the rounded v1 price of its cost unchanged', () => {
    const fresh = { ...freshGiglQuote(44_091.27), price: 48_700 };
    expect(repriceGiglQuoteForPaidFee(fresh, 48_500.4)).toBe(fresh);
  });

  it('leaves non-GIGL, non-v1 and incomplete quotes unchanged', () => {
    const fresh = freshGiglQuote(44_091.27);
    const quotes: ShippingQuote[] = [
      { ...fresh, provider: 'TOPSHIP' },
      { ...fresh, pricingVersion: 'gigl_platform_margin_v2' },
      { ...fresh, marginBasisPoints: 2000 },
      { ...fresh, providerCost: undefined },
    ];
    for (const quote of quotes) {
      expect(repriceGiglQuoteForPaidFee(quote, 48_500.4)).toBe(quote);
    }
  });

  it('leaves the quote unchanged without a usable paid fee', () => {
    const fresh = freshGiglQuote(44_091.27);
    for (const paid of [null, undefined, '', 'abc', 0, -48_500.4]) {
      expect(repriceGiglQuoteForPaidFee(fresh, paid)).toBe(fresh);
    }
  });
});
