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
  if (excludeUrls.size === 0) return false;
  const sourcePath =
    entry.source_url != null ? urlPathname(entry.source_url) : null;
  const verifiedPath =
    entry.verified_url != null ? urlPathname(entry.verified_url) : null;
  for (const claim of excludeUrls) {
    if (claim === entry.source_url || claim === entry.verified_url) {
      return true;
    }
    if (
      isRelativeReference(claim) &&
      (claim === sourcePath || claim === verifiedPath)
    ) {
      return true;
    }
  }
  return false;
}
