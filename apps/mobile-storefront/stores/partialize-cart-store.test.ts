import type { CartState } from './cart-store-state';
import { partializeCartStore } from './partialize-cart-store';

it('persists checkout identity fields with the cart', () => {
  expect(
    partializeCartStore({
      cartWideNegotiationActive: true,
      checkoutGeneration: 'cart-one',
      items: [{ id: 'line-1' }],
      lineSequence: 2,
    } as CartState)
  ).toEqual({
    cartWideNegotiationActive: true,
    checkoutGeneration: 'cart-one',
    items: [{ id: 'line-1' }],
    lineSequence: 2,
  });
});
