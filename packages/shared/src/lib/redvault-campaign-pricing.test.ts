import { describe, expect, it } from 'vitest';
import { calculateRedvaultPricing } from './redvault-pricing';

const line = {
  brand: 'Tecno',
  name: 'Camon',
  condition: 'new',
  itemId: 'one',
  persistedItemOrder: 1,
  productId: 'approved',
  quantity: 3,
  taxBasis: 'exclusive',
  unitPriceKobo: 100005,
  variantAttributes: {},
  variantId: null,
  vatCategoryCode: 'S',
  vatRateBasisPoints: 750,
};

describe('RedVault additional campaign eligibility', () => {
  it('uses the same rounding and unit allocations for approved products', () => {
    const result = calculateRedvaultPricing([line], new Set(['approved']));
    expect(result.discountKobo).toBe(15001);
    expect(result.allocations[0].unitDiscountsKobo).toEqual([5001, 5000, 5000]);
    expect(result.allocations[0].unitNetAmountsKobo).toEqual([
      95004, 95005, 95005,
    ]);
  });
  it('does not accept eligibility flags attached to quote lines', () => {
    const result = calculateRedvaultPricing([
      { ...line, eligible: true, campaignEligible: true },
    ]);
    expect(result.discountKobo).toBe(0);
  });
  it('keeps regular eligibility after the campaign set is emptied', () => {
    expect(
      calculateRedvaultPricing(
        [{ ...line, brand: 'Apple', name: 'iPhone' }],
        new Set()
      ).discountKobo
    ).toBe(15001);
    expect(calculateRedvaultPricing([line], new Set()).discountKobo).toBe(0);
  });
});
