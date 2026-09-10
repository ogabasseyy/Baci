import { Suspense } from 'react';
import { BlogListingFallback } from './BlogListingFallback';
import { isOgabasseyBlogStaticTenant } from './blog-category-routing';
import { BlogListingQueryContent } from './blog-listing-query-content';
import { BlogListingStaticHero } from './blog-listing-static-hero';
import type { BlogPageProps } from './blog-page-content';

export async function BlogListingRequestContent({
  params,
  searchParams,
}: BlogPageProps) {
  const { slug } = await params;

  // Static Ogabassey listings already committed the snapshot LCP hero as a
  // page sibling. Awaiting the cached hero here re-introduced CdnFormatImage
  // and replaced that `<img>` as the LCP node.
  if (isOgabasseyBlogStaticTenant(slug)) {
    return (
      <Suspense
        fallback={<BlogListingFallback includeFeaturedSkeleton={false} />}
      >
        <BlogListingQueryContent
          hero={null}
          params={params}
          searchParams={searchParams}
        />
      </Suspense>
    );
  }

  const hero = await BlogListingStaticHero({ params });

  return (
    <Suspense
      fallback={
        <>
          {hero}
          <BlogListingFallback includeFeaturedSkeleton={false} />
        </>
      }
    >
      <BlogListingQueryContent
        hero={hero}
        params={params}
        searchParams={searchParams}
      />
    </Suspense>
  );
}
