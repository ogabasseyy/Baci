import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getPersistedLineKeyCandidates } from './transaction-review-persisted-line-key-candidates';

describe('getPersistedLineKeyCandidates', () => {
  it('returns the base key when no occurrence ordinal is provided', () => {
    const item = { product_id: 'product-1', variant_id: null };
    const lineKey = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantId: null,
    });

    expect(getPersistedLineKeyCandidates(item)).toEqual([lineKey]);
  });

  it('returns the base and occurrence keys for duplicate persisted lines', () => {
    const item = { product_id: 'product-1', variant_id: null };
    const lineKey = buildTransactionDiscountLineKey({
      productId: 'product-1',
      variantId: null,
    });

    expect(getPersistedLineKeyCandidates(item, 2)).toEqual([
      lineKey,
      buildTransactionDiscountLineOccurrenceKey(lineKey, 2),
    ]);
  });

  it('returns no candidates for malformed persisted identity fields', () => {
    expect(
      getPersistedLineKeyCandidates({
        product_id: 'product-1',
        variant_attributes: { Color: 42 as unknown as string },
        variant_id: null,
      })
    ).toEqual([]);
  });
});
