import { describe, expect, it } from 'vitest';
import { getPersistedLineKey } from './transaction-review-discount-line-key';

describe('getPersistedLineKey', () => {
  it('returns a canonical key for a valid persisted item identity', () => {
    const item = {
      condition: 'new',
      product_id: 'product-1',
      variant_attributes: { Color: 'Blue' },
      variant_id: 'variant-1',
    };

    const key = getPersistedLineKey(item);

    expect(key).toBe('["product-1","variant-1","new",{"Color":"Blue"}]');
  });

  it('rejects malformed persisted item identity fields', () => {
    const item = {
      product_id: 'product-1',
      variant_attributes: { Color: 42 as unknown as string },
      variant_id: null,
    };

    const key = getPersistedLineKey(item);

    expect(key).toBeNull();
  });
});
