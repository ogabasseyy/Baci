import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { releaseCheckoutPurchaseTracking } from './claim-checkout-purchase-release';
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

it('frees a released claim for re-claim without disturbing other claims', async () => {
  await expect(
    claimCheckoutPurchaseTracking('order-1', 'payment_completed')
  ).resolves.toBe(true);
  await expect(
    claimCheckoutPurchaseTracking('order-2', 'payment_completed')
  ).resolves.toBe(true);

  await expect(
    releaseCheckoutPurchaseTracking('order-1', 'payment_completed')
  ).resolves.toBeUndefined();

  // The released order can emit again (e.g. the guarded ad purchase
  // rejected); the sibling grant still suppresses its replay.
  await expect(
    claimCheckoutPurchaseTracking('order-1', 'payment_completed')
  ).resolves.toBe(true);
  await expect(
    claimCheckoutPurchaseTracking('order-2', 'payment_completed')
  ).resolves.toBe(false);
});

it('ignores releasing a claim that was never granted', async () => {
  await expect(
    releaseCheckoutPurchaseTracking('order-ghost', 'payment_completed')
  ).resolves.toBeUndefined();
  await expect(
    claimCheckoutPurchaseTracking('order-ghost', 'payment_completed')
  ).resolves.toBe(true);
});

it('does not re-track a persisted claim after process memory is gone', async () => {
  storage.set(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    JSON.stringify({ version: 2, claims: ['order-1'] })
  );
  await expect(claimCheckoutPurchaseTracking('order-1')).resolves.toBe(false);
});

it('migrates legacy bare purchase claims so upgrades cannot double-emit completion', async () => {
  // Pre-namespacing checkouts stored the native purchase under the bare
  // order id: reopening that order after the upgrade must not grant a
  // fresh payment_completed claim.
  storage.set(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    JSON.stringify(['order-legacy'])
  );
  await expect(
    claimCheckoutPurchaseTracking('order-legacy', 'payment_completed')
  ).resolves.toBe(false);
});

it('does not let a new order_created bare claim suppress its completion', async () => {
  // Current code stores bare ids for order_created, so bare-id matching at
  // claim time would suppress every new completion. The migration must only
  // apply to the unversioned upgrade layout, not to fresh bare claims.
  await expect(claimCheckoutPurchaseTracking('order-new')).resolves.toBe(true);
  await expect(
    claimCheckoutPurchaseTracking('order-new', 'payment_completed')
  ).resolves.toBe(true);
  await expect(
    claimCheckoutPurchaseTracking('order-new', 'payment_completed')
  ).resolves.toBe(false);
});

it('persists the versioned envelope on the first post-upgrade write', async () => {
  storage.set(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    JSON.stringify(['order-legacy'])
  );
  await expect(claimCheckoutPurchaseTracking('order-fresh')).resolves.toBe(
    true
  );

  const stored = parseStoredClaimsForTest(
    storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
  );
  expect(stored).toContain('order-fresh');
  expect(stored).toContain('payment_completed:order-legacy');
  const raw = storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY) ?? '';
  expect(JSON.parse(raw)).toMatchObject({ version: 2 });
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

it('reconciles newer claims when a timed-out write lands after them', async () => {
  jest.useFakeTimers();
  try {
    // The first write hangs until released manually: the caller times out,
    // the queue is released, a newer claim succeeds — and only then does
    // the stale write land, clobbering the newer envelope.
    let releaseStaleWrite!: () => void;
    let writeCalls = 0;
    mockSetItem.mockImplementation((key: string, value: string) => {
      writeCalls += 1;
      if (writeCalls === 1) {
        return new Promise<void>((resolve) => {
          releaseStaleWrite = () => {
            storage.set(key, value);
            resolve();
          };
        });
      }
      storage.set(key, value);
      return Promise.resolve();
    });
    const first = claimCheckoutPurchaseTracking('order-stale');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    // The maximum queue hold starts when the timed-out caller settles, so
    // the release lands ~13s in: advance past it for the newer claim.
    await jest.advanceTimersByTimeAsync(11000);
    await expect(claimCheckoutPurchaseTracking('order-newer')).resolves.toBe(
      true
    );
    expect(
      parseStoredClaimsForTest(
        storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
      )
    ).toContain('order-newer');

    // The stale write lands after the newer claim: the rollback must drop
    // the phantom original claim while restoring the newer one, so neither
    // event can emit twice.
    releaseStaleWrite();
    await jest.advanceTimersByTimeAsync(1000);
    const stored = parseStoredClaimsForTest(
      storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
    );
    expect(stored).toContain('order-newer');
    expect(stored).not.toContain('order-stale');
    await expect(claimCheckoutPurchaseTracking('order-newer')).resolves.toBe(
      false
    );
  } finally {
    jest.useRealTimers();
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  }
});

it('reconciles again when the rollback write lands after a newer grant', async () => {
  jest.useFakeTimers();
  try {
    // Write #1 (the claim) and write #3 (its compensating rollback) hang
    // until released manually; every other write lands immediately.
    const pendingWrites: Array<() => void> = [];
    let writeCalls = 0;
    mockSetItem.mockImplementation((key: string, value: string) => {
      writeCalls += 1;
      if (writeCalls === 1 || writeCalls === 3) {
        return new Promise<void>((resolve) => {
          pendingWrites.push(() => {
            storage.set(key, value);
            resolve();
          });
        });
      }
      storage.set(key, value);
      return Promise.resolve();
    });
    const first = claimCheckoutPurchaseTracking('order-stale');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    // Queue released; a newer claim succeeds on the old envelope.
    await jest.advanceTimersByTimeAsync(11000);
    await expect(claimCheckoutPurchaseTracking('order-newer')).resolves.toBe(
      true
    );

    // The stale claim write lands and its rollback runs, but the rollback
    // write hangs: its caller race expires and the queue advances.
    pendingWrites[0]();
    await jest.advanceTimersByTimeAsync(4000);
    // Granted on the still-stale read (rollback not landed yet).
    await expect(claimCheckoutPurchaseTracking('order-third')).resolves.toBe(
      true
    );

    // The stale rollback lands, erasing the third grant — the attached
    // compensation must restore it without resurrecting the phantom.
    pendingWrites[1]();
    await jest.advanceTimersByTimeAsync(1000);
    const stored = parseStoredClaimsForTest(
      storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
    );
    expect(stored).toContain('order-newer');
    expect(stored).toContain('order-third');
    expect(stored).not.toContain('order-stale');
    await expect(claimCheckoutPurchaseTracking('order-newer')).resolves.toBe(
      false
    );
    await expect(claimCheckoutPurchaseTracking('order-third')).resolves.toBe(
      false
    );
  } finally {
    jest.useRealTimers();
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  }
});

it('reconciles a rollback that lands within its timeout after a newer grant', async () => {
  jest.useFakeTimers();
  try {
    // Write #1 (the claim) hangs until released manually; write #3 (its
    // compensating rollback) is slow but lands inside its own three-second
    // race. Every other write lands immediately.
    let releaseStaleWrite!: () => void;
    let writeCalls = 0;
    mockSetItem.mockImplementation((key: string, value: string) => {
      writeCalls += 1;
      if (writeCalls === 1) {
        return new Promise<void>((resolve) => {
          releaseStaleWrite = () => {
            storage.set(key, value);
            resolve();
          };
        });
      }
      if (writeCalls === 3) {
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            storage.set(key, value);
            resolve();
          }, 1000);
        });
      }
      storage.set(key, value);
      return Promise.resolve();
    });
    const first = claimCheckoutPurchaseTracking('order-prompt-stale');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    // Queue released; a newer claim succeeds on the old envelope.
    await jest.advanceTimersByTimeAsync(11000);
    await expect(
      claimCheckoutPurchaseTracking('order-prompt-newer')
    ).resolves.toBe(true);

    // The stale claim write lands and its rollback starts, but the
    // rollback write needs a second to land — meanwhile a third claim is
    // granted on the still-stale read.
    releaseStaleWrite();
    await jest.advanceTimersByTimeAsync(500);
    await expect(
      claimCheckoutPurchaseTracking('order-prompt-third')
    ).resolves.toBe(true);

    // The rollback lands after the third grant but before its own
    // three-second timeout, erasing it: the settlement-attached
    // reconciliation must restore the third grant without resurrecting
    // the phantom stale claim.
    await jest.advanceTimersByTimeAsync(2000);
    const stored = parseStoredClaimsForTest(
      storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
    );
    expect(stored).toContain('order-prompt-newer');
    expect(stored).toContain('order-prompt-third');
    expect(stored).not.toContain('order-prompt-stale');
    await expect(
      claimCheckoutPurchaseTracking('order-prompt-newer')
    ).resolves.toBe(false);
    await expect(
      claimCheckoutPurchaseTracking('order-prompt-third')
    ).resolves.toBe(false);
  } finally {
    jest.useRealTimers();
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  }
});

it('releases the queue when a write never settles', async () => {
  jest.useFakeTimers();
  try {
    // Reads succeed but writes hang forever: the first caller still fails
    // closed at three seconds, and the next claim gets its turn instead of
    // queueing behind the hung write.
    mockSetItem.mockImplementation(() => new Promise<void>(() => undefined));
    const first = claimCheckoutPurchaseTracking('order-hung');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    const second = claimCheckoutPurchaseTracking('order-next');
    await jest.advanceTimersByTimeAsync(15000);
    // The store is wedged so this claim also fails closed — the point is it
    // resolves at all instead of waiting on the hung write forever.
    await expect(second).resolves.toBe(false);
    // Let the maximum queue hold elapse before tearing down fake timers:
    // otherwise the chain tail stays bound to a discarded fake timer and
    // every later test in this file inherits a permanently wedged queue.
    await jest.advanceTimersByTimeAsync(12000);
  } finally {
    jest.useRealTimers();
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  }
});

it('retries a release whose store read timed out so the next poll can emit', async () => {
  jest.useFakeTimers();
  try {
    // Flush any queue hold inherited from earlier tests (at most the
    // 10s maximum) so the opening grant does not wait on fake time that
    // this test never advances before asserting it.
    await jest.advanceTimersByTimeAsync(12000);
    // Grant while the store is healthy.
    await expect(
      claimCheckoutPurchaseTracking('order-retry-release', 'payment_completed')
    ).resolves.toBe(true);

    // The release read hangs: the caller is answered now, but the
    // persisted claim remains.
    mockGetItem.mockImplementation(
      () => new Promise<string | null>(() => undefined)
    );
    const released = releaseCheckoutPurchaseTracking(
      'order-retry-release',
      'payment_completed'
    );
    await jest.advanceTimersByTimeAsync(3000);
    await released;

    // The store recovers: a scheduled retry pass removes the stale claim,
    // so a later poll re-claims and emits instead of reading the stale
    // claim, classifying it as already-emitted, and stopping forever.
    mockGetItem.mockImplementation(
      async (key: string) => storage.get(key) ?? null
    );
    await jest.advanceTimersByTimeAsync(8000);
    expect(
      parseStoredClaimsForTest(
        storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY)
      )
    ).not.toContain('payment_completed:order-retry-release');
    await expect(
      claimCheckoutPurchaseTracking('order-retry-release', 'payment_completed')
    ).resolves.toBe(true);
  } finally {
    jest.useRealTimers();
    mockGetItem.mockImplementation(
      async (key: string) => storage.get(key) ?? null
    );
  }
});

it('retries a release whose store read rejects so the next poll can emit', async () => {
  await expect(
    claimCheckoutPurchaseTracking('order-retry-reject', 'payment_completed')
  ).resolves.toBe(true);

  // A non-timeout rejection takes the catch path: the caller is answered
  // while the persisted claim remains, and the scheduled retry must
  // remove it once the store answers again.
  mockGetItem.mockRejectedValueOnce(new Error('store down'));
  await releaseCheckoutPurchaseTracking(
    'order-retry-reject',
    'payment_completed'
  );

  // The retry is chained directly behind the release, so this re-claim
  // deterministically observes the post-retry store: success proves the
  // stale claim is gone and a later poll can emit.
  await expect(
    claimCheckoutPurchaseTracking('order-retry-reject', 'payment_completed')
  ).resolves.toBe(true);
});

function parseStoredClaimsForTest(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries =
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      'claims' in parsed
        ? parsed.claims
        : parsed;
    return Array.isArray(entries)
      ? entries.filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        )
      : [];
  } catch {
    return [];
  }
}
