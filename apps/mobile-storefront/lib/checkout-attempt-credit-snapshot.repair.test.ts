import { CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY } from '@/config/checkout-storage';

function loadSnapshot() {
  return require('./checkout-attempt-credit-snapshot') as typeof import('./checkout-attempt-credit-snapshot');
}

function loadRelease() {
  return require('./release-checkout-credit-snapshot') as typeof import('./release-checkout-credit-snapshot');
}

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';

function snapshotKey(id: string): string {
  return `${CHECKOUT_ATTEMPT_CREDIT_STORAGE_KEY}:${id}`;
}

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('restores the newer choice when an abandoned write lands after a retry', async () => {
  jest.useFakeTimers();
  let releaseWrite!: () => void;
  let writeEntered!: () => void;
  const writeEnteredPromise = new Promise<void>((resolve) => {
    writeEntered = resolve;
  });
  mockSetItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = () => {
          storage.set(
            snapshotKey(generation),
            JSON.stringify({ wallet_amount: 1000 })
          );
          resolve();
        };
        writeEntered();
      })
  );
  const first = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  await writeEnteredPromise;
  const firstAssertion = expect(first).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await firstAssertion;

  const retry = await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  expect(retry.wallet_amount).toBe(5000);

  let restored!: () => void;
  const restoredPromise = new Promise<void>((resolve) => {
    restored = resolve;
  });
  mockSetItem.mockImplementationOnce(async (key: string, value: string) => {
    storage.set(key, value);
    restored();
  });
  releaseWrite();
  await restoredPromise;
  expect(
    JSON.parse(storage.get(snapshotKey(generation)) ?? '{}') as {
      wallet_amount?: number;
    }
  ).toEqual({ wallet_amount: 5000 });
});

it('removes a late snapshot write that lands after a release tombstone', async () => {
  jest.useFakeTimers();
  let releaseWrite!: () => void;
  let writeEntered!: () => void;
  const writeEnteredPromise = new Promise<void>((resolve) => {
    writeEntered = resolve;
  });
  mockSetItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = () => {
          storage.set(
            snapshotKey(generation),
            JSON.stringify({ wallet_amount: 1000 })
          );
          resolve();
        };
        writeEntered();
      })
  );
  const first = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  await writeEnteredPromise;
  const firstAssertion = expect(first).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await firstAssertion;

  await loadRelease().releaseCheckoutCreditSnapshot(generation);
  expect(storage.get(snapshotKey(generation))).toBeUndefined();

  let repaired!: () => void;
  const repairedPromise = new Promise<void>((resolve) => {
    repaired = resolve;
  });
  mockRemoveItem.mockImplementationOnce(async (key: string) => {
    storage.delete(key);
    repaired();
  });
  releaseWrite();
  await repairedPromise;
  expect(storage.get(snapshotKey(generation))).toBeUndefined();

  const retry = await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  expect(retry.wallet_amount).toBe(5000);
});

it('does not resurrect a snapshot released while a repair read is pending', async () => {
  jest.useFakeTimers();
  let releaseWrite!: () => void;
  let writeEntered!: () => void;
  const writeEnteredPromise = new Promise<void>((resolve) => {
    writeEntered = resolve;
  });
  mockSetItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = () => {
          storage.set(
            snapshotKey(generation),
            JSON.stringify({ wallet_amount: 1000 })
          );
          resolve();
        };
        writeEntered();
      })
  );
  const first = loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 1000 },
    generation
  );
  await writeEnteredPromise;
  const firstAssertion = expect(first).rejects.toThrow(
    'Checkout storage read timed out'
  );
  await jest.advanceTimersByTimeAsync(5_000);
  await firstAssertion;

  const retry = await loadSnapshot().applyCheckoutCreditSnapshot(
    { wallet_amount: 5000 },
    generation
  );
  expect(retry.wallet_amount).toBe(5000);

  // Gate the repair's storage read so the release lands between the
  // repair's queue entry and its write.
  let releaseRepairRead!: () => void;
  let repairReadEntered!: () => void;
  const repairReadEnteredPromise = new Promise<void>((resolve) => {
    repairReadEntered = resolve;
  });
  mockGetItem.mockImplementationOnce(
    () =>
      new Promise<string | null>((resolve) => {
        releaseRepairRead = () => {
          resolve(JSON.stringify({ wallet_amount: 1000 }));
        };
        repairReadEntered();
      })
  );
  let removed!: () => void;
  const removedPromise = new Promise<void>((resolve) => {
    removed = resolve;
  });
  mockRemoveItem.mockImplementationOnce(async (key: string) => {
    storage.delete(key);
    removed();
  });
  releaseWrite();
  await repairReadEnteredPromise;
  const releasing = loadRelease().releaseCheckoutCreditSnapshot(generation);
  await releasing;
  releaseRepairRead();
  await removedPromise;
  // The abandoned write plus the retry are the only writes: the repair
  // rechecked after its read, saw the tombstone, and stood down.
  expect(mockSetItem).toHaveBeenCalledTimes(2);
  expect(storage.get(snapshotKey(generation))).toBeUndefined();
});
