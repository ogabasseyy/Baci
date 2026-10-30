const FIRST_PARTY_CDN_PREFIX = 'https://cdn.ogabassey.com/';
const SAME_ORIGIN_CDN_PREFIX = '/cdn-image/';

function hasFirstPartyCdnImageUrl(image: string | null | undefined): boolean {
  if (!image) {
    return false;
  }
  const trimmed = image.trim();
  return (
    trimmed.startsWith(SAME_ORIGIN_CDN_PREFIX) ||
    trimmed.startsWith(FIRST_PARTY_CDN_PREFIX)
  );
}

/**
 * Ensures the leading item in a launch/hero carousel array uses a first-party
 * OgaBassey CDN image (`https://cdn.ogabassey.com/...` or `/cdn-image/...`)
 * when at least one candidate has one, preserving the relative order of all
 * remaining items.
 */
export function preferFirstPartyCdnLeadItem<T>(
  items: readonly T[],
  getImageUrl: (item: T) => string | null | undefined
): T[] {
  if (items.length <= 1 || hasFirstPartyCdnImageUrl(getImageUrl(items[0]))) {
    return [...items];
  }
  const cdnLeadIndex = items.findIndex((item) =>
    hasFirstPartyCdnImageUrl(getImageUrl(item))
  );
  if (cdnLeadIndex <= 0) {
    return [...items];
  }
  return [
    items[cdnLeadIndex],
    ...items.slice(0, cdnLeadIndex),
    ...items.slice(cdnLeadIndex + 1),
  ];
}
