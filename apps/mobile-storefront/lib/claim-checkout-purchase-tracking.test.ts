import { CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY } from '@/config/checkout-storage';
import { releaseCheckoutPurchaseTracking } from './claim-checkout-purchase-release';
import {
  claimCheckoutPurchaseTracking,
  isCheckoutPurchaseClaimed,
  isCheckoutPurchaseClaimedSettled,
} from './claim-checkout-purchase-tracking';

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

it('keeps the completion key claimable for legacy bare purchase claims', async () => {
  // Pre-namespacing checkouts stored the native purchase under the bare
  // order id — including for orders created but not yet paid. The
  // migration carries the bare id forward as purchase dedupe only and
  // must still grant a fresh payment_completed claim: suppressing it
  // would permanently silence the canonical completion for outstanding
  // orders that settle after the upgrade. Reopening a paid order stays
  // safe because the completion lane skips the ad purchase whenever the
  // bare purchase claim is held.
  storage.set(
    CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
    JSON.stringify(['order-legacy'])
  );
  await expect(
    claimCheckoutPurchaseTracking('order-legacy', 'payment_completed')
  ).resolves.toBe(true);
  // Release the grant: the in-memory grant set outlives this test and
  // would otherwise leak into the envelope test below.
  await releaseCheckoutPurchaseTracking('order-legacy', 'payment_completed');
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
  // The legacy bare id survives as purchase dedupe; no completion claim
  // is synthesized for it (see the test above).
  expect(stored).toContain('order-legacy');
  expect(stored).not.toContain('payment_completed:order-legacy');
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

it('waits for timed-out write compensation before reporting held', async () => {
  jest.useFakeTimers();
  try {
    // Writes land after the three-second caller timeout: the claim call
    // reports failure while the late write (a phantom persisted claim)
    // and its rollback are still settling.
    mockSetItem.mockImplementation(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            storage.set(key, value);
            resolve();
          }, 3500);
        })
    );
    const first = claimCheckoutPurchaseTracking('order-settled-read');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    // The late write has landed but the rollback has not run yet: the
    // raw read observes the phantom claim here.
    await jest.advanceTimersByTimeAsync(500);
    await expect(isCheckoutPurchaseClaimed('order-settled-read')).resolves.toBe(
      true
    );

    // The settled read waits behind the serialized compensation instead
    // of mistaking the phantom for a recorded conversion.
    const settled = isCheckoutPurchaseClaimedSettled('order-settled-read');
    await jest.advanceTimersByTimeAsync(8000);
    await expect(settled).resolves.toBe(false);
  } finally {
    jest.useRealTimers();
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
  }
});

it('drains tracked compensation past the queue hold before reporting held', async () => {
  jest.useFakeTimers();
  try {
    // The claim write lands after the ten-second queue hold, so the
    // chain has already released while the rollback is still landing —
    // chain position alone cannot prove the phantom is gone.
    let writeCalls = 0;
    mockSetItem.mockImplementation((key: string, value: string) => {
      writeCalls += 1;
      const delayMs = writeCalls === 1 ? 12_000 : 1_000;
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          storage.set(key, value);
          resolve();
        }, delayMs);
      });
    });
    const first = claimCheckoutPurchaseTracking('order-hold-expiry');
    await jest.advanceTimersByTimeAsync(3000);
    await expect(first).resolves.toBe(false);

    // t=12s: the late write has landed while the rollback is still in
    // flight — the raw read observes the phantom claim here.
    await jest.advanceTimersByTimeAsync(9000);
    await expect(isCheckoutPurchaseClaimed('order-hold-expiry')).resolves.toBe(
      true
    );

    // The settled read drains the tracked compensation (rollback lands
    // ~t=13s) instead of trusting the released chain: by t=13.5s — long
    // before its own ten-second drain bound (t=22s) — it must already
    // report unheld. A timeout-bound read would still be pending here.
    let outcome: boolean | 'pending' = 'pending';
    const settled = isCheckoutPurchaseClaimedSettled('order-hold-expiry').then(
      (held) => {
        outcome = held;
        return held;
      }
    );
    await jest.advanceTimersByTimeAsync(1500);
    expect(outcome).toBe(false);
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(settled).resolves.toBe(false);
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

describe('completion claim leases', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const START = 1_700_000_000_000;
  const CLAIM = 'payment_completed:order-lease-1';
  let nowSpy: jest.Spied<typeof Date.now>;
  // Bound per test from a fresh module registry: the in-process grant set
  // cannot be cleared any other way, and cross-restart recovery is exactly
  // what these tests prove. The mocked AsyncStorage (the `storage` map)
  // survives the reset, so it plays the role of the disk.
  type TrackingModule = typeof import('./claim-checkout-purchase-tracking');
  let fresh: TrackingModule;

  function restart(): void {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fresh = require('./claim-checkout-purchase-tracking') as TrackingModule;
  }

  function readEnvelopeLeases(): Record<
    string,
    { claimedAt: number; emittedAt?: number }
  > {
    const raw = storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as { leases?: unknown };
    return (parsed.leases ?? {}) as Record<
      string,
      { claimedAt: number; emittedAt?: number }
    >;
  }

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(START);
    restart();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stamps a lease inside the grant envelope and keeps a fresh claim held', async () => {
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(true);
    // Grant and lease land in one versioned envelope write — never in a
    // second key that could tear.
    const raw = storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY) ?? '';
    expect(JSON.parse(raw)).toMatchObject({ version: 2 });
    expect(readEnvelopeLeases()[CLAIM]?.claimedAt).toBe(START);
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(false);
    await expect(
      fresh.isCheckoutPurchaseClaimedSettled(
        'order-lease-1',
        'payment_completed'
      )
    ).resolves.toBe(true);
  });

  it('recovers an aged claim that was never emitted', async () => {
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(true);
    // A day later, after a restart: the claim reads unheld and the next
    // grant recovers it for emission with a refreshed lease.
    restart();
    nowSpy.mockReturnValue(START + DAY_MS + 1000);
    await expect(
      fresh.isCheckoutPurchaseClaimedSettled(
        'order-lease-1',
        'payment_completed'
      )
    ).resolves.toBe(false);
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(true);
    expect(readEnvelopeLeases()[CLAIM]?.claimedAt).toBe(START + DAY_MS + 1000);
  });

  it('never recovers an emitted claim, however old', async () => {
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(true);
    await fresh.markCheckoutPurchaseEmitted(
      'order-lease-1',
      'payment_completed'
    );
    expect(readEnvelopeLeases()[CLAIM]?.emittedAt).toBe(START);
    restart();
    nowSpy.mockReturnValue(START + 7 * DAY_MS);
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(false);
    await expect(
      fresh.isCheckoutPurchaseClaimedSettled(
        'order-lease-1',
        'payment_completed'
      )
    ).resolves.toBe(true);
  });

  it('never recovers a legacy claim with no lease record', async () => {
    storage.set(
      CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY,
      JSON.stringify({ version: 2, claims: [CLAIM] })
    );
    nowSpy.mockReturnValue(START + 30 * DAY_MS);
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(false);
  });

  it('repairs a stale lease for a still-granted claim on the next persist', async () => {
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-1', 'payment_completed')
    ).resolves.toBe(true);
    // A timed-out write lands late with a snapshot that predates the
    // grant: the lease reads orphaned although the claim is held. The next
    // persist must stamp it fresh instead of letting a later poll recover
    // (and double-emit) it.
    const raw = storage.get(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY) ?? '';
    const stale = JSON.parse(raw) as {
      version: number;
      claims: string[];
      leases: Record<string, { claimedAt: number }>;
    };
    stale.leases[CLAIM] = { claimedAt: START - 2 * DAY_MS };
    storage.set(CHECKOUT_PURCHASE_TRACKING_STORAGE_KEY, JSON.stringify(stale));
    await expect(
      fresh.claimCheckoutPurchaseTracking('order-lease-2', 'payment_completed')
    ).resolves.toBe(true);
    expect(readEnvelopeLeases()[CLAIM]?.claimedAt).toBe(START);
    await expect(
      fresh.isCheckoutPurchaseClaimedSettled(
        'order-lease-1',
        'payment_completed'
      )
    ).resolves.toBe(true);
  });
});
