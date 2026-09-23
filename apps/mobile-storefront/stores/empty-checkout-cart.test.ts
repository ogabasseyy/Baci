import { emptyCheckoutCart } from './empty-checkout-cart';

jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
}));

it('starts a distinct purchase identity when the cart is cleared', () => {
  const first = emptyCheckoutCart();
  const second = emptyCheckoutCart();
  expect(first).toEqual({
    items: [],
    lineSequence: 0,
    cartWideNegotiationActive: false,
    checkoutGeneration: expect.any(String),
  });
  expect(second.checkoutGeneration).not.toBe(first.checkoutGeneration);
});
