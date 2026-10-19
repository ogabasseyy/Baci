import { dedupeMergeConflictItems } from './merge-conflict-items';

describe('dedupeMergeConflictItems', () => {
  it('collapses sibling lanes with identical line identities', () => {
    const item = { productId: 'product-1', variantId: 'variant-1' };
    expect(dedupeMergeConflictItems([item, { ...item }, item])).toEqual([item]);
  });

  it('keeps distinct lanes of the same product', () => {
    const base = { productId: 'product-1' };
    const used = { condition: 'used' as const, productId: 'product-1' };
    expect(dedupeMergeConflictItems([base, used])).toEqual([base, used]);
  });
});
