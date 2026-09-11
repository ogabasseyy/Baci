import { jest } from '@jest/globals';
import { emptyCheckoutCart } from './empty-checkout-cart';
import { rotateEmptyCheckoutCart } from './rotate-empty-checkout-cart';

const mockPersist = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);

jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: (generation: string) => mockPersist(generation),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
}));

it('applies the empty cart before persisting the new purchase identity', async () => {
  const applied: ReturnType<typeof emptyCheckoutCart>[] = [];
  let persistStarted = false;
  mockPersist.mockImplementation(async (generation: string) => {
    persistStarted = true;
    expect(applied[0]?.checkoutGeneration).toBe(generation);
  });
  const first = emptyCheckoutCart();
  const rotated = await rotateEmptyCheckoutCart((next) => {
    expect(persistStarted).toBe(false);
    applied.push(next);
  });
  expect(applied).toEqual([rotated]);
  expect(rotated.checkoutGeneration).not.toBe(first.checkoutGeneration);
  expect(rotated.items).toEqual([]);
});

it('still applies the empty cart when generation persist rejects', async () => {
  mockPersist.mockRejectedValueOnce(new Error('disk full'));
  const applied: ReturnType<typeof emptyCheckoutCart>[] = [];
  await expect(
    rotateEmptyCheckoutCart((next) => {
      applied.push(next);
    })
  ).resolves.toEqual(applied[0]);
  expect(applied[0]?.items).toEqual([]);
});
