import type { CartState } from './cart-store-state';
import { partializeCartStore } from './partialize-cart-store';

it('strips voucher credentials from shared-cart items before persisting', () => {
  const persisted = partializeCartStore({
    cartWideNegotiationActive: false,
    checkoutGeneration: 'cart-one',
    items: [
      {
        id: 'line-1',
        voucher_award_id: 'award-secret',
        voucher_token: 'token-secret',
      },
    ],
    lineSequence: 1,
    sharedCartRef: { merchantId: 'm-1', cartId: 'c-1' },
  } as CartState);
  expect(JSON.stringify(persisted)).not.toContain('token-secret');
  expect(JSON.stringify(persisted)).not.toContain('award-secret');
  expect(persisted.items).toEqual([{ id: 'line-1' }]);
  expect(persisted.sharedCartRef).toEqual({
    merchantId: 'm-1',
    cartId: 'c-1',
  });
});

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
