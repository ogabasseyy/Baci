import { describe, expect, it } from 'vitest';
import { resolveTransactionDiscountAllocation } from './transaction-review-discount-allocations';
import { getPersistedLineKey } from './transaction-review-discount-line-key';

describe('resolveTransactionDiscountAllocation', () => {
  it('resolves a line-id allocation for an item', () => {
    const allocation = { lineId: 7, merchandiseDiscount: 10, vatRelief: 0 };

    const result = resolveTransactionDiscountAllocation(
      { allocationsByLineId: new Map([[7, allocation]]), mode: 'lineId' },
      { line_id: 7, price: 100, quantity: 1 }
    );

    expect(result).toEqual(allocation);
  });

  it('returns undefined when no line-id allocation matches', () => {
    const result = resolveTransactionDiscountAllocation(
      { allocationsByLineId: new Map(), mode: 'lineId' },
      { line_id: 7, price: 100, quantity: 1 }
    );

    expect(result).toBeUndefined();
  });

  it('resolves an identity allocation for a product and variant', () => {
    const allocation = { lineId: 7, merchandiseDiscount: 10, vatRelief: 0 };

    const result = resolveTransactionDiscountAllocation(
      {
        allocationsByIdentity: new Map([['["product-1",null]', allocation]]),
        mode: 'identity',
      },
      { product_id: 'product-1', variant_id: null, price: 100, quantity: 1 }
    );

    expect(result).toEqual(allocation);
  });

  it('resolves a persisted line-key allocation', () => {
    const item = {
      product_id: 'product-1',
      variant_id: null,
      price: 100,
      quantity: 1,
    };
    const lineKey = getPersistedLineKey(item);
    const allocation = { lineId: 7, merchandiseDiscount: 10, vatRelief: 0 };

    const result = resolveTransactionDiscountAllocation(
      {
        allocationsByIdentity: new Map(),
        allocationsByLineKey: new Map([[lineKey as string, allocation]]),
        mode: 'lineKey',
      },
      item
    );

    expect(result).toEqual(allocation);
  });
});
