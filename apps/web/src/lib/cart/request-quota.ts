import { createHash } from 'node:crypto';

import { getRedis } from '@/lib/redis';

export type CartQuotaOperation =
  | 'account_link'
  | 'bootstrap'
  | 'create'
  | 'commands'
  | 'snapshot'
  | 'handoff_issue'
  | 'handoff_redeem'
  | 'handoff_preview'
  | 'checkout_prepare';

export interface CartQuotaInput {
  operation: CartQuotaOperation;
  merchantId: string;
  /** Principal id once known, otherwise the client identifier. */
  subject: string;
}

export interface CartQuotaResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

export const CART_QUOTA_BUDGETS: Record<
  CartQuotaOperation,
  { limit: number; windowMs: number }
> = {
  account_link: { limit: 60, windowMs: 60 * 60 * 1000 },
  // Anonymous bootstrap is the unauthenticated creation vector: bounded
  // per merchant and client, on top of the proxy per-IP rate limit.
  bootstrap: { limit: 30, windowMs: 60 * 60 * 1000 },
  // A bootstrap proof should create about once; retries need headroom.
  create: { limit: 10, windowMs: 60 * 60 * 1000 },
  // Burst-friendly for quantity taps, bounded per principal.
  commands: { limit: 240, windowMs: 60 * 1000 },
  snapshot: { limit: 240, windowMs: 60 * 1000 },
  // Handoff links are short-lived capabilities: generous enough for
  // conflict retries, bounded per merchant and principal (or client).
  handoff_issue: { limit: 60, windowMs: 60 * 60 * 1000 },
  handoff_redeem: { limit: 120, windowMs: 60 * 60 * 1000 },
  handoff_preview: { limit: 120, windowMs: 60 * 1000 },
  // Checkout review preparation: per-submit plus refresh retries.
  checkout_prepare: { limit: 60, windowMs: 60 * 1000 },
};

export type WindowCounter = { count: number; resetTime: number };

export const memoryCounters = new Map<string, WindowCounter>();

export function hashSubject(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function quotaKey(input: CartQuotaInput): string {
  return `baci:cart-quota:${input.operation}:${input.merchantId}:${hashSubject(input.subject)}`;
}

export function parseCounter(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

/**
 * Hard bound for the degraded in-memory store. Quota subjects include
 * per-principal ids (each anonymous bootstrap mints a fresh one), so
 * without eviction the map grows for the life of the process.
 */
export const MEMORY_COUNTER_MAX_ENTRIES = 4096;

function pruneMemoryCounters(now: number): void {
  for (const [key, counter] of memoryCounters) {
    if (now > counter.resetTime) memoryCounters.delete(key);
  }
  // Still oversized after expiry pruning: evict the soonest-expiring
  // entries so live windows are the last to go.
  if (memoryCounters.size > MEMORY_COUNTER_MAX_ENTRIES) {
    const byExpiry = [...memoryCounters.entries()].sort(
      (left, right) => left[1].resetTime - right[1].resetTime
    );
    for (const [key] of byExpiry) {
      if (memoryCounters.size <= MEMORY_COUNTER_MAX_ENTRIES) break;
      memoryCounters.delete(key);
    }
  }
}

export function incrementMemoryCounter(
  key: string,
  windowMs: number
): WindowCounter {
  const now = Date.now();
  if (memoryCounters.size > MEMORY_COUNTER_MAX_ENTRIES) {
    pruneMemoryCounters(now);
  }
  const existing = memoryCounters.get(key);
  const next =
    existing && now <= existing.resetTime
      ? { count: existing.count + 1, resetTime: existing.resetTime }
      : { count: 1, resetTime: now + windowMs };
  memoryCounters.set(key, next);
  return next;
}

export interface WindowCounterResult extends WindowCounter {
  /** True when the count came from per-instance memory, not shared Redis. */
  degraded: boolean;
}

let quotaDegradationLogged = false;

export async function incrementWindowCounter(
  key: string,
  windowMs: number
): Promise<WindowCounterResult> {
  const redis = getRedis();
  if (redis) {
    try {
      const script = redis.createScript<number | string>(`
        local count = redis.call("INCR", KEYS[1])
        if count == 1 then
          redis.call("PEXPIRE", KEYS[1], ARGV[1])
        end
        return count
      `);
      const count = parseCounter(
        await script.eval([key], [String(Math.max(1, windowMs))])
      );
      return { count, degraded: false, resetTime: Date.now() + windowMs };
    } catch {
      // Fall through to per-instance memory: callers governing
      // unauthenticated operations fail closed on the degraded signal
      // in production instead of silently multiplying their budgets.
      if (!quotaDegradationLogged) {
        quotaDegradationLogged = true;
        console.warn(
          'Cart quota store degraded: Redis unavailable, using per-instance memory counters'
        );
      }
    }
  }
  return { ...incrementMemoryCounter(key, windowMs), degraded: true };
}

/**
 * Unauthenticated operations whose budgets bound anonymous creation and
 * enumeration. When the shared quota store is degraded in production
 * these fail closed rather than multiplying limits per instance.
 */
const FAIL_CLOSED_OPERATIONS: ReadonlySet<CartQuotaOperation> = new Set([
  'bootstrap',
  'handoff_preview',
]);

/**
 * Tenant/principal-scoped cart quotas reusing the Redis window-counter
 * primitive. Complements the proxy per-IP rate limit with budgets that
 * survive carrier-NAT sharing and bind anonymous creation to one
 * merchant and client.
 */
export async function checkCartQuota(
  input: CartQuotaInput
): Promise<CartQuotaResult> {
  const budget = CART_QUOTA_BUDGETS[input.operation];
  const counter = await incrementWindowCounter(
    quotaKey(input),
    budget.windowMs
  );
  const failClosed =
    counter.degraded &&
    process.env.NODE_ENV === 'production' &&
    FAIL_CLOSED_OPERATIONS.has(input.operation);
  return {
    allowed: !failClosed && counter.count <= budget.limit,
    limit: budget.limit,
    remaining: failClosed ? 0 : Math.max(0, budget.limit - counter.count),
    resetTime: counter.resetTime,
  };
}

export function __resetCartQuotaStoreForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCartQuotaStoreForTesting should only run in tests');
  }
  memoryCounters.clear();
}
