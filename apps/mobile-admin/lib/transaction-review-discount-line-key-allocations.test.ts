import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getValidatedLineKeyDiscounts } from './transaction-review-discount-line-key-allocations';
import { getPersistedLineKeyOccurrenceOrdinals } from './transaction-review-persisted-line-key-occurrences';

const items = [
  {
    line_id: 10,
    price: 100,
    product_id: 'product-1',
    quantity: 1,
    variant_id: null,
  },
  {
    line_id: 11,
    price: 100,
    product_id: 'product-1',
    quantity: 1,
    variant_id: null,
  },
];

const lineTotals = [
  { merchandiseTotal: 100, quantity: 1, total: 100 },
  { merchandiseTotal: 100, quantity: 1, total: 100 },
];

const lineKey = buildTransactionDiscountLineKey({
  productId: 'product-1',
  variantId: null,
});

function occurrenceOrdinals() {
  return getPersistedLineKeyOccurrenceOrdinals(items);
}

describe('getValidatedLineKeyDiscounts', () => {
  it('rejects an allocation with a malformed or unknown line key', () => {
    const result = getValidatedLineKeyDiscounts(
      items,
      lineTotals,
      10,
      [
        {
          lineId: 1,
          lineKey: 'not-a-persisted-line-key',
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
      occurrenceOrdinals()
    );

    expect(result).toBeUndefined();
  });

  it('rejects an ambiguous base key for duplicate persisted lines', () => {
    const result = getValidatedLineKeyDiscounts(
      items,
      lineTotals,
      10,
      [
        {
          lineId: 1,
          lineKey,
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
      occurrenceOrdinals()
    );

    expect(result).toBeUndefined();
  });

  it('accepts one keyed and one identity-only allocation for duplicate lines', () => {
    const result = getValidatedLineKeyDiscounts(
      items,
      lineTotals,
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
          merchandiseDiscount: 20,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
      occurrenceOrdinals()
    );

    expect(result?.mode).toBe('lineKey');
    expect(result?.allocationsByLineKey.size).toBe(1);
    expect(result?.allocationsByIdentity.size).toBe(1);
  });

  it('rejects allocations whose total does not match the normalized discount', () => {
    const result = getValidatedLineKeyDiscounts(
      items,
      lineTotals,
      25,
      [
        {
          lineId: 1,
          lineKey: buildTransactionDiscountLineOccurrenceKey(lineKey, 1),
          merchandiseDiscount: 10,
          productId: 'product-1',
          vatRelief: 0,
          variantId: null,
        },
      ],
      occurrenceOrdinals()
    );

    expect(result).toBeUndefined();
  });
});
