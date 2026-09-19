/** Pathname of an absolute URL, or the path part of a relative reference. */
function normalizedPath(value: string): string | null {
  try {
    return new URL(value).pathname;
  } catch {
    const path = value.split(/[?#]/, 1)[0];
    return path.length > 0 ? path : null;
  }
}

/** Bare path references carry no scheme or authority to compare exactly. */
function isRelativeReference(value: string): boolean {
  try {
    new URL(value);
    return false;
  } catch {
    return value.length > 0;
  }
}

/**
 * Whether a single URL is claimed by an offer exclusion set: exact match,
 * or a relative offer claim resolving to the same path (query strings and
 * fragments ignored on both sides, since the backfill resolves both raw
 * forms to one shared verified resource). Raw product-image fallbacks
 * (which have no manifest entry) must use this so a relative claim still
 * excludes the equivalent absolute product URL. Absolute claims from
 * another host never match by path alone.
 */
export function isOfferClaimedUrl(
  url: string | null | undefined,
  excludeUrls: ReadonlySet<string>
): boolean {
  if (url == null || excludeUrls.size === 0) return false;
  const pathname = normalizedPath(url);
  for (const claim of excludeUrls) {
    if (claim === url) {
      return true;
    }
    if (!isRelativeReference(claim)) {
      continue;
    }
    const claimPath = normalizedPath(claim);
    if (claimPath != null && claimPath === pathname) {
      return true;
    }
  }
  return false;
}
