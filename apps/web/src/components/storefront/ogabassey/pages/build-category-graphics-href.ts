interface BuildCategoryGraphicsHrefOptions {
  graphics: string[];
  pathname: string;
  resetPage?: boolean;
  search?: string;
  /**
   * Curated hub slug this transition originates from. The listing validates
   * the selection against the hub's facet set and lifts the untrusted-request
   * cardinality cap for it. Deliberately unregistered in the SEO filter maps
   * so it never affects canonical URLs or robots decisions.
   */
  trustedHubSlug?: string;
}

export function buildCategoryGraphicsHref({
  graphics,
  pathname,
  resetPage = false,
  search = '',
  trustedHubSlug,
}: BuildCategoryGraphicsHrefOptions): string {
  const searchParams = new URLSearchParams(search);
  searchParams.delete('graphics');
  graphics.forEach((value) => {
    searchParams.append('graphics', value);
  });

  // A stale hub token must never survive a listing-originated transition;
  // only hub transitions mint a fresh one.
  searchParams.delete('graphicsHub');
  if (trustedHubSlug) {
    searchParams.set('graphicsHub', trustedHubSlug);
  }

  if (resetPage) {
    searchParams.delete('page');
  }

  const query = searchParams.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}
