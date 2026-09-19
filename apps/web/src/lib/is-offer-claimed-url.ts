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
 * Root-relative (`/path`) references mirror the backfill classifier, which
 * only resolves paths beginning with `/`. Bare (`path`) and
 * scheme-relative (`//host/path`) references never verify, so they must
 * not exclude parent imagery by path alone.
 */
function isRelativeReference(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

/**
 * Canonical absolute form for equivalent-spelling comparison: lowercase
 * scheme and host, default ports dropped, dot segments resolved, and
 * query/fragment stripped. Different hosts stay distinct, so the
 * cross-host restriction holds.
 */
function canonicalAbsoluteUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Whether a single URL is claimed by an offer exclusion set: exact match,
 * canonically equivalent absolute match (case, default port, fragment, and
 * dot-segment spellings), or a relative offer claim resolving to the same
 * path. Raw product-image fallbacks (which have no manifest entry) must
 * use this so a relative claim still excludes the equivalent absolute
 * product URL. Absolute claims from another host never match.
 */
export function isOfferClaimedUrl(
  url: string | null | undefined,
  excludeUrls: ReadonlySet<string>
): boolean {
  if (url == null || excludeUrls.size === 0) return false;
  const pathname = normalizedPath(url);
  const canonical = canonicalAbsoluteUrl(url);
  for (const claim of excludeUrls) {
    if (claim === url) {
      return true;
    }
    const claimCanonical = canonicalAbsoluteUrl(claim);
    if (
      claimCanonical != null &&
      canonical != null &&
      claimCanonical === canonical
    ) {
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
