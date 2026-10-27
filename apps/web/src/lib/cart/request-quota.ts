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
  | 'legacy_bridge'
  | 'session_revoke'
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
  // The budget must stay far above legitimate shared-address traffic
  // (carrier NAT and corporate egress put many shoppers behind one
  // client address); it bounds scripted proof minting, not shoppers.
  bootstrap: { limit: 120, windowMs: 60 * 60 * 1000 },
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
  // MCP legacy-bridge writes are token-authenticated server-to-server
  // calls: budgeted per merchant and legacy token, never by the shared
  // broker egress identity, and fail-closed on quota degradation
  // (see FAIL_CLOSED_OPERATIONS).
  legacy_bridge: { limit: 120, windowMs: 60 * 1000 },
  // Checkout review preparation: per-submit plus refresh retries.
  checkout_prepare: { limit: 60, windowMs: 60 * 1000 },
  // Device revocation is a sign-out action: rare per principal, and
  // credential-bearing (expired proofs verify inside a grace window),
  // so it fails closed on quota degradation like other credential ops.
  session_revoke: { limit: 60, windowMs: 60 * 60 * 1000 },
};

export type WindowCounter = { count: number; resetTime: number };

export const memoryCounters = new Map<string, WindowCounter>();

/**
 * Bootstrap gets its own degraded fallback store: anonymous churn must
 * never consume the capacity authenticated shoppers need to read or
 * update their carts during a quota-store outage.
 */
export const bootstrapMemoryCounters = new Map<string, WindowCounter>();

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
 * Degradation policy, per operation class: unauthenticated operations
 * (FAIL_CLOSED_OPERATIONS) fail closed in production so a Redis outage
 * cannot multiply anonymous creation/enumeration budgets per instance.
 * Authenticated operations (command, checkout_prepare, checkout_refresh)
 * deliberately stay on per-instance memory budgets so a Redis outage
 * does not take checkout down with it; their multiplication is bounded
 * by the per-instance limit and the proxy per-IP rate limit. Either
 * way, degradation must stay operator-visible, so the warning repeats
 * (throttled) for as long as the store is degraded.
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

/**
 * Unauthenticated operations whose budgets bound anonymous creation and
 * enumeration. When the shared quota store is degraded in production
 * these fail closed rather than multiplying limits per instance.
 */
const FAIL_CLOSED_OPERATIONS: ReadonlySet<CartQuotaOperation> = new Set([
  // Bootstrap is deliberately NOT fail-closed: it is a stateless proof
  // mint, and hard-blocking it during a Redis outage blanks every
  // shopper's cart at the first step. It degrades to the per-instance
  // memory budget, still bounded by the proxy per-IP rate limit.
  // Create stays fail-closed because it materializes carts/grants from
  // anonymous capabilities.
  'create',
  'handoff_preview',
  'handoff_redeem',
  // Credential-minting and account-linking operations also fail
  // closed: a degraded per-instance budget would multiply their
  // limits by the instance count exactly while the system is
  // degraded. The token-authenticated legacy bridge fails closed
  // too — it is server-to-server and can retry, unlike shopper
  // traffic. Authenticated cart commands and checkout preparation
  // stay on the degraded memory budget for availability.
  'account_link',
  'handoff_issue',
  'legacy_bridge',
  'session_revoke',
]);

/**
 * Bootstrap's per-instance ceiling while the shared quota store is
 * degraded. A shopper needs roughly one bootstrap; the healthy budget
 * exists to absorb shared-address traffic in a single global counter.
 * Reusing it per instance would multiply the anonymous mint ceiling by
 * the live instance count during exactly the outage when the shared
 * store cannot bound abuse, so degraded instances grant far less.
 */
export const DEGRADED_BOOTSTRAP_LIMIT = 20;

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
  const requiresSharedStore =
    process.env.NODE_ENV === 'production' &&
    FAIL_CLOSED_OPERATIONS.has(input.operation);
  const counter = await incrementWindowCounter(
    quotaKey(input),
    budget.windowMs,
    !requiresSharedStore,
    input.operation === 'bootstrap' ? bootstrapMemoryCounters : memoryCounters
  );
  const failClosed = counter.degraded && requiresSharedStore;
  const limit =
    counter.degraded && input.operation === 'bootstrap'
      ? Math.min(budget.limit, DEGRADED_BOOTSTRAP_LIMIT)
      : budget.limit;
  return {
    allowed: !failClosed && counter.count <= limit,
    limit,
    remaining: failClosed ? 0 : Math.max(0, limit - counter.count),
    resetTime: counter.resetTime,
  };
}

export function __resetCartQuotaStoreForTesting(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__resetCartQuotaStoreForTesting should only run in tests');
  }
  memoryCounters.clear();
  bootstrapMemoryCounters.clear();
  lastQuotaDegradationWarnAt = 0;
}
