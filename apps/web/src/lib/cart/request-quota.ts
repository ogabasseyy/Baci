import { createHash } from 'node:crypto';

import {
  __resetQuotaCountersForTesting,
  bootstrapMemoryCounters,
  incrementWindowCounter,
  memoryCounters,
} from './request-quota-counter';

export type {
  WindowCounter,
  WindowCounterResult,
} from './request-quota-counter';
// Counter machinery lives in request-quota-counter.ts; re-exported so
// existing importers (routes, tests, request-context) keep one surface.
export {
  bootstrapMemoryCounters,
  incrementMemoryCounter,
  incrementWindowCounter,
  MEMORY_COUNTER_MAX_ENTRIES,
  memoryCounters,
  parseCounter,
} from './request-quota-counter';

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

export function hashSubject(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function quotaKey(input: CartQuotaInput): string {
  return `baci:cart-quota:${input.operation}:${input.merchantId}:${hashSubject(input.subject)}`;
}

/**
 * Unauthenticated operations whose budgets bound anonymous creation and
 * enumeration. When the shared quota store is degraded in production
 * these fail closed rather than multiplying limits per instance.
 * Authenticated operations deliberately stay on per-instance memory
 * budgets so a Redis outage does not take checkout down with it.
 */
const FAIL_CLOSED_OPERATIONS: ReadonlySet<CartQuotaOperation> = new Set([
  // Bootstrap is deliberately NOT fail-closed: it is a stateless proof
  // mint, and hard-blocking it during a Redis outage blanks every
  // shopper's cart at the first step. It degrades to a reduced
  // per-instance memory budget (DEGRADED_BOOTSTRAP_LIMIT), still
  // bounded by the proxy per-IP rate limit. Create stays fail-closed
  // because it materializes carts/grants from anonymous capabilities.
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
  __resetQuotaCountersForTesting();
}
