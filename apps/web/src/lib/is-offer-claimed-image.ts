import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { isOfferClaimedUrl } from '@/lib/is-offer-claimed-url';

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
