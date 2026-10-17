import {
  getCurrentSlugForAlias,
  getCurrentSlugForAliasStrict,
} from '@/lib/slug-alias-cache';

/**
 * Alias-aware wrapper for a merchant lookup keyed on a REQUEST-BODY slug.
 *
 * The proxy rewrites stale slugs in the URL query and the merchant header on a
 * just-renamed store, but it cannot safely rewrite a (possibly streamed/multipart)
 * request BODY. So a stale client still on `old.usebaci.com` that POSTs
 * `{ merchantSlug: "old" }` right after a rename would 404 with "Merchant not
 * found" — the exact breakage this rename flow exists to prevent.
 *
 * This runs the caller's OWN typed lookup with the submitted slug first (a LIVE
 * merchant always wins, and the collision trigger stops a new store from ever
 * claiming a retired alias), and only on a not-found miss resolves the retired
 * slug to the current one via `merchant_slug_aliases` and retries once. The exact
 * PostgREST response type (and its `data` typing) is preserved for the caller.
 *
 * IMPORTANT: the `lookup` must use `.maybeSingle()` (not `.single()`), so a
 * zero-row result surfaces as `data: null` rather than an error — otherwise the
 * alias fallback is skipped.
 */
export async function withMerchantSlugAliasFallback<
  R extends { data: unknown; error: unknown },
>(
  slug: string,
  lookup: (resolvedSlug: string) => PromiseLike<R>,
  opts?: { strict?: boolean }
): Promise<R> {
  const first = await lookup(slug);
  if (first.error || first.data) {
    return first;
  }

  // Strict mode throws on alias-DB failure (callers map it to a
  // retryable 5xx) instead of collapsing into a 404 the caller — or
  // its polling clients — would treat as permanent.
  const currentSlug = opts?.strict
    ? await getCurrentSlugForAliasStrict(slug)
    : await getCurrentSlugForAlias(slug);
  if (currentSlug && currentSlug !== slug) {
    return lookup(currentSlug);
  }

  return first;
}
