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

describe('computeEligibleLineDiscount line keys', () => {
  it('persists distinct keys for discounted duplicate product and variant lines', () => {
    const result = computeEligibleLineDiscount([
      line({
        clientUnitPrice: 980,
        condition: 'new',
        variantAttributes: { Color: 'Blue' },
      }),
      line({
        clientUnitPrice: 990,
        condition: 'used',
        variantAttributes: { Color: 'Green' },
      }),
    ]);

    expect(result.lineDiscounts).toEqual([
      {
        lineId: 1,
        lineKey: buildTransactionDiscountLineKey({
          condition: 'new',
          productId: 'product-1',
          variantAttributes: { Color: 'Blue' },
          variantId: null,
        }),
        merchandiseDiscount: 20,
        productId: 'product-1',
        vatRelief: 1.5,
        variantId: null,
      },
      {
        lineId: 2,
        lineKey: buildTransactionDiscountLineKey({
          condition: 'used',
          productId: 'product-1',
          variantAttributes: { Color: 'Green' },
          variantId: null,
        }),
        merchandiseDiscount: 10,
        productId: 'product-1',
        vatRelief: 0.75,
        variantId: null,
      },
    ]);
  });

  it('persists occurrence-safe keys when duplicate lines have the same identity', () => {
    const lineKey = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantId: null,
    });
    const result = computeEligibleLineDiscount([
      line({ clientUnitPrice: 980 }),
      line({ clientUnitPrice: 990 }),
    ]);

    expect(
      result.lineDiscounts?.map((allocation) => allocation?.lineKey)
    ).toEqual([
      buildTransactionDiscountLineOccurrenceKey(lineKey, 1),
      buildTransactionDiscountLineOccurrenceKey(lineKey, 2),
    ]);
  });

  it('uses duplicate occurrence ordinals instead of caller line ids', () => {
    const lineKey = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantId: null,
    });
    const result = computeEligibleLineDiscount([
      line({ clientUnitPrice: 980, lineId: 800 }),
      line({ clientUnitPrice: 990, lineId: 801 }),
    ]);

    expect(
      result.lineDiscounts
        ?.filter(
          (allocation): allocation is NonNullable<typeof allocation> =>
            allocation !== null
        )
        .map((allocation) => allocation.lineKey)
    ).toEqual([
      buildTransactionDiscountLineOccurrenceKey(lineKey, 1),
      buildTransactionDiscountLineOccurrenceKey(lineKey, 2),
    ]);
  });
});
