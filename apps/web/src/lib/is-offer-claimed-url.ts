/**
 * Pathname with dot segments resolved and query/fragment stripped, so
 * `/images/../used.jpg?v=2` and `https://cdn.example/images/used.jpg`
 * compare equal. Relative references resolve against a dummy base purely
 * to normalize dot segments; only the pathname is ever compared.
 */
function normalizedPath(value: string): string | null {
  try {
    return new URL(value, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

/**
 * Bare path references carry no scheme or authority to compare exactly.
 * Scheme-relative (`//host/path`) references keep their authority, so
 * they never match by path alone.
 */
function isRelativeReference(value: string): boolean {
  if (value.length === 0 || value.startsWith('//')) return false;
  try {
    new URL(value);
    return false;
  } catch {
    return true;
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
