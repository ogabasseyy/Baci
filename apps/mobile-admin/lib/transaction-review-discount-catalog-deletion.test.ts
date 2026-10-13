import { buildTransactionDiscountLineKey } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getDiscountedTransactionUnitPrices } from './transaction-review-discount';

describe('discount allocations after catalog deletion', () => {
  it('uses persisted line ids when catalog identity is no longer available', () => {
    const prices = getDiscountedTransactionUnitPrices(
      [
        {
          line_id: 1,
          price: 100,
          product_id: null,
          quantity: 1,
          variant_id: null,
        },
        {
          line_id: 2,
          price: 100,
          product_id: 'product-2',
          quantity: 1,
          variant_id: null,
        },
      ],
      20,
      {
        lineDiscounts: [
          {
            lineId: 1,
            lineKey: buildTransactionDiscountLineKey({
              productId: 'deleted-product',
              variantId: null,
            }),
            merchandiseDiscount: 20,
            productId: 'deleted-product',
            vatRelief: 0,
            variantId: null,
          },
          null,
        ],
      }
    );

    expect(prices).toEqual([80, 100]);
  });
});
