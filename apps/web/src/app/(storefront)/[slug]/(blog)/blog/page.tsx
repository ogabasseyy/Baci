import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BlogListingFallback } from './BlogListingFallback';
import {
  isOgabasseyBlogStaticTenant,
  OGABASSEY_BLOG_STATIC_TENANTS,
} from './blog-category-routing';
import { buildBlogListingMetadata } from './blog-listing-metadata';
import { BlogListingStaticHero } from './blog-listing-static-hero';
import { BlogPageContent, type BlogPageProps } from './blog-page-content';

// Cache Components invariant for this route:
// - generateMetadata must be request-searchParams-free for the STATIC tenant so
//   its metadata prerenders. Awaiting searchParams there forces metadata to
//   stream, which htmlLimitedBots then withholds from DOM bots — the cause of
//   the generic `Ogabassey` title seen for Googlebot. Non-static tenants render
//   dynamically, so their metadata may read searchParams to keep query-specific
//   noindex/self-canonical variants (search/pagination/category).
// - The listing hero only awaits params + the cached published listing, so it
//   can paint the LCP featured image outside the searchParams Suspense slot.
// - The remaining listing content still reads searchParams behind Suspense so
//   pagination/search keep working, including on the static tenant.

export function generateStaticParams(): Array<{ slug: string }> {
  return OGABASSEY_BLOG_STATIC_TENANTS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: BlogPageProps): Promise<Metadata> {
  const { slug } = await params;

  if (isOgabasseyBlogStaticTenant(slug)) {
    return buildBlogListingMetadata({ slug, searchParams: {} });
  }

  return buildBlogListingMetadata({ slug, searchParams: await searchParams });
}

export default function BlogPage({ params, searchParams }: BlogPageProps) {
  return (
    <>
      <Suspense fallback={null}>
        <BlogListingStaticHero params={params} />
      </Suspense>
      <Suspense
        fallback={<BlogListingFallback includeFeaturedSkeleton={false} />}
      >
        <BlogPageContent
          hideFeaturedStory
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    </>
  );
}
