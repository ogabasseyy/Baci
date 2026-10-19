import { mergeCartStore } from './cart-store-merge';
import type { CartState } from './cart-store-state';

const current = {
  items: [],
  checkoutGeneration: 'fresh',
  lineSequence: 0,
  cartWideNegotiationActive: false,
} as unknown as CartState;
it('does not hydrate another merchant’s canonical display or checkout generation', () => {
  const result = mergeCartStore(
    {
      items: [{ id: 'foreign' }],
      checkoutGeneration: 'foreign-generation',
      sharedCartRef: { merchantId: 'merchant-a', cartId: 'cart' },
    },
    current,
    'merchant-b',
    false
  );
  expect(result.items).toEqual([]);
  expect(result.checkoutGeneration).toBe('fresh');
  expect(result.sharedCartRef).toBeUndefined();
});
it('does not let late legacy hydration replace a live canonical projection', () => {
  const owned = {
    ...current,
    items: [{ id: 'confirmed' }],
    sharedCartRef: { merchantId: 'merchant-a', cartId: 'cart' },
  } as CartState;
  expect(
    mergeCartStore(
      { items: [], checkoutGeneration: 'old' },
      owned,
      'merchant-a',
      true
    )
  ).toEqual(owned);
});
