import { describe, expect, it } from 'vitest';
import { calculateRedvaultPricing } from './redvault-pricing';
import { allocateRedvaultRefund } from './redvault-refund-allocations';

describe('allocateRedvaultRefund', () => {
  it('does not reprice the original five-percent tier after a partial return crosses below the threshold', () => {
    const quote = calculateRedvaultPricing([
      {
        brand: 'Apple',
        name: 'iPhone',
        itemId: 'item-1',
        productId: 'product-1',
        condition: 'new',
        variantId: null,
        variantAttributes: null,
        unitPriceKobo: 10_000_000,
        quantity: 2,
        persistedItemOrder: 1,
        vatCategoryCode: 'S',
        vatRateBasisPoints: 750,
        taxBasis: 'exclusive',
      },
    ]);
    expect(quote.discountKobo).toBe(1_000_000);
    expect(allocateRedvaultRefund(quote.allocations[0], [0]).refundKobo).toBe(
      9_500_000
    );
    expect(allocateRedvaultRefund(quote.allocations[0], [1]).refundKobo).toBe(
      9_500_000
    );
  });

  it('uses the stored net unit amounts and stable remainder order for sequential partial returns', () => {
    const allocation = {
      itemId: 'item-1',
      unitNetAmountsKobo: [95_004, 95_005],
    };

    expect(allocateRedvaultRefund(allocation, [0])).toEqual({
      refundKobo: 95_004,
      unitNetAmountsKobo: [95_004],
    });
    expect(allocateRedvaultRefund(allocation, [1])).toEqual({
      refundKobo: 95_005,
      unitNetAmountsKobo: [95_005],
    });
    expect(allocateRedvaultRefund(allocation, [0, 1])).toEqual({
      refundKobo: 190_009,
      unitNetAmountsKobo: [95_004, 95_005],
    });
  });

  it('rejects repeated, unknown, and unsafe unit selections', () => {
    const allocation = {
      itemId: 'item-1',
      unitNetAmountsKobo: [95_004, 95_005],
    };

    expect(() => allocateRedvaultRefund(allocation, [0, 0])).toThrow('unique');
    expect(() => allocateRedvaultRefund(allocation, [2])).toThrow('range');
    expect(() =>
      allocateRedvaultRefund({ ...allocation, unitNetAmountsKobo: [1.5] }, [0])
    ).toThrow('safe integer');
  });
});
