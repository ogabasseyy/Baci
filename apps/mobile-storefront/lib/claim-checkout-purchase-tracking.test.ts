import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { claimCheckoutPurchaseTracking } from './claim-checkout-purchase-tracking';

const storage = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string) => storage.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }),
}));

beforeEach(() => {
  storage.clear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
});

it('tracks the first observed order id and ignores a later replay of the same order', async () => {
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(true);
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(false);
  await expect(claimCheckoutPurchaseTracking('order-2')).resolves.toBe(true);
});

it('does not re-track a persisted claim after process memory is gone', async () => {
  storage.set(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    JSON.stringify(['order-1'])
  );
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(false);
});

it('grants overlapping claims for different events without losing either', async () => {
  // Slow the store so both claims are in flight together; without
  // serialization the second read lands before the first write and one
  // claim is silently dropped (lost update).
  mockGetItem.mockImplementation(async (key: string) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return storage.get(key) ?? null;
  });

  const [created, invoiced] = await Promise.all([
    claimCheckoutPurchaseTracking('order-9', 'order_created'),
    claimCheckoutPurchaseTracking('order-9', 'invoice_generated'),
  ]);

  expect(created).toBe(true);
  expect(invoiced).toBe(true);
  await expect(
    claimCheckoutPurchaseTracking('order-9', 'order_created')
  ).resolves.toBe(false);
  await expect(
    claimCheckoutPurchaseTracking('order-9', 'invoice_generated')
  ).resolves.toBe(false);
  mockGetItem.mockImplementation(
    async (key: string) => storage.get(key) ?? null
  );
});

it('fails closed when the store never settles instead of queuing forever', async () => {
  jest.useFakeTimers();
  try {
    mockGetItem.mockImplementation(
      () => new Promise<string | null>(() => undefined)
    );
    const pending = expect(
      claimCheckoutPurchaseTracking('order-timeout')
    ).resolves.toBe(false);

    await jest.advanceTimersByTimeAsync(3000);
    await pending;
  } finally {
    jest.useRealTimers();
    mockGetItem.mockImplementation(
      async (key: string) => storage.get(key) ?? null
    );
  }
});

it('leaves no phantom claim when a timed-out write lands late', async () => {
  jest.useFakeTimers();
  try {
    // Writes land after the three-second caller timeout: the caller
    // reports failure, but the write still commits afterwards.
    mockSetItem.mockImplementation(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            storage.set(key, value);
            resolve();
          }, 3500);
        })
    );
    const first = claimCheckoutPurchaseTracking('order-late');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    // The late write lands, the compensating rollback removes exactly that
    // claim, and the queue is released: a replay claims successfully and
    // the event is emitted exactly once.
    await jest.advanceTimersByTimeAsync(8000);
    expect(
      parseStoredClaimsForTest(
        storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
      )
    ).not.toContain('order-late');
    // With the store healthy again, the replay claims successfully: no
    // phantom claim survived the timed-out write.
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
    await expect(claimCheckoutPurchaseTracking('order-late')).resolves.toBe(
      true
    );
  } finally {
    jest.useRealTimers();
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  }
});

function parseStoredClaimsForTest(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        )
      : [];
  } catch {
    return [];
  }
}
