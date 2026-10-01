import { isOgabasseyBlogStaticTenant } from './blog-category-routing';
import { BlogListingOgabasseyLcpHero } from './blog-listing-ogabassey-lcp-hero';
import type { BlogPageProps } from './blog-page-content';

/**
 * Committed (non-fallback) LCP hero. Must stay outside the listing Suspense
 * that awaits cached listing / searchParams — that swap replaced the inert
 * `<img>` with `CdnFormatImage`, so lab LCP stayed on the postponed `<picture>`.
 *
 * Awaits `params` only. Do not read `'use cache'` listing data here.
 */
export async function BlogListingCommittedLcpHero({
  params,
}: Pick<BlogPageProps, 'params'>) {
  const { slug } = await params;
  if (!isOgabasseyBlogStaticTenant(slug)) {
    return null;
  }

  return (
    <div data-blog-lcp-hero="">
      <BlogListingOgabasseyLcpHero />
    </div>
  );
}
