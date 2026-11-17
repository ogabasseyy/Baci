import type { CategoryCompareHubStatus } from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/resolve-category-compare-hub-status';
import { resolveCategoryCompareHubStatusDirect } from '@/lib/resolve-category-compare-hub-status-direct';
import { SingleFlight } from '@/lib/single-flight';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { storefrontInternalPreflight } from './storefront-internal-preflight';

const DEFAULT_TIMEOUT_MS = 2_500;
const RENDERABLE_CACHE_TTL_MS = 60_000;
const MAX_CACHE_SIZE = 1_000;

export type CompareHubStatusResolver = (input: {
  merchantSlug: string;
  categorySlug: string;
  signal?: AbortSignal;
}) => Promise<CategoryCompareHubStatus>;

interface CompareHubStatusOptions {
  /** Retained for caller compatibility; in-process lookup does not fetch over HTTP. */
  origin?: string;
  /** Storefront slug or custom domain the proxy resolved. */
  identifier: string;
  /** The category slug from the hub path (`/{category}/compare`). */
  categorySlug: string;
  /**
   * `INTERNAL_API_SECRET`; when absent the check fails open. Kept as the
   * operational kill-switch: unsetting the secret disables the preflight
   * without a deploy.
   */
  secret: string | undefined;
  /** Retained for caller compatibility; unused now that lookup is in-process. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  resolverImpl?: CompareHubStatusResolver;
  /** Tight budget — a slow verdict must not delay navigations. */
  timeoutMs?: number;
}

export type StorefrontCompareHubStatusResolution =
  | { kind: 'empty' }
  | { kind: 'renderable-or-unknown' };

interface CacheEntry {
  resolution: StorefrontCompareHubStatusResolution;
  expiresAt: number;
}

const compareHubStatusCache = new Map<string, CacheEntry>();
const compareHubStatusFlights =
  new SingleFlight<StorefrontCompareHubStatusResolution>();

function getCacheKey(identifier: string, categorySlug: string): string {
  return `${identifier.trim().toLowerCase()}:${categorySlug.trim().toLowerCase()}`;
}

function getCachedResolution(
  key: string
): StorefrontCompareHubStatusResolution | null {
  const entry = compareHubStatusCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    compareHubStatusCache.delete(key);
    return null;
  }
  return entry.resolution;
}

function setCachedResolution(
  key: string,
  resolution: StorefrontCompareHubStatusResolution,
  ttlMs: number
): void {
  if (
    !compareHubStatusCache.has(key) &&
    compareHubStatusCache.size >= MAX_CACHE_SIZE
  ) {
    const oldestKey = compareHubStatusCache.keys().next().value;
    if (oldestKey !== undefined) {
      compareHubStatusCache.delete(oldestKey);
    }
  }
  compareHubStatusCache.set(key, {
    resolution,
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearStorefrontCompareHubStatusCache(): void {
  compareHubStatusCache.clear();
}

class CompareHubLookupTimeoutError extends Error {
  constructor() {
    super('Compare hub status lookup timed out');
    this.name = 'CompareHubLookupTimeoutError';
  }
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CompareHubLookupTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Resolves whether a `/{category}/compare` hub is confirmed empty for the
 * proxy's crawl-budget hard-404 (the page-level thin-hub `notFound()` only
 * yields a PPR soft-404 — 200 + noindex shell — so crawlers never see a true
 * status without this preflight).
 *
 * Runs `resolveCategoryCompareHubStatus` in-process with SingleFlight
 * coalescing and a short bounded TTL cache, avoiding a self-HTTP invocation.
 *
 * Fail-open by construction: a missing secret, unsafe category segment,
 * resolver error, timeout, or `unknown` (degraded-resolver) status all return
 * `renderable-or-unknown` (uncached) so the proxy never hard-404s a live hub
 * on stale/unavailable data.
 */
export function resolveStorefrontCompareHubStatus(
  opts: CompareHubStatusOptions
): Promise<StorefrontCompareHubStatusResolution> {
  const failOpenContext = {
    surface: 'compare-hub-status' as const,
    identifier: opts.identifier,
    slug: opts.categorySlug,
  };

  // Unsafe (over-long / repeatedly-encoded) category segments can never match
  // a real category; skip the doomed lookup and let the App Router decide.
  const slugSafety = evaluateStorefrontSlugSafety(opts.categorySlug);
  if (!slugSafety.safe) {
    storefrontInternalPreflight.warnSkip({
      ...failOpenContext,
      reason: slugSafety.reason,
    });
    return Promise.resolve({ kind: 'renderable-or-unknown' });
  }

  if (!opts.secret) {
    storefrontInternalPreflight.warnFailOpen({
      ...failOpenContext,
      reason: 'no-secret',
    });
    return Promise.resolve({ kind: 'renderable-or-unknown' });
  }

  const normalizedIdentifier = opts.identifier.trim().toLowerCase();
  const normalizedCategorySlug = opts.categorySlug.trim().toLowerCase();
  const cacheKey = getCacheKey(normalizedIdentifier, normalizedCategorySlug);
  const cached = getCachedResolution(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  const resolverImpl =
    opts.resolverImpl ?? resolveCategoryCompareHubStatusDirect;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return compareHubStatusFlights.run(cacheKey, async () => {
    const refreshed = getCachedResolution(cacheKey);
    if (refreshed) {
      return refreshed;
    }

    let status: CategoryCompareHubStatus;
    try {
      status = await withTimeout(
        (signal) =>
          resolverImpl({
            merchantSlug: normalizedIdentifier,
            categorySlug: normalizedCategorySlug,
            signal,
          }),
        timeoutMs
      );
    } catch (error) {
      storefrontInternalPreflight.warnFailOpen({
        ...failOpenContext,
        reason:
          error instanceof CompareHubLookupTimeoutError
            ? 'timeout'
            : 'fetch-error',
      });
      return { kind: 'renderable-or-unknown' };
    }

    if (status.kind === 'unknown') {
      storefrontInternalPreflight.warnFailOpen({
        ...failOpenContext,
        reason: 'has-error',
      });
      return { kind: 'renderable-or-unknown' };
    }

    if (status.kind === 'empty') {
      // Do not cache empty verdicts: a category that gains its first eligible
      // product must serve 200 on the very next crawl (matching route no-store).
      return { kind: 'empty' };
    }

    const resolution: StorefrontCompareHubStatusResolution = {
      kind: 'renderable-or-unknown',
    };
    setCachedResolution(cacheKey, resolution, RENDERABLE_CACHE_TTL_MS);
    return resolution;
  });
}
