import {
  type FeedImageManifestEntry,
  resolveGmcAdditionalImages,
  resolveGmcPrimaryImage,
} from '@/lib/gmc-feed-images';
import { escapeXml } from '@/lib/xml-utils';

/** Explicit offer imagery must match verified manifest entries, never the parent fallback. */
export function resolveOfferFeedImages(
  images: unknown,
  manifest: FeedImageManifestEntry[]
) {
  let entries = manifest.filter((entry) => !entry.variant_id);
  if (images != null && !(Array.isArray(images) && images.length === 0)) {
    if (!Array.isArray(images)) return null;
    entries = images.flatMap((image: unknown, position) => {
      const url =
        typeof image === 'string'
          ? image
          : image && typeof image === 'object' && 'url' in image
            ? image.url
            : null;
      if (typeof url !== 'string' || !url.trim()) return [];
      const entry = manifest.find(
        (candidate) =>
          candidate.status === 'verified' &&
          candidate.verified_url &&
          (candidate.source_url === url.trim() ||
            candidate.verified_url === url.trim())
      );
      return entry ? [{ ...entry, position, is_primary: false }] : [];
    });
    if (entries[0]) entries[0] = { ...entries[0], is_primary: true };
  }
  const imageUrl = resolveGmcPrimaryImage(entries);
  if (!imageUrl) return null;
  return {
    imageUrl,
    additionalImagesXml: [...new Set(resolveGmcAdditionalImages(entries))]
      .filter((url) => url !== imageUrl)
      .map(
        (url) =>
          `        <g:additional_image_link>${escapeXml(url)}</g:additional_image_link>`
      )
      .join('\n'),
  };
}
