import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';

function urlPathname(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

/** Bare path references carry no scheme or authority to compare exactly. */
function isRelativeReference(value: string): boolean {
  try {
    new URL(value);
    return false;
  } catch {
    return value.length > 0;
  }
}

/**
 * Whether a single URL is claimed by an offer exclusion set: exact match,
 * or a relative offer claim resolving to the same path. Raw product-image
 * fallbacks (which have no manifest entry) must use this so a relative
 * claim still excludes the equivalent absolute product URL.
 */
export function isOfferClaimedUrl(
  url: string | null | undefined,
  excludeUrls: ReadonlySet<string>
): boolean {
  if (url == null || excludeUrls.size === 0) return false;
  const pathname = urlPathname(url);
  for (const claim of excludeUrls) {
    if (claim === url) {
      return true;
    }
    if (isRelativeReference(claim) && claim === pathname) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a manifest entry's URL is claimed by an offer exclusion set.
 * Shared by parent-level and sibling fallbacks so offer-owned imagery is
 * filtered identically everywhere. Besides exact matches, a relative
 * offer claim matches an entry whose absolute URL resolves to the same
 * path: the backfill preserves both raw forms as rows with one shared
 * verified URL, so without this the absolute row would leak offer-owned
 * imagery into the base or a sibling.
 */
export function isOfferClaimedImage(
  entry: FeedImageManifestEntry,
  excludeUrls: ReadonlySet<string>
): boolean {
  return (
    isOfferClaimedUrl(entry.source_url, excludeUrls) ||
    isOfferClaimedUrl(entry.verified_url, excludeUrls)
  );
}
