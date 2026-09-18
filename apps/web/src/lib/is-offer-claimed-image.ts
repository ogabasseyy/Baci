import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';

/**
 * Whether a manifest entry's URL is claimed by an offer exclusion set.
 * Shared by parent-level and sibling fallbacks so offer-owned imagery is
 * filtered identically everywhere.
 */
export function isOfferClaimedImage(
  entry: FeedImageManifestEntry,
  excludeUrls: ReadonlySet<string>
): boolean {
  if (excludeUrls.size === 0) return false;
  return (
    (!!entry.source_url && excludeUrls.has(entry.source_url)) ||
    (!!entry.verified_url && excludeUrls.has(entry.verified_url))
  );
}
