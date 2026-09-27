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
    // Array-only, like the backfill extractor and the offer-image resolver:
    // a singleton shape can never verify, so claiming it would only remove
    // the base image while the offer row resolves nothing.
    if (!Array.isArray(offer.images)) continue;
    for (const image of offer.images) {
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
