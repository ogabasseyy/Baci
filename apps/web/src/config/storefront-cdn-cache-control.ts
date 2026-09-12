// Ops-2 (CWV headroom plan) — layered edge-freshness headers for PUBLIC
// storefront documents (home, PDP, category/listing, blog, static content).
//
// WHY THREE HEADERS: Vercel STRIPS `s-maxage` from `Cache-Control` before
// forwarding downstream, so a single `Cache-Control` cannot give Cloudflare a
// different (longer) TTL than Vercel's own CDN. The split solves this:
//   * `Vercel-CDN-Cache-Control` — consumed by Vercel's CDN, then stripped.
//   * `CDN-Cache-Control`        — forwarded to Cloudflare (and any downstream
//                                  CDN) and honored there.
//   * `Cache-Control`            — the browser-facing directive.
// Precedence at each layer is Vercel-CDN-Cache-Control > CDN-Cache-Control >
// Cache-Control (Vercel) and CDN-Cache-Control > Cache-Control (Cloudflare),
// so each tier reads its own header and the others are inert for it.
//
// CORRECTNESS RULES baked in below:
//   * Browser layer stays conservative: `max-age=0, must-revalidate` means the
//     browser revalidates on every normal navigation (never serves stale HTML
//     without a conditional request). It is intentionally NOT `no-store`, which
//     would disable bfcache — bfcache restores are a first-class CWV win on
//     home <-> PDP loops.
//   * The CDN layers carry the real TTL PLUS `stale-while-revalidate` so the
//     post-expiry refresh is a background revalidate + instant stale serve, not
//     a blocking cold-origin round-trip (the direct contributor to the TTFB
//     tail this batch targets). `stale-if-error` keeps the storefront up if the
//     origin errors during revalidation.
//   * The CDN-visible value must NOT contain `s-maxage` or `must-revalidate` —
//     either one disables `stale-while-revalidate`/`stale-if-error` at the edge.
//   * Vercel's layer keeps a SHORT fresh window (300s) so a mutated/removed
//     product is re-fetched from origin quickly; Cloudflare's longer window
//     (3600s) is bounded by the active purge-on-mutation chain (#2935 / #3003).
//     Do NOT raise these past the window the purge design covers.
//   * Explicitly qualified PDP policies use 1800s downstream freshness rather
//     than the fallback 300s. Exact invalidation followed by the durable broad
//     hostname purge owns all product mutations, including bulk updates.
//
// NON-CACHEABLE documents (query present, auth-session hint, or per-user route
// groups) must additionally have any inherited CDN headers REMOVED, hence the
// `null` sentinels below — the consumer deletes those headers so a shared edge
// can never retain a private/non-canonical response.

const CACHEABLE_BROWSER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const CACHEABLE_VERCEL_CDN_CACHE_CONTROL =
  'max-age=300, stale-while-revalidate=86400';
const CACHEABLE_CDN_CACHE_CONTROL =
  'max-age=3600, stale-while-revalidate=86400, stale-if-error=86400';
const CACHEABLE_SELF_HEALING_CDN_CACHE_CONTROL =
  'max-age=300, stale-while-revalidate=86400, stale-if-error=86400';
const CACHEABLE_PDP_CDN_CACHE_CONTROL =
  'max-age=1800, stale-while-revalidate=86400, stale-if-error=86400';
const NON_CACHEABLE_BROWSER_CACHE_CONTROL =
  'private, no-store, max-age=0, must-revalidate';

export type StorefrontDocumentCacheKind =
  | 'cacheable'
  | 'cacheable-pdp'
  | 'cacheable-self-healing'
  | 'cacheable-vercel-only'
  | 'non-cacheable';

export type StorefrontDocumentCacheHeaders = {
  /** Browser-facing `Cache-Control`. */
  readonly cacheControl: string;
  /** Vercel CDN `Vercel-CDN-Cache-Control`; `null` means the header must be removed. */
  readonly vercelCdnCacheControl: string | null;
  /** Downstream (Cloudflare) `CDN-Cache-Control`; `null` means the header must be removed. */
  readonly cdnCacheControl: string | null;
};

/**
 * Resolve the browser + split-CDN cache headers for a storefront HTML document.
 *
 * The consumer sets `cacheControl` and, for each CDN field, sets the header when
 * the value is a string or DELETES it when `null` (defense-in-depth so a
 * non-cacheable response never leaks a long-lived edge TTL).
 */
export function buildStorefrontDocumentCacheHeaders(
  kind: StorefrontDocumentCacheKind
): StorefrontDocumentCacheHeaders {
  if (kind === 'cacheable-pdp') {
    return {
      cacheControl: CACHEABLE_BROWSER_CACHE_CONTROL,
      vercelCdnCacheControl: CACHEABLE_VERCEL_CDN_CACHE_CONTROL,
      cdnCacheControl: CACHEABLE_PDP_CDN_CACHE_CONTROL,
    };
  }
  if (kind === 'cacheable') {
    return {
      cacheControl: CACHEABLE_BROWSER_CACHE_CONTROL,
      vercelCdnCacheControl: CACHEABLE_VERCEL_CDN_CACHE_CONTROL,
      cdnCacheControl: CACHEABLE_CDN_CACHE_CONTROL,
    };
  }

  if (kind === 'cacheable-self-healing') {
    return {
      cacheControl: CACHEABLE_BROWSER_CACHE_CONTROL,
      vercelCdnCacheControl: CACHEABLE_VERCEL_CDN_CACHE_CONTROL,
      cdnCacheControl: CACHEABLE_SELF_HEALING_CDN_CACHE_CONTROL,
    };
  }

  if (kind === 'cacheable-vercel-only') {
    return {
      cacheControl: CACHEABLE_BROWSER_CACHE_CONTROL,
      vercelCdnCacheControl: CACHEABLE_VERCEL_CDN_CACHE_CONTROL,
      cdnCacheControl: null,
    };
  }

  return {
    cacheControl: NON_CACHEABLE_BROWSER_CACHE_CONTROL,
    vercelCdnCacheControl: null,
    cdnCacheControl: null,
  };
}
