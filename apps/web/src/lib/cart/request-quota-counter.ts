import { getRedis } from '@/lib/redis';

// Window-counter machinery for cart quotas: the shared Redis counter
// plus the bounded per-instance memory fallback used when the shared
// store is degraded. Policy (budgets, fail-closed operations) lives
// in request-quota.ts.

export type WindowCounter = { count: number; resetTime: number };

export const memoryCounters = new Map<string, WindowCounter>();

/**
 * Bootstrap gets its own degraded fallback store: anonymous churn must
 * never consume the capacity authenticated shoppers need to read or
 * update their carts during a quota-store outage.
 */
export const bootstrapMemoryCounters = new Map<string, WindowCounter>();

export function parseCounter(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

/** Strict Redis reply parsing: null means the reply shape is malformed. */
function parseCounterStrict(value: unknown, min: number): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= min)
    return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed >= min ? parsed : null;
  }
  return null;
}

/**
 * Hard bound for the degraded in-memory store. Quota subjects include
 * per-principal ids (each anonymous bootstrap mints a fresh one), so
 * without a capacity limit the map grows for the life of the process.
 * Live windows are retained; new subjects fail closed when capacity is full.
 */
export const MEMORY_COUNTER_MAX_ENTRIES = 4096;

function pruneMemoryCounters(
  store: Map<string, WindowCounter>,
  now: number
): void {
  for (const [key, counter] of store) {
    if (now > counter.resetTime) store.delete(key);
  }
}

export function incrementMemoryCounter(
  key: string,
  windowMs: number,
  store: Map<string, WindowCounter> = memoryCounters
): WindowCounter {
  const now = Date.now();
  if (store.size >= MEMORY_COUNTER_MAX_ENTRIES) {
    pruneMemoryCounters(store, now);
  }
  const existing = store.get(key);
  if (!existing && store.size >= MEMORY_COUNTER_MAX_ENTRIES) {
    // Never discard a live budget to admit a new subject: subject churn
    // must not reset exhausted authenticated quotas during an outage.
    let resetTime = now + windowMs;
    for (const counter of store.values()) {
      resetTime = Math.min(resetTime, counter.resetTime);
    }
    return { count: Number.POSITIVE_INFINITY, resetTime };
  }
  const next =
    existing && now <= existing.resetTime
      ? { count: existing.count + 1, resetTime: existing.resetTime }
      : { count: 1, resetTime: now + windowMs };
  store.set(key, next);
  return next;
}

export interface WindowCounterResult extends WindowCounter {
  /** True when the count came from per-instance memory, not shared Redis. */
  degraded: boolean;
}

/**
 * Degradation must stay operator-visible for as long as the store is
 * degraded, so the warning repeats on a throttle instead of firing
 * once. Policy for what degradation means per operation lives in
 * request-quota.ts (FAIL_CLOSED_OPERATIONS).
 */
const QUOTA_DEGRADATION_WARN_INTERVAL_MS = 60_000;
let lastQuotaDegradationWarnAt = 0;

function warnQuotaDegraded(): void {
  const now = Date.now();
  if (now - lastQuotaDegradationWarnAt < QUOTA_DEGRADATION_WARN_INTERVAL_MS) {
    return;
  }
  lastQuotaDegradationWarnAt = now;
  console.warn(
    'Cart quota store degraded: Redis unavailable, using per-instance memory counters'
  );
}

export async function incrementWindowCounter(
  key: string,
  windowMs: number,
  allowMemoryFallback = true,
  counterStore: Map<string, WindowCounter> = memoryCounters
): Promise<WindowCounterResult> {
  const redis = getRedis();
  if (redis) {
    try {
      // Return count and remaining TTL from the same script so the
      // expiry is exact and a metadata failure cannot discard an
      // authoritative count into the per-instance memory budget.
      const script = redis.createScript<
        [number | string, number | string] | number | string
      >(`
        local count = redis.call("INCR", KEYS[1])
        if count == 1 then
          redis.call("PEXPIRE", KEYS[1], ARGV[1])
        end
        return {count, redis.call("PTTL", KEYS[1])}
      `);
      const reply = await script.eval([key], [String(Math.max(1, windowMs))]);
      // The Lua script always returns a [count, pttl] pair and INCR
      // yields at least 1: a scalar reply or a zero count is malformed.
      if (!Array.isArray(reply) || reply.length < 2)
        throw new Error('Malformed cart quota reply');
      const [rawCount, rawPttl] = reply;
      const count = parseCounterStrict(rawCount, 1);
      const pttl = parseCounterStrict(rawPttl, -2);
      // A malformed-but-non-throwing reply must not read as count 0
      // with a healthy store: degrade so fail-closed operations fail
      // closed instead of silently losing their anonymous budget.
      if (count === null || pttl === null)
        throw new Error('Malformed cart quota reply');
      const msRemaining = pttl > 0 ? pttl : windowMs;
      return {
        count,
        degraded: false,
        resetTime: Date.now() + msRemaining,
      };
    } catch {
      warnQuotaDegraded();
    }
  } else {
    warnQuotaDegraded();
  }
  if (!allowMemoryFallback) {
    // Requests already denied by degradation policy must not consume
    // fallback capacity needed by authenticated shopper operations.
    return {
      count: Number.POSITIVE_INFINITY,
      resetTime: Date.now() + windowMs,
      degraded: true,
    };
  }
  return {
    ...incrementMemoryCounter(key, windowMs, counterStore),
    degraded: true,
  };
}

export function __resetQuotaCountersForTesting(): void {
  memoryCounters.clear();
  bootstrapMemoryCounters.clear();
  lastQuotaDegradationWarnAt = 0;
}
