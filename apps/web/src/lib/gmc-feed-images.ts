/**
 * Google Merchant Center feed image resolution from a prevalidated manifest.
 *
 * The feed route performs ZERO live network validation.
 * All image URLs are resolved from `product_feed_images` rows
 * that were prevalidated by an offline backfill/audit job.
 */

const GMC_ADDITIONAL_IMAGES_MAX = 10;

/**
 * Manifest entry as returned by the feed route query (status = 'verified' filter).
 * The full DB enum includes 'pending_derivative' and 'pending_verification',
 * but those are only used by the offline backfill job and never reach this type.
 */
export interface FeedImageManifestEntry {
  source_url?: string | null;
  variant_id?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: 'verified' | 'missing' | 'invalid' | 'stale';
  is_primary: boolean;
  position: number;
}

type VerifiedEntry = FeedImageManifestEntry & { verified_url: string };

function isVerifiedWithUrl(e: FeedImageManifestEntry): e is VerifiedEntry {
  return e.status === 'verified' && !!e.verified_url;
}

/**
 * Resolve the primary feed image from manifest entries.
 * Returns the verified URL or null if no valid primary image exists.
 * When null, the feed builder must skip the entire product item.
 */
export function resolveGmcPrimaryImage(
  entries: FeedImageManifestEntry[]
): string | null {
  const primary = entries
    .filter((e): e is VerifiedEntry => e.is_primary && isVerifiedWithUrl(e))
    .sort((a, b) => a.position - b.position)[0];
  return primary?.verified_url ?? null;
}

/**
 * URLs explicitly claimed by offers. Parent and sibling fallbacks must
 * exclude them so condition-specific imagery cannot leak into the base
 * product or across offers; an offer's own explicit images still match
 * directly against the manifest.
 */
export function collectOfferClaimedImageUrls(
  offers: Array<{ images?: unknown }> | undefined
): Set<string> {
  const claimed = new Set<string>();
  for (const offer of offers ?? []) {
    const images = Array.isArray(offer.images) ? offer.images : [offer.images];
    for (const image of images) {
      const url =
        typeof image === 'string'
          ? image
          : image && typeof image === 'object' && 'url' in image
            ? (image as { url: unknown }).url
            : null;
      if (typeof url === 'string' && url.trim()) claimed.add(url.trim());
    }
  }
  return claimed;
}

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

/**
 * Resolve additional feed images from manifest entries.
 * Returns only verified non-primary URLs, ordered by position, max 10.
 * Entries claimed by offers are excluded when provided, so offer-owned
 * imagery never leaks into parent-level additional image lists.
 */
export function resolveGmcAdditionalImages(
  entries: FeedImageManifestEntry[],
  excludeUrls: ReadonlySet<string> = new Set()
): string[] {
  const urls = entries
    .filter(
      (e): e is VerifiedEntry =>
        !e.is_primary &&
        isVerifiedWithUrl(e) &&
        !isOfferClaimedImage(e, excludeUrls)
    )
    .sort((a, b) => a.position - b.position)
    .map((e) => e.verified_url);
  // Deduplicate before the cap so repeated URLs cannot crowd out later
  // distinct images.
  return [...new Set(urls)].slice(0, GMC_ADDITIONAL_IMAGES_MAX);
}
