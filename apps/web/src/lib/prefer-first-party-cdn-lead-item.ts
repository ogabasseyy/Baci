import { buildOgabasseyCdnImageLoaderUrl } from '@/lib/ogabassey-cdn-image-url';
import { toOgabasseySameOriginTransformUrl } from '@/lib/ogabassey-same-origin-hero-url';

const FIRST_PARTY_CDN_PREFIX = 'https://cdn.ogabassey.com/';
const SAME_ORIGIN_CDN_PREFIX = '/cdn-image/';

/**
 * Ranks a candidate image URL by its same-origin proxy eligibility:
 * - `2`: rewrites to `/cdn-image/...` via `toOgabasseySameOriginTransformUrl`
 * - `1`: hosted on `https://cdn.ogabassey.com/...` but origin-only (e.g.
 *        uppercase `.JPG` extension or unsupported transform option)
 * - `0`: external or missing URL
 */
function getCdnLeadPriorityTier(image: string | null | undefined): 0 | 1 | 2 {
  if (!image) {
    return 0;
  }
  const trimmed = image.trim();
  if (trimmed.startsWith(SAME_ORIGIN_CDN_PREFIX)) {
    const equivalentCdnTransformUrl = `${FIRST_PARTY_CDN_PREFIX}image/${trimmed.slice(
      SAME_ORIGIN_CDN_PREFIX.length
    )}`;
    return toOgabasseySameOriginTransformUrl(
      equivalentCdnTransformUrl
    ).startsWith(SAME_ORIGIN_CDN_PREFIX)
      ? 2
      : 0;
  }
  if (!trimmed.startsWith(FIRST_PARTY_CDN_PREFIX)) {
    return 0;
  }
  const candidateTransformUrl = trimmed.startsWith(
    `${FIRST_PARTY_CDN_PREFIX}image/`
  )
    ? trimmed
    : buildOgabasseyCdnImageLoaderUrl(trimmed, 384, 70, 'avif');
  return toOgabasseySameOriginTransformUrl(candidateTransformUrl).startsWith(
    SAME_ORIGIN_CDN_PREFIX
  )
    ? 2
    : 1;
}

/**
 * Ensures the leading item in a launch/hero carousel array uses a same-origin
 * proxy-eligible OgaBassey CDN image (tier 2) when available, falling back to
 * an origin-only `https://cdn.ogabassey.com/...` image (tier 1) ahead of
 * external images (tier 0), while preserving the relative order of all
 * remaining items.
 */
export function preferFirstPartyCdnLeadItem<T>(
  items: readonly T[],
  getImageUrl: (item: T) => string | null | undefined
): T[] {
  if (items.length <= 1) {
    return [...items];
  }
  const leadTier = getCdnLeadPriorityTier(getImageUrl(items[0]));
  if (leadTier === 2) {
    return [...items];
  }

  for (const targetTier of [2, 1] as const) {
    if (leadTier >= targetTier) {
      break;
    }
    const candidateIndex = items.findIndex(
      (item) => getCdnLeadPriorityTier(getImageUrl(item)) === targetTier
    );
    if (candidateIndex > 0) {
      return [
        items[candidateIndex],
        ...items.slice(0, candidateIndex),
        ...items.slice(candidateIndex + 1),
      ];
    }
  }

  return [...items];
}
