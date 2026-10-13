import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getValidatedExplicitLineDiscounts } from './transaction-review-discount-allocation-validation';
import { getPersistedLineKeyOccurrenceOrdinals } from './transaction-review-persisted-line-key-occurrences';

describe('getValidatedExplicitLineDiscounts', () => {
  it('matches persisted allocations by product and variant identity', () => {
    const result = getValidatedExplicitLineDiscounts(
      [
        {
          line_id: 7,
          price: 100,
          product_id: 'product-1',
          quantity: 1,
          variant_id: null,
        },
      ],
      [{ merchandiseTotal: 100, quantity: 1, total: 100 }],
      10,
      [
        {
          lineId: 1,
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ]
    );

    expect(result?.mode).toBe('identity');
    expect(
      result?.mode === 'identity'
        ? result.allocationsByIdentity.get('["product-1",null]')
        : undefined
    ).toMatchObject({ merchandiseDiscount: 10 });
  });

  it('rejects allocations whose total does not match the order discount', () => {
    const result = getValidatedExplicitLineDiscounts(
      [{ line_id: 1, price: 100, quantity: 1 }],
      [{ merchandiseTotal: 100, quantity: 1, total: 100 }],
      25,
      [{ lineId: 1, merchandiseDiscount: 10, vatRelief: 0 }]
    );

    expect(result).toBeUndefined();
  });

  it('matches occurrence-safe keys by persisted order sequence, not global line ids', () => {
    const lineKey = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantId: null,
    });
    const items = [
      {
        line_id: 800,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_id: null,
      },
      {
        line_id: 801,
        price: 100,
        product_id: 'product-1',
        quantity: 1,
        variant_id: null,
      },
    ];
    const result = getValidatedExplicitLineDiscounts(
      items,
      [
        { merchandiseTotal: 100, quantity: 1, total: 100 },
        { merchandiseTotal: 100, quantity: 1, total: 100 },
      ],
      30,
      [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 1),
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
        {
          lineId: 2,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 2),
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
      getPersistedLineKeyOccurrenceOrdinals(items)
    );

    expect(result?.mode).toBe('lineKey');
  });
});
