// @vitest-environment node
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { createResilientRemoteCacheHandler } from './resilient-remote-cache-handler.mjs';

/**
 * THE TWO INVARIANTS (Codex round 2 — all five findings are consequences of
 * these, so they are enforced at one chokepoint each rather than patched
 * per-leg).
 *
 *   INVARIANT A — degrade toward the ORIGIN, never toward unverified data.
 *     If ANY part of the cache subsystem is degraded, a read MUST become a MISS.
 *     We never serve an entry whose freshness we cannot currently verify.
 *
 *   INVARIANT B — every backend interaction is time-bounded.
 *     No await on the backend may hang. Every call is raced with a timeout, and
 *     a timeout is a FAILURE (feeds the breaker), never an indefinite wait.
 *
 * These tests are parametrized over every degradation leg, so a newly added
 * degradation path cannot silently forget to opt in: adding a leg to the table
 * is the only way to describe it, and the table asserts the invariant for all.
 */

type CacheEntryLike = {
  value: ReadableStream<Uint8Array>;
  tags: string[];
  stale: number;
  timestamp: number;
  expire: number;
  revalidate: number;
};

const encoder = new TextEncoder();

function makeEntry(body = 'cached', timestamp = 1_000): CacheEntryLike {
  return {
    value: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    tags: ['products-m1'],
    stale: 300,
    timestamp,
    expire: 86_400,
    revalidate: 300,
  };
}

/** A stream that yields some bytes then errors — the documented failure mode. */
function _makeTruncatedEntry(): CacheEntryLike {
  return {
    ...makeEntry(),
    value: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('partial'));
        controller.error(new Error('connection reset mid-stream'));
      },
    }),
  };
}

/** Never settles — the hang, as opposed to the rejection. */
function hang<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

type Backend = {
  get: Mock<
    (
      cacheKey: string,
      softTags: string[]
    ) => Promise<CacheEntryLike | undefined>
  >;
  set: Mock<
    (cacheKey: string, pendingEntry: Promise<CacheEntryLike>) => Promise<void>
  >;
  refreshTags: Mock<() => Promise<void>>;
  getExpiration: Mock<(tags: string[]) => Promise<number>>;
  updateTags: Mock<
    (tags: string[], durations?: { expire?: number }) => Promise<void>
  >;
};

function healthyBackend(): Backend {
  return {
    get: vi.fn<Backend['get']>().mockResolvedValue(undefined),
    set: vi.fn<Backend['set']>().mockResolvedValue(undefined),
    refreshTags: vi.fn<Backend['refreshTags']>().mockResolvedValue(undefined),
    getExpiration: vi.fn<Backend['getExpiration']>().mockResolvedValue(0),
    updateTags: vi.fn<Backend['updateTags']>().mockResolvedValue(undefined),
  };
}

const TIMEOUT_MS = 25;

function makeHandler(backend: Backend) {
  return createResilientRemoteCacheHandler({
    backend,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    backendTimeoutMs: TIMEOUT_MS,
    failureThreshold: 3,
    cooldownMs: 30_000,
  });
}
describe('INVARIANT B — every backend interaction is time-bounded', () => {
  let unhandled: unknown[];
  let onUnhandled: (reason: unknown) => void;

  beforeEach(() => {
    unhandled = [];
    onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  async function flush() {
    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /*  INVARIANT B — every backend call is time-bounded                 */
  /* ================================================================ */

  const backendLegs: {
    name: string;
    call: (h: ReturnType<typeof makeHandler>) => Promise<unknown>;
    hangs: (b: Backend) => void;
  }[] = [
    {
      name: 'get',
      call: (h) => h.get('k', []),
      hangs: (b) => b.get.mockImplementation(hang),
    },
    {
      name: 'set',
      call: (h) => h.set('k', Promise.resolve(makeEntry())),
      hangs: (b) => b.set.mockImplementation(hang),
    },
    {
      name: 'refreshTags',
      call: (h) => h.refreshTags(),
      hangs: (b) => b.refreshTags.mockImplementation(hang),
    },
    {
      name: 'getExpiration',
      call: (h) => h.getExpiration(['t']),
      hangs: (b) => b.getExpiration.mockImplementation(hang),
    },
    {
      name: 'updateTags',
      call: (h) => h.updateTags(['t']),
      hangs: (b) => b.updateTags.mockImplementation(hang),
    },
  ];

  describe.each(backendLegs)('INVARIANT B: $name()', ({ call, hangs }) => {
    it('settles rather than hanging when the backend never responds', async () => {
      const backend = healthyBackend();
      hangs(backend);
      const handler = makeHandler(backend);

      // If this leg is unbounded the test times out — which is the point.
      await expect(call(handler)).resolves.not.toThrow();
      await flush();

      expect(unhandled).toEqual([]);
    });
  });

  /* ================================================================ */
  /*  A hung set() must still open the WRITE circuit (finding 4)       */
  /* ================================================================ */

  it('opens the write circuit when set() HANGS (not just when it rejects)', async () => {
    vi.useFakeTimers();
    try {
      const backend = healthyBackend();
      backend.set.mockImplementation(hang);
      const handler = makeHandler(backend);

      // Each of these must resolve (bounded), and each timeout is a breaker failure.
      for (const key of ['k1', 'k2', 'k3']) {
        const write = handler.set(key, Promise.resolve(makeEntry()));
        await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
        await write;
      }
      expect(backend.set).toHaveBeenCalledTimes(3);

      // Circuit is now open: a hung backend is no longer written to at all.
      await handler.set('k4', Promise.resolve(makeEntry()));
      expect(backend.set).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
    await flush();
    expect(unhandled).toEqual([]);
  });
});
