import { getBlogAuthorSlugs } from '@/lib/blog-authors';
import {
  dedupePathSegmentsPreservingCasing,
  resolvePurgeHostnames,
} from '@/lib/storefront-purge-shared';

/**
 * Build the canonical public URLs to evict from Cloudflare when a storefront's
 * blog content changes. Only storefronts with a configured public cache policy
 * (i.e. a Cloudflare-fronted custom domain) produce URLs; everyone else returns
 * an empty list so the purge is a no-op.
 *
 * `identifiers` may be either a merchant slug (e.g. `ogabassey`) or one of the
 * policy's custom hostnames — both resolve to the same policy.
 */
export function buildStorefrontBlogPurgeUrls(
  identifiers: readonly string[],
  postSlugs: readonly string[],
  categorySlugs: readonly string[] = []
): string[] {
  const urls = new Set<string>();

  const dedupedSlugs = dedupePathSegmentsPreservingCasing(postSlugs);
  const dedupedCategorySlugs =
    dedupePathSegmentsPreservingCasing(categorySlugs);
  // Author hub pages (/blog/author/<slug>) list a byline's posts, so any post
  // create/update/delete/publish can change them. They exist only for the small
  // static, ogabassey-gated author registry — and purge hostnames only resolve
  // for ogabassey — so emitting every registered author slug on every resolved
  // hostname is correct and requires no per-post author threading. The slugs are
  // registry keys (already lowercase, comma-free).
  const authorSlugs = getBlogAuthorSlugs();

  for (const identifier of identifiers) {
    for (const hostname of resolvePurgeHostnames(identifier)) {
      urls.add(`https://${hostname}/blog`);
      urls.add(`https://${hostname}/blog/news-sitemap.xml`);
      urls.add(`https://${hostname}/blog/sitemap.xml`);
      for (const slug of dedupedSlugs) {
        urls.add(`https://${hostname}/blog/${encodeURIComponent(slug)}`);
        urls.add(
          `https://${hostname}/blog/${encodeURIComponent(slug)}/opengraph-image`
        );
      }
      // A post moving into or out of a category changes that category's
      // listing page (/blog/category/<slug>), which shares the same raised
      // edge TTL as /blog and the per-post URLs, so it must be evicted too.
      for (const categorySlug of dedupedCategorySlugs) {
        urls.add(
          `https://${hostname}/blog/category/${encodeURIComponent(categorySlug)}`
        );
      }
      for (const authorSlug of authorSlugs) {
        urls.add(
          `https://${hostname}/blog/author/${encodeURIComponent(authorSlug)}`
        );
      }
    }
  }

  return Array.from(urls);
}
