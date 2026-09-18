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
