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
// - The LCP snapshot lives in the searchParams-gated slot's fallback, not the
//   listing fallback and not `fallback={null}`. Awaiting searchParams in that
//   slot would postpone the hero out of the static shell. Filtered requests
//   resolve the slot to a marker so the 100svh snapshot does not stay mounted
//   until listing data arrives.
// - The fallback hero awaits `params` only. Do not await getCachedBlogListing
//   there — `'use cache'` in this slot postpones the image into a hidden hole.

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

export async function BlogListingUnfilteredCommittedHero({
  params,
  searchParams,
}: Pick<BlogPageProps, 'params' | 'searchParams'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);

  if (isUnfilteredOgabasseyBlogListing(slug, query)) {
    return BlogListingCommittedLcpHero({
      params: Promise.resolve({ slug }),
    });
  }

  if (isOgabasseyBlogStaticTenant(slug)) {
    return <div data-blog-listing-filtered="" hidden />;
  }

  return null;
}

export default function BlogPage({ params, searchParams }: BlogPageProps) {
  return (
    <>
      <Suspense fallback={<BlogListingCommittedLcpHero params={params} />}>
        <BlogListingUnfilteredCommittedHero
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
