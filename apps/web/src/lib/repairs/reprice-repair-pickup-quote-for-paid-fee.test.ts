import { describe, expect, it } from 'vitest';
import { repriceRepairPickupQuoteForPaidFee } from './reprice-repair-pickup-quote-for-paid-fee';

const base = {
  provider: 'GIGL' as const,
  marginBasisPoints: 1000 as const,
  pricingVersion: 'gigl_platform_margin_v1' as const,
};

describe('repriceRepairPickupQuoteForPaidFee', () => {
  it('bugfix: keeps a pickup paid at 9835.58 when cost fell to 8940 (rounded 9900 > paid)', () => {
    const quote = {
      ...base,
      price: 9900,
      providerCost: 8940,
      platformMargin: 960,
    };
    const result = repriceRepairPickupQuoteForPaidFee(quote, 9835.58);
    expect(result.price).toBe(9834);
    expect(result.platformMargin).toBe(894);
    expect(result.price).toBeLessThanOrEqual(9835.58);
    expect(result.price).toBeGreaterThanOrEqual(8940 * 1.1);
  });

  it('still reprices the exact-match case', () => {
    const quote = {
      ...base,
      price: 9900,
      providerCost: 8941.43,
      platformMargin: 958.57,
    };
    expect(repriceRepairPickupQuoteForPaidFee(quote, 9835.58).price).toBe(
      9835.58
    );
  });

  it('leaves the quote unchanged when the unrounded price still exceeds the paid fee', () => {
    const quote = {
      ...base,
      price: 10000,
      providerCost: 9000,
      platformMargin: 1000,
    };
    expect(repriceRepairPickupQuoteForPaidFee(quote, 9835.58)).toBe(quote);
  });

  it('leaves a quote at or below the paid fee unchanged', () => {
    const quote = {
      ...base,
      price: 9800,
      providerCost: 8900,
      platformMargin: 900,
    };
    expect(repriceRepairPickupQuoteForPaidFee(quote, 9835.58)).toBe(quote);
  });
});
