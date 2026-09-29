import type { SupabaseClient } from '@supabase/supabase-js';
import { storefrontPreflightRpcMemo } from '@/lib/storefront-preflight-rpc-memo';
import { createPublicClient } from '@/lib/supabase/public';
import { createAbortSignalTimeout } from './abort-signal-timeout';
import type { StorefrontInternalPreflightSurface } from './storefront-internal-preflight';
import {
  storefrontInternalPreflight,
  UNKNOWN_STOREFRONT_FAIL_OPEN_REASON,
} from './storefront-internal-preflight';
import { createStorefrontPreflightCircuitBreaker } from './storefront-preflight-circuit-breaker';
import { classifyRpcErrorReason } from './storefront-preflight-rpc-error';
import {
  snapshotStorefrontPreflightRpcArgs,
  storefrontPreflightRpcFlightKey,
  storefrontPreflightRpcFlights,
} from './storefront-preflight-rpc-flight';
import {
  boundedStorefrontPreflightRpcErrorDetail,
  classifyStorefrontPreflightRpcOutcome,
  createStorefrontPreflightRpcAttemptRecorder,
  getStorefrontPreflightRpcThrownErrorDetail,
} from './storefront-preflight-rpc-telemetry';

/** Direct anon PostgREST transport for middleware storefront preflights.
 * A short verdict memo and consecutive-failure breaker bound repeat traffic.
 * SECURITY DEFINER public verdict RPCs remain anon-callable; platform rate
 * limiting and DB statement timeout provide outer safeguards.
 */

export interface StorefrontPreflightRpcContext {
  surface: StorefrontInternalPreflightSurface;
  identifier: string;
  slug: string;
}

export type StorefrontPreflightRpcResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

export type StorefrontPreflightRpcImpl = (
  fn: string,
  args: Record<string, string>,
  signal: AbortSignal
) => PromiseLike<StorefrontPreflightRpcResult>;

interface CallStorefrontPreflightRpcOptions {
  failOpenContext: StorefrontPreflightRpcContext;
  /** Tight budget — a slow verdict must not delay navigations. */
  timeoutMs?: number;
  /** Injectable for tests. */
  rpcImpl?: StorefrontPreflightRpcImpl;
  /**
   * Some established identity RPCs legitimately return no row for unknown
   * public identifiers. Treat that result as a designed fail-open instead of
   * reporting a parse incident.
   */
  emptyResult?: 'unknown';
}

// A 2s budget recovers transport-tail events; memo and breaker bound its cost.
const DEFAULT_TIMEOUT_MS = 2_000;
// One navigation's helpers call within ~100ms; this short memo absorbs repeats.
const breaker = createStorefrontPreflightCircuitBreaker();

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  client ??= createPublicClient({
    clientInfo: 'storefront-preflight',
    // Outer safety net only; the per-call abort signal below governs.
    timeoutMs: 10_000,
  });
  return client;
}

const defaultRpcImpl: StorefrontPreflightRpcImpl = (fn, args, signal) =>
  getClient().rpc(fn, args).abortSignal(signal);

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

/** Returns one verdict row, or null after logging a fail-open; never throws. */
export async function callStorefrontPreflightRpc(
  fn: string,
  args: Record<string, string>,
  options: CallStorefrontPreflightRpcOptions
): Promise<unknown | null> {
  const failOpenContext = { ...options.failOpenContext };
  const emptyResult = options.emptyResult;
  const attemptOptions = { emptyResult, failOpenContext };
  const argsSnapshot = snapshotStorefrontPreflightRpcArgs(args);

  // Preview deployments must not borrow a production memo or hit its data.
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv && vercelEnv !== 'production') {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-base-url',
    });
    return null;
  }

  const key = storefrontPreflightRpcMemo.key(fn, argsSnapshot, emptyResult);
  const memoized = storefrontPreflightRpcMemo.read(key);
  if (
    storefrontPreflightRpcMemo.isTimeout(memoized) ||
    storefrontPreflightRpcMemo.isEmptyResult(memoized)
  ) {
    return null;
  }
  if (memoized !== undefined) {
    return memoized;
  }

  const rpcImpl = options.rpcImpl ?? defaultRpcImpl;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const flightKey = storefrontPreflightRpcFlightKey(
    key,
    timeoutMs,
    vercelEnv,
    rpcImpl
  );

  return await storefrontPreflightRpcFlights.run(flightKey, () =>
    runStorefrontPreflightRpcAttempt(
      fn,
      argsSnapshot,
      key,
      attemptOptions,
      rpcImpl,
      timeoutMs
    )
  );
}

async function runStorefrontPreflightRpcAttempt(
  fn: string,
  args: Record<string, string>,
  key: string,
  options: CallStorefrontPreflightRpcOptions,
  rpcImpl: StorefrontPreflightRpcImpl,
  timeoutMs: number
): Promise<unknown | null> {
  const { failOpenContext } = options;
  if (breaker.isOpen()) {
    // Console-only: the transition itself was captured once below.
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: 'circuit-open',
    });
    return null;
  }

  const recordAttempt = createStorefrontPreflightRpcAttemptRecorder({
    deadlineMs: timeoutMs,
    rpcName: fn,
    surface: failOpenContext.surface,
  });
  const timeout = createAbortSignalTimeout(timeoutMs);

  let result: StorefrontPreflightRpcResult;
  try {
    result = await rpcImpl(fn, args, timeout.signal);
  } catch (error) {
    const reason = isAbortLikeError(error) ? 'timeout' : 'fetch-error';
    return handleRpcFailure(
      key,
      failOpenContext,
      recordAttempt,
      reason,
      getStorefrontPreflightRpcThrownErrorDetail(error)
    );
  } finally {
    timeout.clear();
  }

  if (result.error) {
    const reason = classifyRpcErrorReason(result.error);
    return handleRpcFailure(
      key,
      failOpenContext,
      recordAttempt,
      reason,
      boundedStorefrontPreflightRpcErrorDetail(
        result.error.code ?? '',
        result.error.message ?? ''
      ),
      result.error.code
    );
  }

  breaker.recordSuccess();

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (row === null || row === undefined || typeof row !== 'object') {
    if (
      options.emptyResult === 'unknown' &&
      Array.isArray(result.data) &&
      result.data.length === 0
    ) {
      recordAttempt('empty-result');
      storefrontPreflightRpcMemo.write(
        key,
        storefrontPreflightRpcMemo.emptyResult
      );
      return null;
    }
    const attemptContext = recordAttempt('parse-error');
    storefrontInternalPreflight.warnRpcFailOpen(
      failOpenContext,
      attemptContext,
      'parse'
    );
    return null;
  }

  storefrontPreflightRpcMemo.write(key, row);
  recordAttempt('success');
  return row;
}

function handleRpcFailure(
  key: string,
  failOpenContext: StorefrontPreflightRpcContext,
  recordAttempt: ReturnType<typeof createStorefrontPreflightRpcAttemptRecorder>,
  reason: 'timeout' | 'fetch-error' | 'has-error',
  detail?: string,
  databaseErrorCode?: string
): null {
  const attemptContext = recordAttempt(
    classifyStorefrontPreflightRpcOutcome(reason, databaseErrorCode)
  );
  if (reason === 'timeout') {
    storefrontPreflightRpcMemo.write(key, storefrontPreflightRpcMemo.timeout);
  }
  breaker.recordFailure();
  storefrontInternalPreflight.warnRpcFailOpen(
    failOpenContext,
    attemptContext,
    reason,
    detail
  );
  captureBreakerOpenTransition(failOpenContext);
  return null;
}

function captureBreakerOpenTransition(
  failOpenContext: StorefrontPreflightRpcContext
): void {
  if (breaker.consumeOpenTransition()) {
    // Exactly one capture per open transition — its own fingerprint makes a
    // brownout alertable without a capture per suppressed navigation.
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'circuit-open',
    });
  }
}

/**
 * Shared storefront-status gate for RPC verdict rows: true only for a
 * published storefront. Unknown/unpublished is the DESIGNED junk-traffic
 * fail-open (skip-logged, no capture — parity with the routes'
 * `failOpenReason: 'unknown-storefront'`); any future status value fails open
 * as a captured has-error.
 */
export function gateStorefrontPreflightStatus(
  status: string,
  failOpenContext: StorefrontPreflightRpcContext
): boolean {
  if (status === 'published') {
    return true;
  }

  if (status === 'unknown' || status === 'unpublished') {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: UNKNOWN_STOREFRONT_FAIL_OPEN_REASON,
    });
  } else {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'has-error',
    });
  }
  return false;
}

/** Test hook: clears the verdict memo, breaker state, and client singleton. */
export function resetStorefrontPreflightRpcForTests(): void {
  storefrontPreflightRpcMemo.clear();
  storefrontPreflightRpcFlights.reset();
  breaker.reset();
  client = null;
}
