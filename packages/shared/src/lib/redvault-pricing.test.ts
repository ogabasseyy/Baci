import { describe, expect, it } from 'vitest';
import { calculateRedvaultPricing } from './redvault-pricing';

const eligible = {
  brand: 'Apple',
  condition: 'new',
  itemId: 'item-1',
  name: 'iPhone',
  persistedItemOrder: 1,
  productId: 'product-1',
  quantity: 1,
  taxBasis: 'exclusive' as const,
  unitPriceKobo: 10_000_000,
  variantAttributes: { storage: '128GB' },
  variantId: 'variant-1',
  vatCategoryCode: 'S',
  vatRateBasisPoints: 750,
};

describe('calculateRedvaultPricing', () => {
  it('normalizes attribute keys before grouping split units for rounding', () => {
    const result = calculateRedvaultPricing([
      {
        ...eligible,
        unitPriceKobo: 100_005,
        variantAttributes: { ' b': 'x', a: 'y' },
      },
      {
        ...eligible,
        itemId: 'item-2',
        persistedItemOrder: 2,
        unitPriceKobo: 100_005,
        variantAttributes: { b: 'x', a: 'y' },
      },
    ]);

    expect(result.discountKobo).toBe(20_001);
  });

  it('rejects colliding normalized attribute keys', () => {
    expect(() =>
      calculateRedvaultPricing([
        { ...eligible, variantAttributes: { ' b': 'x', b: 'y' } },
      ])
    ).toThrow('variantAttributes contains duplicate normalized keys');
  });

  it('prices a mixed NGN 100,000 eligible and NGN 50,000 excluded basket at NGN 10,000 off', () => {
    const result = calculateRedvaultPricing([
      eligible,
      {
        ...eligible,
        brand: 'Tecno',
        itemId: 'item-2',
        unitPriceKobo: 5_000_000,
      },
    ]);

    expect(result.productSubtotalKobo).toBe(15_000_000);
    expect(result.eligibleSubtotalKobo).toBe(10_000_000);
    expect(result.discountKobo).toBe(1_000_000);
    expect(result.allocations).toMatchObject([
      {
        discountKobo: 1_000_000,
        eligible: true,
        itemId: 'item-1',
        unitDiscountsKobo: [1_000_000],
        unitNetAmountsKobo: [9_000_000],
      },
      {
        discountKobo: 0,
        eligible: false,
        itemId: 'item-2',
        unitDiscountsKobo: [0],
        unitNetAmountsKobo: [5_000_000],
      },
    ]);
  });

  it('returns no eligible pricing for an all-excluded basket', () => {
    const result = calculateRedvaultPricing([
      { ...eligible, brand: 'Infinix' },
    ]);

    expect(result.eligible).toBe(false);
    expect(result.discountKobo).toBe(0);
  });

  it.each([
    [100_004, 10_000],
    [100_005, 10_001],
  ])('rounds a canonical eligible group of %i kobo half-up to %i kobo', (subtotal, discount) => {
    const result = calculateRedvaultPricing([
      { ...eligible, unitPriceKobo: subtotal },
    ]);

    expect(result.discountKobo).toBe(discount);
  });

  it('consolidates equivalent split units independently of input order', () => {
    const split = calculateRedvaultPricing([
      {
        ...eligible,
        itemId: 'item-2',
        persistedItemOrder: 2,
        unitPriceKobo: 100_005,
      },
      { ...eligible, itemId: 'item-1', quantity: 1, unitPriceKobo: 100_005 },
    ]);
    const combined = calculateRedvaultPricing([
      { ...eligible, quantity: 2, unitPriceKobo: 100_005 },
    ]);

    expect(split.discountKobo).toBe(20_001);
    expect(split.discountKobo).toBe(combined.discountKobo);
    expect(split.allocations.map((allocation) => allocation.itemId)).toEqual([
      'item-1',
      'item-2',
    ]);
    expect(
      split.allocations.map((allocation) => allocation.unitDiscountsKobo)
    ).toEqual([[10_001], [10_000]]);
  });

  it('keeps distinct variant, condition, and VAT identities in separate rounding groups', () => {
    const result = calculateRedvaultPricing([
      { ...eligible, unitPriceKobo: 100_005 },
      {
        ...eligible,
        condition: 'used',
        itemId: 'item-2',
        persistedItemOrder: 2,
        unitPriceKobo: 100_005,
      },
      {
        ...eligible,
        itemId: 'item-3',
        persistedItemOrder: 3,
        unitPriceKobo: 100_005,
        vatRateBasisPoints: 0,
      },
      {
        ...eligible,
        itemId: 'item-4',
        persistedItemOrder: 4,
        unitPriceKobo: 100_005,
        variantId: 'variant-2',
      },
    ]);

    expect(result.discountKobo).toBe(40_004);
  });

  it.each([
    [19_999_999, 2_000_000],
    [20_000_000, 1_000_000],
    [20_000_001, 1_000_000],
  ])('selects the tier from eligible subtotal %i before discount', (subtotal, discount) => {
    const result = calculateRedvaultPricing([
      { ...eligible, unitPriceKobo: subtotal },
      {
        ...eligible,
        itemId: 'excluded',
        brand: 'Tecno',
        unitPriceKobo: 30_000_000,
      },
    ]);
    expect(result.discountKobo).toBe(discount);
    expect(
      result.allocations.find((allocation) => allocation.itemId === 'excluded')
        ?.discountKobo
    ).toBe(0);
  });

  it('uses the combined eligible subtotal for every distinct rounding group', () => {
    const result = calculateRedvaultPricing([
      eligible,
      { ...eligible, itemId: 'second', variantId: 'second-variant' },
    ]);
    expect(result.discountKobo).toBe(1_000_000);
    expect(
      result.allocations.map((allocation) => allocation.discountKobo)
    ).toEqual([500_000, 500_000]);
  });

  it('rejects malformed and overflow-prone monetary or quantity inputs', () => {
    expect(() =>
      calculateRedvaultPricing([{ ...eligible, unitPriceKobo: 1.5 }])
    ).toThrow('safe integer');
    expect(() =>
      calculateRedvaultPricing([{ ...eligible, quantity: 0 }])
    ).toThrow('positive safe integer');
    expect(() =>
      calculateRedvaultPricing([
        { ...eligible, unitPriceKobo: Number.MAX_SAFE_INTEGER },
      ])
    ).toThrow('overflow');
  });

  it('rejects an oversized quantity before creating per-unit allocations', () => {
    expect(() =>
      calculateRedvaultPricing([{ ...eligible, quantity: 10_001 }])
    ).toThrow('maximum 10000');
  });

  it('rejects a tax basis other than the frozen exclusive policy', () => {
    expect(() =>
      calculateRedvaultPricing([
        { ...eligible, taxBasis: 'inclusive' as never },
      ])
    ).toThrow('taxBasis must be exclusive');
  });
});
