import { describe, expect, it } from 'vitest';
import { parseTransactionDiscountOptions } from './transaction-review-discount-metadata';

describe('transaction review discount metadata', () => {
  it('parses a valid version-2 allocation', () => {
    expect(
      parseTransactionDiscountOptions({
        baci_transaction_discount: {
          lineDiscounts: [
            { lineId: 1, merchandiseDiscount: 20, vatRelief: 1.5 },
          ],
          version: 2,
        },
      })
    ).toEqual({
      lineDiscounts: [{ lineId: 1, merchandiseDiscount: 20, vatRelief: 1.5 }],
    });
  });

  it('parses a valid version-3 identity allocation', () => {
    expect(
      parseTransactionDiscountOptions({
        baci_transaction_discount: {
          lineDiscounts: [
            {
              lineId: 1,
              lineKey: '["product-1",null,"new",{}]',
              merchandiseDiscount: 20,
              productId: 'product-1',
              vatRelief: 0,
              variantId: null,
            },
          ],
          version: 3,
        },
      })
    ).toEqual({
      lineDiscounts: [
        {
          lineId: 1,
          lineKey: '["product-1",null,"new",{}]',
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
    });
  });

  it('rejects malformed, duplicate, and incomplete allocations', () => {
    const cases = [
      {
        lineDiscounts: [{ lineId: 1, merchandiseDiscount: -1, vatRelief: 0 }],
        version: 2,
      },
      {
        lineDiscounts: [
          { lineId: 1, merchandiseDiscount: 1, vatRelief: 0 },
          { lineId: 1, merchandiseDiscount: 2, vatRelief: 0 },
        ],
        version: 2,
      },
      {
        lineDiscounts: [
          {
            lineId: 1,
            merchandiseDiscount: 1,
            productId: '',
            vatRelief: 0,
            variantId: null,
          },
        ],
        version: 3,
      },
      {
        lineDiscounts: [
          {
            lineId: 1,
            merchandiseDiscount: 1,
            productId: 'product-1',
            vatRelief: 0,
            variantId: null,
          },
          {
            lineId: 2,
            merchandiseDiscount: 2,
            productId: 'product-1',
            vatRelief: 0,
            variantId: null,
          },
        ],
        version: 3,
      },
    ];

    for (const metadata of cases) {
      expect(
        parseTransactionDiscountOptions({
          baci_transaction_discount: metadata,
        })
      ).toBeUndefined();
    }
  });

  it('ignores malformed persisted discount metadata', () => {
    const malformedOptions = parseTransactionDiscountOptions({
      baci_transaction_discount: {
        lineDiscounts: [
          { lineId: 1, merchandiseDiscount: 'not-a-number', vatRelief: 0 },
        ],
        version: 2,
      },
    });
    const nullOptions = parseTransactionDiscountOptions(null);

    expect(malformedOptions).toBeUndefined();
    expect(nullOptions).toBeUndefined();
  });
});
