import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared';
import { describe, expect, it } from 'vitest';
import {
  computeEligibleLineDiscount,
  type NegotiationLineInput,
} from './eligible-line-discount';

const line = (
  over: Partial<NegotiationLineInput> = {}
): NegotiationLineInput => ({
  catalogUnitPrice: 1000,
  clientUnitPrice: 1000,
  productId: 'product-1',
  variantId: null,
  quantity: 1,
  negotiable: true,
  vatCategoryCode: 'S',
  vatRate: 7.5,
  ...over,
});

describe('computeEligibleLineDiscount', () => {
  it('grosses up a within-floor negotiable discount by line VAT', () => {
    // catalog 1000, client 980 → reduction 20 = 2% floor; +7.5% VAT = 21.5
    expect(
      computeEligibleLineDiscount([line({ clientUnitPrice: 980 })])
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 1.5,
          variantId: null,
        },
      ],
      totalDiscount: 21.5,
      rejectionCode: null,
    });
  });

  it('preserves a 1 NGN accepted negotiable discount plus VAT', () => {
    expect(
      computeEligibleLineDiscount([line({ clientUnitPrice: 999 })])
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 1,
          productId: 'product-1',
          vatRelief: 0.08,
          variantId: null,
        },
      ],
      totalDiscount: 1.08,
      rejectionCode: null,
    });
  });

  it('rejects a negotiable line priced more than 2% below catalog', () => {
    // client 950 → reduction 50 > 2% floor (20) → reject the order
    expect(
      computeEligibleLineDiscount([line({ clientUnitPrice: 950 })])
    ).toEqual({
      totalDiscount: 0,
      rejectionCode: 'negotiated_price_below_floor',
    });
  });

  it('rejects a non-negotiable line priced below catalog', () => {
    expect(
      computeEligibleLineDiscount([
        line({
          negotiable: false,
          catalogUnitPrice: 500,
          clientUnitPrice: 480,
        }),
      ])
    ).toEqual({
      totalDiscount: 0,
      rejectionCode: 'non_negotiable_line_discounted',
    });
  });

  it('allows a non-negotiable line at catalog price', () => {
    expect(
      computeEligibleLineDiscount([
        line({
          negotiable: false,
          catalogUnitPrice: 500,
          clientUnitPrice: 500,
        }),
      ])
    ).toEqual({ totalDiscount: 0, rejectionCode: null });
  });

  it('sums per-line discounts in a mixed cart, leaving the non-negotiable line at catalog', () => {
    expect(
      computeEligibleLineDiscount([
        line({ clientUnitPrice: 980 }), // MacBook negotiable, at floor → 21.5
        line({
          negotiable: false,
          catalogUnitPrice: 500,
          clientUnitPrice: 500,
        }), // Tecno at catalog
      ])
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineOccurrenceKey(
            buildTransactionDiscountLineKey({
              productId: 'product-1',
              variantId: null,
            }),
            1
          ),
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 1.5,
          variantId: null,
        },
        null,
      ],
      totalDiscount: 21.5,
      rejectionCode: null,
    });
  });

  it('does not gross up VAT for zero-rated lines', () => {
    // category 'Z' → rate 0; reduction 20 = floor 2%*1000 → discount 20
    expect(
      computeEligibleLineDiscount([
        line({ clientUnitPrice: 980, vatCategoryCode: 'Z' }),
      ])
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
      totalDiscount: 20,
      rejectionCode: null,
    });
  });

  it('respects quantity in line totals and the floor', () => {
    // 2 × (1000 → 980): reduction 40 = 2% floor (2000) → +VAT 3 = 43
    expect(
      computeEligibleLineDiscount([line({ clientUnitPrice: 980, quantity: 2 })])
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 40,
          productId: 'product-1',
          vatRelief: 3,
          variantId: null,
        },
      ],
      totalDiscount: 43,
      rejectionCode: null,
    });
  });

  it('allows a non-negotiable line exactly 1 NGN below catalog (tolerance boundary)', () => {
    // catalog 1000, client 999 → reduction 1 = PRICE_TOLERANCE (not > 1) → allowed
    expect(
      computeEligibleLineDiscount([
        line({ negotiable: false, clientUnitPrice: 999 }),
      ])
    ).toEqual({ totalDiscount: 0, rejectionCode: null });
  });

  it('rejects a non-negotiable line 2 NGN below catalog (just past tolerance)', () => {
    // catalog 1000, client 998 → reduction 2 > PRICE_TOLERANCE (1) → reject
    expect(
      computeEligibleLineDiscount([
        line({ negotiable: false, clientUnitPrice: 998 }),
      ])
    ).toEqual({
      totalDiscount: 0,
      rejectionCode: 'non_negotiable_line_discounted',
    });
  });

  it('returns zero for an empty cart', () => {
    expect(computeEligibleLineDiscount([])).toEqual({
      totalDiscount: 0,
      rejectionCode: null,
    });
  });

  it('honors a custom maxRate override that admits a ~5% reduction', () => {
    // catalog 1000, client 950 → reduction 50; maxReduction = 1000 * 0.05 = 50,
    // so reduction - maxReduction = 0 (not > tolerance) → allowed.
    // +7.5% VAT on the 50 reduction = 3.75 → discount 53.75.
    expect(
      computeEligibleLineDiscount([line({ clientUnitPrice: 950 })], 0.05)
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          merchandiseDiscount: 50,
          productId: 'product-1',
          vatRelief: 3.75,
          variantId: null,
        },
      ],
      totalDiscount: 53.75,
      rejectionCode: null,
    });
  });

  it('persists the fallback line identity when lineId is invalid', () => {
    const result = computeEligibleLineDiscount([
      line({ clientUnitPrice: 980, lineId: 0 }),
    ]);

    expect(result.lineDiscounts).toEqual([
      {
        lineId: 1,
        merchandiseDiscount: 20,
        productId: 'product-1',
        vatRelief: 1.5,
        variantId: null,
      },
    ]);
  });
});
