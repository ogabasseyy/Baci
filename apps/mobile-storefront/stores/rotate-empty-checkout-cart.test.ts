import { emptyCheckoutCart } from './empty-checkout-cart';
import { rotateEmptyCheckoutCart } from './rotate-empty-checkout-cart';

jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: jest.fn(async () => undefined),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
}));

it('persists a new purchase identity before returning an empty cart', async () => {
  const { persistCheckoutGeneration } =
    require('@/lib/persist-checkout-generation') as typeof import('@/lib/persist-checkout-generation');
  const first = emptyCheckoutCart();
  const rotated = await rotateEmptyCheckoutCart();
  expect(persistCheckoutGeneration).toHaveBeenCalledWith(
    rotated.checkoutGeneration
  );
  expect(rotated.checkoutGeneration).not.toBe(first.checkoutGeneration);
  expect(rotated.items).toEqual([]);
});
