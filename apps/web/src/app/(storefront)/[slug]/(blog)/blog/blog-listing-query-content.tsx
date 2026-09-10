import type { ReactNode } from 'react';
import { isOgabasseyBlogStaticTenant } from './blog-category-routing';
import { BlogPageContent, type BlogPageProps } from './blog-page-content';
import { isUnfilteredOgabasseyBlogListing } from './is-unfiltered-ogabassey-blog-listing';

interface BlogListingQueryContentProps extends BlogPageProps {
  hero: ReactNode;
}

export async function BlogListingQueryContent({
  hero,
  params,
  searchParams,
}: BlogListingQueryContentProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const unfiltered = isUnfilteredOgabasseyBlogListing(slug, query);
  const showHero = hero !== null && unfiltered;

  return (
    <>
      {isOgabasseyBlogStaticTenant(slug) && !unfiltered ? (
        <div data-blog-listing-filtered="" hidden />
      ) : null}
      {showHero ? hero : null}
      <BlogPageContent
        params={params}
        searchParams={searchParams}
        hideFeaturedStory={unfiltered}
      />
    </>
  );
}
