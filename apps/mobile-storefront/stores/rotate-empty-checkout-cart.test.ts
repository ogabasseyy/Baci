import { jest } from '@jest/globals';
import { applyPersistedCheckoutGeneration } from './apply-persisted-checkout-generation';
import { emptyCheckoutCart } from './empty-checkout-cart';
import { rotateEmptyCheckoutCart } from './rotate-empty-checkout-cart';

const mockPersist = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);
const mockClear = jest.fn<() => Promise<void>>(async () => undefined);
const mockCompensate = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);
const mockRead = jest.fn<() => Promise<string | null>>(async () => null);
const mockRelease = jest.fn<(generation: string) => Promise<void>>(
  async () => undefined
);

jest.mock('@/lib/persist-checkout-generation', () => ({
  persistCheckoutGeneration: (generation: string) => mockPersist(generation),
}));
jest.mock('@/lib/clear-persisted-checkout-generation', () => ({
  clearPersistedCheckoutGeneration: () => mockClear(),
  removeAbandonedCheckoutGenerationWrite: (generation: string) =>
    mockCompensate(generation),
}));
jest.mock('@/lib/checkout-attempt-credit-snapshot', () => ({
  releaseCheckoutCreditSnapshot: (generation: string) =>
    mockRelease(generation),
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
  mockRelease.mockReset();
  mockRelease.mockResolvedValue(undefined);
  mockCompensate.mockReset();
  mockCompensate.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
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

it('still returns after a never-resolving generation write', async () => {
  jest.useFakeTimers();
  mockPersist.mockImplementation(() => new Promise(() => undefined));
  const applied: ReturnType<typeof emptyCheckoutCart>[] = [];
  const rotation = rotateEmptyCheckoutCart((next) => {
    applied.push(next);
  });
  await jest.advanceTimersByTimeAsync(5_000);
  await expect(rotation).resolves.toEqual(applied[0]);
  expect(applied[0]?.items).toEqual([]);
  jest.useRealTimers();
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

it('releases store-credit snapshots after payment finalizes the generation', async () => {
  const previousGeneration = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
  await rotateEmptyCheckoutCart(() => undefined, {
    previousGeneration,
    retainCreditSnapshot: false,
  });
  expect(mockRelease).toHaveBeenCalledWith(previousGeneration);
});

it('persists the rotated generation before cleaning up snapshots', async () => {
  await rotateEmptyCheckoutCart(() => undefined, {
    previousGeneration: '46ed63d7-5f10-49f0-9456-9ff571bec43f',
    retainCreditSnapshot: false,
  });
  const persistOrder = mockPersist.mock.invocationCallOrder[0] ?? 0;
  const releaseOrder = mockRelease.mock.invocationCallOrder[0] ?? 0;
  expect(mockPersist).toHaveBeenCalled();
  expect(mockRelease).toHaveBeenCalled();
  expect(persistOrder).toBeLessThan(releaseOrder);
});

it('keeps store-credit snapshots when the generation may still be replayed', async () => {
  await rotateEmptyCheckoutCart(() => undefined, {
    previousGeneration: '46ed63d7-5f10-49f0-9456-9ff571bec43f',
    retainCreditSnapshot: true,
  });
  expect(mockRelease).not.toHaveBeenCalled();
});

it('invalidates an abandoned persist when it settles after the timeout', async () => {
  jest.useFakeTimers();
  let settlePersist!: () => void;
  mockPersist.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settlePersist = resolve;
      })
  );
  let rotatedGeneration = '';
  const rotated = rotateEmptyCheckoutCart((next) => {
    rotatedGeneration = next.checkoutGeneration;
  });
  await jest.advanceTimersByTimeAsync(5_000);
  await rotated;
  expect(mockClear).toHaveBeenCalled();
  expect(mockCompensate).not.toHaveBeenCalled();
  settlePersist();
  await Promise.resolve();
  await Promise.resolve();
  expect(mockCompensate).toHaveBeenCalledWith(rotatedGeneration);
});

it('does not block cart rotation when credit cleanup hangs', async () => {
  jest.useFakeTimers();
  mockRelease.mockImplementationOnce(() => new Promise<void>(() => undefined));
  const rotated = rotateEmptyCheckoutCart(() => undefined, {
    previousGeneration: '46ed63d7-5f10-49f0-9456-9ff571bec43f',
    retainCreditSnapshot: false,
  });
  await jest.advanceTimersByTimeAsync(5_000);
  await expect(rotated).resolves.toBeDefined();
});
