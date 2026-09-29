import type { SupabaseClient } from '@supabase/supabase-js';
import { storefrontPreflightRpcMemo } from '@/lib/storefront-preflight-rpc-memo';
import { createPublicClient } from '@/lib/supabase/public';
import { createAbortSignalTimeout } from './abort-signal-timeout';
import type {
  StorefrontInternalPreflightSurface,
  StorefrontPreflightRpcAttempt,
  StorefrontPreflightRpcOutcome,
} from './storefront-internal-preflight';
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

/** Direct-Supabase transport for the proxy middleware's storefront preflights.
 * One anon PostgREST RPC replaces the internal self-fetch. A short verdict memo
 * and a consecutive-failure breaker bound repeat traffic and brownouts.
 *
 * The RPCs are intentionally anon-GRANTed SECURITY DEFINER public verdict
 * reads. They remain directly callable with the public key, so platform anon
 * rate limiting and the DB statement timeout provide the outer safeguards.
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

/**
 * Bounded, secrets-free `code message` diagnostic for a fail-open. PostgREST
 * error messages carry no secrets; bounding keeps a pathological message from
 * bloating the telemetry payload. Empty → undefined so the property is omitted.
 */
function boundedErrorDetail(code: string, message: string): string | undefined {
  return `${code} ${message}`.trim().slice(0, 160) || undefined;
}

/** Same diagnostic for the rare THROWN (not resolved-`{ error }`) rejection. */
function thrownErrorDetail(error: unknown): string | undefined {
  if (error instanceof Error || error instanceof DOMException) {
    return boundedErrorDetail(error.name, error.message);
  }
  return undefined;
}

/**
 * Calls a preflight verdict RPC and returns its single row, or null after
 * logging/capturing the fail-open (callers return their surface's fail-open
 * verdict on null). Never throws.
 */
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

  const attemptId = globalThis.crypto.randomUUID();
  const startedAt = performance.now();
  const elapsedMs = () =>
    Math.max(0, Math.round(performance.now() - startedAt));
  const logAttempt = (
    outcome: StorefrontPreflightRpcOutcome
  ): Omit<StorefrontPreflightRpcAttempt, 'surface'> => {
    const attempt: StorefrontPreflightRpcAttempt = {
      attemptId,
      deadlineMs: timeoutMs,
      elapsedMs: elapsedMs(),
      outcome,
      rpcName: fn,
      surface: failOpenContext.surface,
    };
    storefrontInternalPreflight.logRpcAttempt(attempt);
    return {
      attemptId: attempt.attemptId,
      deadlineMs: attempt.deadlineMs,
      elapsedMs: attempt.elapsedMs,
      outcome: attempt.outcome,
      rpcName: attempt.rpcName,
    };
  };
  const timeout = createAbortSignalTimeout(timeoutMs);

  let result: StorefrontPreflightRpcResult;
  try {
    result = await rpcImpl(fn, args, timeout.signal);
  } catch (error) {
    const reason = isAbortLikeError(error) ? 'timeout' : 'fetch-error';
    const outcome = reason === 'timeout' ? 'client-timeout' : 'fetch-error';
    if (reason === 'timeout') {
      storefrontPreflightRpcMemo.write(key, storefrontPreflightRpcMemo.timeout);
    }
    breaker.recordFailure();
    const attemptContext = logAttempt(outcome);
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      ...attemptContext,
      reason,
      detail: thrownErrorDetail(error),
      outcome,
      rpcName: fn,
    });
    captureBreakerOpenTransition(failOpenContext);
    return null;
  } finally {
    timeout.clear();
  }

  if (result.error) {
    const reason = classifyRpcErrorReason(result.error);
    const outcome =
      result.error.code?.trim() === '57014'
        ? 'database-timeout'
        : reason === 'timeout'
          ? 'client-timeout'
          : reason === 'fetch-error'
            ? 'fetch-error'
            : 'rpc-error';
    if (reason === 'timeout') {
      storefrontPreflightRpcMemo.write(key, storefrontPreflightRpcMemo.timeout);
    }
    breaker.recordFailure();
    const attemptContext = logAttempt(outcome);
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      ...attemptContext,
      reason,
      detail: boundedErrorDetail(
        result.error.code ?? '',
        result.error.message ?? ''
      ),
      outcome,
      rpcName: fn,
    });
    captureBreakerOpenTransition(failOpenContext);
    return null;
  }

  breaker.recordSuccess();

  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (row === null || row === undefined || typeof row !== 'object') {
    if (
      options.emptyResult === 'unknown' &&
      Array.isArray(result.data) &&
      result.data.length === 0
    ) {
      logAttempt('empty-result');
      storefrontPreflightRpcMemo.write(
        key,
        storefrontPreflightRpcMemo.emptyResult
      );
      return null;
    }
    const attemptContext = logAttempt('parse-error');
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      ...attemptContext,
      reason: 'parse',
    });
    return null;
  }

  storefrontPreflightRpcMemo.write(key, row);
  logAttempt('success');
  return row;
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
