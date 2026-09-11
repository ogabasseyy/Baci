import { jest } from '@jest/globals';
import { applyPersistedCheckoutGeneration } from './apply-persisted-checkout-generation';
import { emptyCheckoutCart } from './empty-checkout-cart';
import { rotateEmptyCheckoutCart } from './rotate-empty-checkout-cart';

const mockPersist = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);
const mockClear = jest.fn<() => Promise<void>>(async () => undefined);
const mockRead = jest.fn<() => Promise<string | null>>(async () => null);

jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: (generation: string) => mockPersist(generation),
}));
jest.mock('@/lib/clear-persisted-checkout-generation', () => ({
  clearPersistedCheckoutGeneration: () => mockClear(),
}));
jest.mock('@/lib/read-persisted-checkout-generation', () => ({
  readPersistedCheckoutGeneration: () => mockRead(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
}));

beforeEach(() => {
  mockPersist.mockReset();
  mockPersist.mockResolvedValue(undefined);
  mockClear.mockReset();
  mockClear.mockResolvedValue(undefined);
  mockRead.mockReset();
  mockRead.mockResolvedValue(null);
});

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

it('clears the stale dedicated generation so restart keeps the empty-cart identity', async () => {
  mockPersist.mockRejectedValueOnce(new Error('disk full'));
  mockClear.mockResolvedValueOnce(undefined);
  mockRead.mockResolvedValueOnce(null);
  const staleGeneration = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
  let generation = staleGeneration;
  const rotated = await rotateEmptyCheckoutCart((next) => {
    generation = next.checkoutGeneration;
  });
  expect(mockClear).toHaveBeenCalled();
  await applyPersistedCheckoutGeneration((nextGeneration) => {
    generation = nextGeneration;
  });
  expect(generation).toBe(rotated.checkoutGeneration);
  expect(generation).not.toBe(staleGeneration);
});
