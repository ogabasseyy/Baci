import {
  CHECKOUT_GENERATION_STORAGE_KEY,
  CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY,
} from '@/config/checkout-storage';
import { usesCodepointCheckoutItemSort } from '@/lib/checkout-idempotency-item-sort';
import { rotateEmptyCheckoutCart } from './rotate-empty-checkout-cart';

const GENERATION_KEY = CHECKOUT_GENERATION_STORAGE_KEY;
const MARKER_KEY = CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY;

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});
const mockRandomUUID = jest.fn(() => 'ffffffff-ffff-4fff-8fff-ffffffffffff');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

const firstGeneration = '22222222-2222-4222-8222-222222222222';
const secondGeneration = '33333333-3333-4333-8333-333333333333';
const markedGeneration = '99999999-9999-4999-8999-999999999999';

let storageHung = false;
let releaseWrites: Array<() => void> = [];

beforeEach(() => {
  storage.clear();
  storageHung = false;
  releaseWrites = [];
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(
    async (key: string) => storage.get(key) ?? null
  );
  mockSetItem.mockReset();
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    if (key === GENERATION_KEY && storageHung) {
      await new Promise<void>((resolve) => {
        releaseWrites.push(resolve);
      });
    }
    storage.set(key, value);
  });
  mockRemoveItem.mockReset();
  mockRemoveItem.mockImplementation(async (key: string) => {
    storage.delete(key);
  });
  mockRandomUUID.mockReset();
  mockRandomUUID.mockImplementation(
    () => 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  );
  mockRandomUUID
    .mockReturnValueOnce(firstGeneration)
    .mockReturnValueOnce(secondGeneration);
});

afterEach(() => {
  jest.useRealTimers();
});

function recoverStorage() {
  storageHung = false;
  const pending = releaseWrites;
  releaseWrites = [];
  for (const release of pending) {
    release();
  }
}

it('clears across repeated persist timeouts without wedging reads, then progresses after recovery', async () => {
  jest.useFakeTimers();
  storage.set(`${MARKER_KEY}:${markedGeneration}`, '1');
  storageHung = true;

  const first = rotateEmptyCheckoutCart(() => undefined);
  await jest.advanceTimersByTimeAsync(5_000);
  await first;
  expect(storage.get(GENERATION_KEY)).toBeUndefined();

  const second = rotateEmptyCheckoutCart(() => undefined);
  await jest.advanceTimersByTimeAsync(5_000);
  await second;
  expect(storage.get(GENERATION_KEY)).toBeUndefined();

  // Each timed-out persist resets the storage queue, so a read after the
  // resets proceeds on the fresh queue and observes the durable marker
  // instead of hanging behind the abandoned writes.
  await expect(usesCodepointCheckoutItemSort(markedGeneration)).resolves.toBe(
    true
  );

  recoverStorage();
  await expect(usesCodepointCheckoutItemSort(markedGeneration)).resolves.toBe(
    true
  );
});

it('invalidates a slow write that lands after recovery without touching newer state', async () => {
  jest.useFakeTimers();
  storageHung = true;

  const first = rotateEmptyCheckoutCart(() => undefined);
  await jest.advanceTimersByTimeAsync(5_000);
  await first;
  expect(storage.get(GENERATION_KEY)).toBeUndefined();

  let compensated!: () => void;
  const compensatedPromise = new Promise<void>((resolve) => {
    compensated = resolve;
  });
  mockRemoveItem.mockImplementation(async (key: string) => {
    storage.delete(key);
    if (key === GENERATION_KEY) {
      compensated();
    }
  });

  recoverStorage();
  await compensatedPromise;
  expect(storage.get(GENERATION_KEY)).toBeUndefined();

  const second = rotateEmptyCheckoutCart(() => undefined);
  await second;
  expect(storage.get(GENERATION_KEY)).toBe(secondGeneration);
});

it('lets a newer persist proceed on the reset queue while an older write hangs', async () => {
  jest.useFakeTimers();
  let releaseOlder!: () => void;
  let olderGated = false;
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    if (key === GENERATION_KEY && !olderGated) {
      olderGated = true;
      await new Promise<void>((resolve) => {
        releaseOlder = resolve;
      });
    }
    storage.set(key, value);
  });

  const first = rotateEmptyCheckoutCart(() => undefined);
  await jest.advanceTimersByTimeAsync(5_000);
  await first;

  const second = rotateEmptyCheckoutCart(() => undefined);
  await second;
  expect(storage.get(GENERATION_KEY)).toBe(secondGeneration);

  let compensated!: () => void;
  const compensatedPromise = new Promise<void>((resolve) => {
    compensated = resolve;
  });
  mockRemoveItem.mockImplementation(async (key: string) => {
    storage.delete(key);
    if (key === GENERATION_KEY) {
      compensated();
    }
  });
  releaseOlder();
  await compensatedPromise;
  expect(storage.get(GENERATION_KEY)).toBeUndefined();
});
