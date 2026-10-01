import { INTERNAL_AUTH_HEADER } from '@/lib/internal-auth-header';
import { parseCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import { storefrontComparePageStatusFastPath } from '@/lib/storefront-compare-page-status-fast-path';
import {
  isLoopbackOrigin,
  storefrontInternalPreflight,
} from '@/lib/storefront-internal-preflight';
import { createStorefrontPreflightCircuitBreaker } from '@/lib/storefront-preflight-circuit-breaker';
import type { StorefrontPreflightRpcImpl } from '@/lib/storefront-preflight-rpc';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { internalComparePageStatusBodySchema } from '@/schemas/internal-slug-set-route';

const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_COMPARE_STATUS_COMPOSITE_LENGTH = 1_024;
// Bound optional hard-status self-fetches; admitted callers retain fail-open
// timeout and circuit-breaker semantics.
const MAX_COMPARE_PAGE_STATUS_IN_FLIGHT = 8;
const comparePageStatusBreaker = createStorefrontPreflightCircuitBreaker();
const comparePageStatusInFlight = new Map<
  string,
  Promise<StorefrontComparePageStatusResolution>
>();

interface ComparePageStatusOptions {
  origin: string;
  identifier: string;
  categorySlug: string;
  comparisonSlug: string;
  secret: string | undefined;
  fetchImpl?: typeof fetch;
  /** Injectable direct RPC transport. */
  rpcImpl?: StorefrontPreflightRpcImpl;
  timeoutMs?: number;
}

type StorefrontComparePageStatusResolution =
  | { kind: 'missing' }
  | { kind: 'renderable-or-unknown' };

type ComparePageStatusFailOpenContext = {
  surface: 'compare-page-status';
  identifier: string;
  slug: string;
};

function comparePageStatusRequestKey(url: string, secret: string): string {
  // Keep rotated credentials from sharing a pending response; never log this key.
  return `${url}\u0000${secret}`;
}

function captureBreakerOpenTransition(
  failOpenContext: ComparePageStatusFailOpenContext
): void {
  if (comparePageStatusBreaker.consumeOpenTransition()) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'circuit-open',
    });
  }
}

function recordComparePageStatusFailure(
  failOpenContext: ComparePageStatusFailOpenContext
): void {
  comparePageStatusBreaker.recordFailure();
  captureBreakerOpenTransition(failOpenContext);
}

function skipForComparePageStatusCircuit(
  failOpenContext: ComparePageStatusFailOpenContext
): StorefrontComparePageStatusResolution {
  storefrontInternalPreflight.warnSkip({
    ...failOpenContext,
    reason: 'circuit-open',
  });
  return { kind: 'renderable-or-unknown' };
}

function isRequestValidationError(response: Response): boolean {
  return response.status === 400;
}

async function resolveStorefrontComparePageStatusUncached(
  opts: ComparePageStatusOptions,
  secret: string,
  url: string,
  fetchImpl: typeof fetch,
  failOpenContext: ComparePageStatusFailOpenContext
): Promise<StorefrontComparePageStatusResolution> {
  if (comparePageStatusBreaker.isOpen()) {
    return skipForComparePageStatusCircuit(failOpenContext);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { [INTERNAL_AUTH_HEADER]: secret },
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: storefrontInternalPreflight.getFetchErrorReason(error),
    });
    recordComparePageStatusFailure(failOpenContext);
    return { kind: 'renderable-or-unknown' };
  }

  const body = await storefrontInternalPreflight.readJsonResponse(
    response,
    failOpenContext
  );
  if (body === null) {
    // The internal route uses 400 for request validation (for example, a
    // trimmed-empty query). It is not evidence that this instance's transport
    // is unhealthy, so reset the streak without poisoning the shared breaker.
    // Other 4xx responses, especially 401 auth failures, are infrastructure
    // signals and remain breaker failures.
    if (isRequestValidationError(response)) {
      comparePageStatusBreaker.recordSuccess();
    } else {
      recordComparePageStatusFailure(failOpenContext);
    }
    return { kind: 'renderable-or-unknown' };
  }

  const parsedBody = internalComparePageStatusBodySchema.safeParse(body);
  if (!parsedBody.success) {
    recordComparePageStatusFailure(failOpenContext);
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'parse',
    });
    return { kind: 'renderable-or-unknown' };
  }

  if (parsedBody.data.hasError) {
    // The route deliberately encodes resolver unknowns and caught data/cache
    // failures as a valid fail-open body. The HTTP round trip succeeded, so it
    // must clear any prior transport-failure streak.
    comparePageStatusBreaker.recordSuccess();
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'has-error',
    });
    return { kind: 'renderable-or-unknown' };
  }

  if (parsedBody.data.present) {
    comparePageStatusBreaker.recordSuccess();
    return { kind: 'renderable-or-unknown' };
  }

  comparePageStatusBreaker.recordSuccess();
  return { kind: 'missing' };
}

function skipForComparePageStatusConcurrency(
  failOpenContext: ComparePageStatusFailOpenContext
): StorefrontComparePageStatusResolution {
  storefrontInternalPreflight.warnSkip({
    ...failOpenContext,
    reason: 'concurrency-limit',
  });
  return { kind: 'renderable-or-unknown' };
}

/** Resolve a compare hard status; every uncertain or degraded result fails open. */
async function resolveStorefrontComparePageStatus(
  opts: ComparePageStatusOptions
): Promise<StorefrontComparePageStatusResolution> {
  const failOpenContext = {
    surface: 'compare-page-status' as const,
    identifier: opts.identifier,
    slug: opts.comparisonSlug,
  };

  const categorySafety = evaluateStorefrontSlugSafety(opts.categorySlug);
  if (!categorySafety.safe) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      slug: opts.categorySlug,
      reason: categorySafety.reason,
    });
    return { kind: 'renderable-or-unknown' };
  }

  // Validate decoded halves while preserving long-key compare routes.
  if (opts.comparisonSlug.length > MAX_COMPARE_STATUS_COMPOSITE_LENGTH) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: 'too-long',
    });
    return { kind: 'renderable-or-unknown' };
  }
  const parsed = parseCompareSlug(opts.comparisonSlug);
  if (parsed) {
    const leftSafety = evaluateStorefrontSlugSafety(parsed.leftKey);
    if (!leftSafety.safe) {
      storefrontInternalPreflight.warnSkip({
        ...failOpenContext,
        reason: leftSafety.reason,
      });
      return { kind: 'renderable-or-unknown' };
    }
    const rightSafety = evaluateStorefrontSlugSafety(parsed.rightKey);
    if (!rightSafety.safe) {
      storefrontInternalPreflight.warnSkip({
        ...failOpenContext,
        reason: rightSafety.reason,
      });
      return { kind: 'renderable-or-unknown' };
    }
  }

  if (!opts.secret) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-secret',
    });
    return { kind: 'renderable-or-unknown' };
  }

  // Proxy is not a safe place for the resolver's slow inventory fetch. Keep
  // deterministic hard-404s via bounded publication probes on public origins.
  if (!isLoopbackOrigin(opts.origin)) {
    const fastPathResolution =
      await storefrontComparePageStatusFastPath.resolve({
        origin: opts.origin,
        identifier: opts.identifier,
        categorySlug: opts.categorySlug,
        comparisonIsValid: parsed !== null,
        rpcImpl: opts.rpcImpl,
        timeoutMs: opts.timeoutMs,
      });
    if (fastPathResolution) {
      return fastPathResolution;
    }
  }

  const baseUrl = storefrontInternalPreflight.resolveBaseUrl(opts.origin);
  if (!baseUrl) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-base-url',
    });
    return { kind: 'renderable-or-unknown' };
  }

  const url = `${baseUrl}/api/internal/compare-page-status/${encodeURIComponent(
    opts.identifier
  )}?category=${encodeURIComponent(opts.categorySlug)}&comparison=${encodeURIComponent(
    opts.comparisonSlug
  )}`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  // Do not join a hanging probe after the breaker opens.
  if (comparePageStatusBreaker.isOpen()) {
    return skipForComparePageStatusCircuit(failOpenContext);
  }

  const requestKey = comparePageStatusRequestKey(url, opts.secret);
  const pending = comparePageStatusInFlight.get(requestKey);
  if (pending) {
    return await pending;
  }
  if (comparePageStatusInFlight.size >= MAX_COMPARE_PAGE_STATUS_IN_FLIGHT) {
    return skipForComparePageStatusConcurrency(failOpenContext);
  }

  const next = resolveStorefrontComparePageStatusUncached(
    opts,
    opts.secret,
    url,
    fetchImpl,
    failOpenContext
  );
  comparePageStatusInFlight.set(requestKey, next);
  try {
    return await next;
  } finally {
    if (comparePageStatusInFlight.get(requestKey) === next) {
      comparePageStatusInFlight.delete(requestKey);
    }
  }
}

/** Test hook: clears the per-instance storm guards between isolated cases. */
function resetStorefrontComparePageStatusForTests(): void {
  comparePageStatusInFlight.clear();
  comparePageStatusBreaker.reset();
  storefrontComparePageStatusFastPath.resetForTests();
}

export const storefrontComparePageStatus = {
  resolve: resolveStorefrontComparePageStatus,
  resetForTests: resetStorefrontComparePageStatusForTests,
};
