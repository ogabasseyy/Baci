import type { FeedImageManifestEntry } from '@/lib/gmc-feed-images';
import { isOfferClaimedUrl } from '@/lib/is-offer-claimed-url';

type ClaimableImageRef = Pick<
  FeedImageManifestEntry,
  'source_url' | 'verified_url'
>;

/**
 * Whether a manifest entry's URL is claimed by an offer exclusion set.
 * Shared by parent-level and sibling fallbacks so offer-owned imagery is
 * filtered identically everywhere. Besides exact matches, a relative
 * offer claim matches an entry whose absolute URL resolves to the same
 * path: the backfill preserves both raw forms as rows with one shared
 * verified URL, so without this the absolute row would leak offer-owned
 * imagery into the base or a sibling. When the manifest is provided, an
 * entry is also excluded when it shares its verified URL with a claimed
 * entry: an offer claiming the AVIF source owns the JPG it verifies to,
 * so a sibling row sourced directly from that JPG must not leak back.
 */
export function isOfferClaimedImage(
  entry: ClaimableImageRef,
  excludeUrls: ReadonlySet<string>,
  manifestEntries: readonly FeedImageManifestEntry[] = []
): boolean {
  if (
    isOfferClaimedUrl(entry.source_url, excludeUrls) ||
    isOfferClaimedUrl(entry.verified_url, excludeUrls)
  ) {
    return true;
  }
  if (entry.verified_url == null) {
    return false;
  }
  return manifestEntries.some(
    (other) =>
      other.verified_url === entry.verified_url &&
      (isOfferClaimedUrl(other.source_url, excludeUrls) ||
        isOfferClaimedUrl(other.verified_url, excludeUrls))
  );
}
