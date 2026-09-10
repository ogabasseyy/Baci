import { BlogListingFallback } from './BlogListingFallback';
import { BlogListingOgabasseyLcpHero } from './blog-listing-ogabassey-lcp-hero';

export function BlogListingStaticShell() {
  return (
    <>
      <BlogListingOgabasseyLcpHero />
      <BlogListingFallback includeFeaturedSkeleton={false} />
    </>
  );
}
