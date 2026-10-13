/**
 * Google Merchant Center feed image resolution from a prevalidated manifest.
 *
 * The feed route performs ZERO live network validation.
 * All image URLs are resolved from `product_feed_images` rows
 * that were prevalidated by an offline backfill/audit job.
 */

import { isOfferClaimedImage } from '@/lib/is-offer-claimed-image';

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
 * Entries claimed by offers are excluded when provided, so offer-owned
 * imagery never leaks into the base product primary image. When the
 * flagged primary is claimed but other verified entries remain, the
 * lowest-position safe entry is promoted instead of dropping the row;
 * callers must keep the returned URL out of the additional-image list.
 */
export function resolveGmcPrimaryImage(
  entries: FeedImageManifestEntry[],
  excludeUrls: ReadonlySet<string> = new Set()
): string | null {
  const candidates = entries.filter(
    (e): e is VerifiedEntry =>
      isVerifiedWithUrl(e) && !isOfferClaimedImage(e, excludeUrls, entries)
  );
  const primary = candidates
    .filter((e) => e.is_primary)
    .sort((a, b) => a.position - b.position)[0];
  if (primary) {
    return primary.verified_url;
  }
  const promoted = candidates.sort((a, b) => a.position - b.position)[0];
  return promoted?.verified_url ?? null;
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
        !isOfferClaimedImage(e, excludeUrls, entries)
    )
    .sort((a, b) => a.position - b.position)
    .map((e) => e.verified_url);
  // Deduplicate before the cap so repeated URLs cannot crowd out later
  // distinct images.
  return [...new Set(urls)].slice(0, GMC_ADDITIONAL_IMAGES_MAX);
}
