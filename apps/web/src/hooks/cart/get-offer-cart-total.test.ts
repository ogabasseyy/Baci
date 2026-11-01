import { expect, it } from 'vitest';
import type { CartItem } from './cart-types';
import { getOfferCartTotal } from './get-offer-cart-total';

it('counts only other ordinary lines for the same product and offer', () => {
  const line = (overrides: Partial<CartItem>): CartItem =>
    ({ id: 'p1', quantity: 1, offerId: 'o1', ...overrides }) as CartItem;
  const cart = [
    line({ quantity: 2 }),
    line({ quantity: 3 }),
    line({ offerId: 'o2', quantity: 9 }),
    line({ id: 'p2', quantity: 9 }),
    line({ variantId: 'v1', quantity: 9 }),
    line({ quizAwardId: 'a1', quantity: 9 }),
    line({ quizVoucherToken: 't1', quantity: 9 }),
  ];
  expect(getOfferCartTotal(cart, 'p1', 'o1', 0)).toBe(3);
});
