import {
  dedupePathSegmentsPreservingCasing,
  resolvePurgeHostnames,
} from './storefront-purge-shared';

/**
 * Build only the cached blog documents affected by a related-product change.
 * Product and listing URLs are intentionally excluded: callers use this after
 * the core product purge has already been scheduled synchronously.
 */
export function buildStorefrontBlogPostPurgeUrls(
  identifiers: readonly string[],
  blogPostSlugs: readonly string[]
): string[] {
  const normalizedSlugs = dedupePathSegmentsPreservingCasing(blogPostSlugs);
  if (normalizedSlugs.length === 0) {
    return [];
  }

  const urls = new Set<string>();
  for (const identifier of identifiers) {
    for (const hostname of resolvePurgeHostnames(identifier)) {
      urls.add(`https://${hostname}/blog`);
      for (const slug of normalizedSlugs) {
        urls.add(`https://${hostname}/blog/${encodeURIComponent(slug)}`);
        urls.add(
          `https://${hostname}/blog/${encodeURIComponent(slug)}/opengraph-image`
        );
      }
    }
  }

  return Array.from(urls);
}
