import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BlogListingFallback } from './BlogListingFallback';
import {
  isOgabasseyBlogStaticTenant,
  OGABASSEY_BLOG_STATIC_TENANTS,
} from './blog-category-routing';
import { BlogListingCommittedLcpHero } from './blog-listing-committed-lcp-hero';
import { buildBlogListingMetadata } from './blog-listing-metadata';
import { BlogListingQueryContent } from './blog-listing-query-content';
import { BlogPageContent, type BlogPageProps } from './blog-page-content';
import { isUnfilteredOgabasseyBlogListing } from './is-unfiltered-ogabassey-blog-listing';

// Cache Components invariant for this route:
// - generateMetadata must be request-searchParams-free for the STATIC tenant so
//   its metadata prerenders. Awaiting searchParams there forces metadata to
//   stream, which htmlLimitedBots then withholds from DOM bots — the cause of
//   the generic `Ogabassey` title seen for Googlebot. Non-static tenants render
//   dynamically, so their metadata may read searchParams to keep query-specific
//   noindex/self-canonical variants (search/pagination/category).
// - Do not await searchParams in this page. The page returns Suspense
//   boundaries immediately so the parent PPR shell can commit.
// - The snapshot hero is a sibling of the listing boundary and awaits `params`
//   only. Wrapping it in a searchParams Suspense remounts the LCP node on the
//   unfiltered `/blog` resume and pushed Slow-4G lab LCP above 2.5s.
// - Filtered requests cannot be known in the static shell. Stream a marker as
//   soon as searchParams resolve so first-paint CSS can hide the 100svh
//   snapshot without waiting for listing data. Do not await getCachedBlogListing
//   in the hero — `'use cache'` in that slot postpones the image into a hole.
// - The listing Suspense fallback must stay a short status line. A min-h-screen
//   skeleton grid in this slot ships on the unfiltered `/blog` first HTML under
//   the 100svh snapshot and inflated Slow-4G FCP/LCP.

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

export async function BlogListingResolved({
  params,
  searchParams,
}: BlogPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  return (
    <BlogListingQueryContent
      hero={null}
      params={Promise.resolve({ slug })}
      searchParams={Promise.resolve(query)}
    >
      <BlogPageContent
        hideFeaturedStory={isUnfilteredOgabasseyBlogListing(slug, query)}
        params={params}
        searchParams={searchParams}
      />
    </BlogListingQueryContent>
  );
}

export async function BlogListingFilteredListingMarker({
  params,
  searchParams,
}: Pick<BlogPageProps, 'params' | 'searchParams'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  if (
    isOgabasseyBlogStaticTenant(slug) &&
    !isUnfilteredOgabasseyBlogListing(slug, query)
  ) {
    return <div data-blog-listing-filtered="" hidden />;
  }

  return null;
}

export default function BlogPage({ params, searchParams }: BlogPageProps) {
  return (
    <>
      <BlogListingCommittedLcpHero params={params} />
      <Suspense fallback={null}>
        <BlogListingFilteredListingMarker
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
      <Suspense fallback={<BlogListingFallback />}>
        <BlogListingResolved params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
