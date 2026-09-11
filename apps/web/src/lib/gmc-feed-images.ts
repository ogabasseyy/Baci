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
 * Resolve additional feed images from manifest entries.
 * Returns only verified non-primary URLs, ordered by position, max 10.
 */
export function resolveGmcAdditionalImages(
  entries: FeedImageManifestEntry[]
): string[] {
  return entries
    .filter((e): e is VerifiedEntry => !e.is_primary && isVerifiedWithUrl(e))
    .sort((a, b) => a.position - b.position)
    .slice(0, GMC_ADDITIONAL_IMAGES_MAX)
    .map((e) => e.verified_url);
}
